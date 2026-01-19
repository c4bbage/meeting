"""
FastAPI Server for Meeting Transcription
Supports multiple ASR engines: faster-whisper, funasr
"""

import os
from pathlib import Path
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List, Dict, Any

from .hotwords import get_hotword_manager, CATEGORIES
from .storage import PageStorage, SegmentStorage
from .transcription import get_transcription_service

# ASR Engine selection via environment variable
# Options: "whisper" (default), "funasr"
ASR_ENGINE = os.environ.get("ASR_ENGINE", "whisper").lower()

def get_asr_service():
    """Get the configured ASR service."""
    if ASR_ENGINE == "funasr":
        from .funasr_service import get_funasr_service
        return get_funasr_service()
    else:
        return get_transcription_service()

app = FastAPI(
    title="Meeting Transcription API",
    description=f"Audio transcription with {ASR_ENGINE} engine",
    version="1.0.0"
)

# Enable CORS for browser access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify exact origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# === Health Check ===

@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "ok", "service": "meeting-transcription"}


# === Pages API ===

class PageCreate(BaseModel):
    id: str
    title: str = "未命名录音"
    language: str = "zh-CN"
    createdAt: Optional[str] = None
    duration: int = 0
    status: str = "recording"
    autoTitle: Optional[str] = None
    summary: Optional[str] = None
    keyPoints: Optional[List[str]] = None
    decisions: Optional[List[str]] = None
    todos: Optional[List[Dict[str, Any]]] = None
    todoCount: Optional[int] = None
    wordCount: Optional[int] = None
    analyzed: Optional[bool] = None


class PageUpdate(BaseModel):
    title: Optional[str] = None
    duration: Optional[int] = None
    status: Optional[str] = None
    language: Optional[str] = None
    autoTitle: Optional[str] = None
    summary: Optional[str] = None
    keyPoints: Optional[List[str]] = None
    decisions: Optional[List[str]] = None
    todos: Optional[List[Dict[str, Any]]] = None
    todoCount: Optional[int] = None
    wordCount: Optional[int] = None
    analyzed: Optional[bool] = None


@app.get("/api/pages")
async def get_pages(include_deleted: bool = False):
    """Get all pages (recordings)."""
    pages = PageStorage.get_all(include_deleted=include_deleted)
    return {"success": True, "pages": pages}


@app.post("/api/pages")
async def create_page(data: PageCreate):
    """Create a new page."""
    try:
        page = PageStorage.create(data.model_dump())
        return {"success": True, "page": page}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/pages/{page_id}")
async def get_page(page_id: str):
    """Get a single page by ID."""
    page = PageStorage.get_by_id(page_id)
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    return {"success": True, "page": page}


@app.put("/api/pages/{page_id}")
async def update_page(page_id: str, data: PageUpdate):
    """Update a page."""
    update_data = {k: v for k, v in data.model_dump().items() if v is not None}
    page = PageStorage.update(page_id, update_data)
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    return {"success": True, "page": page}


@app.delete("/api/pages/{page_id}")
async def delete_page(page_id: str):
    """Soft delete a page."""
    success = PageStorage.soft_delete(page_id)
    if not success:
        raise HTTPException(status_code=404, detail="Page not found")
    return {"success": True}


@app.post("/api/pages/{page_id}/restore")
async def restore_page(page_id: str):
    """Restore a soft-deleted page."""
    success = PageStorage.restore(page_id)
    if not success:
        raise HTTPException(status_code=404, detail="Page not found")
    return {"success": True}


# === Segments API ===

class SegmentData(BaseModel):
    id: str
    text: str
    timestamp: int
    endTime: Optional[int] = None
    confidence: float = 0
    isFinal: bool = True
    speaker: Optional[str] = None
    speakerLabel: Optional[str] = None
    speakerColor: Optional[str] = None
    words: Optional[List[Dict[str, Any]]] = None
    source: str = "web_speech"


class SegmentsBulkCreate(BaseModel):
    segments: List[SegmentData]


@app.get("/api/pages/{page_id}/segments")
async def get_segments(page_id: str):
    """Get all segments for a page."""
    segments = SegmentStorage.get_by_page_id(page_id)
    return {"success": True, "segments": segments}


@app.post("/api/pages/{page_id}/segments")
async def save_segments(page_id: str, data: SegmentsBulkCreate):
    """Bulk save segments for a page (replaces existing)."""
    try:
        segments_data = [
            {"pageId": page_id, **seg.model_dump()}
            for seg in data.segments
        ]
        count = SegmentStorage.bulk_create(page_id, segments_data)
        return {"success": True, "count": count}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# === Search API ===

@app.get("/api/search/pages")
async def search_pages(query: str, include_deleted: bool = False):
    """Search page IDs by transcript content."""
    if not query or not query.strip():
        return {"success": True, "pageIds": []}

    page_ids = SegmentStorage.search_page_ids_by_text(
        query,
        include_deleted=include_deleted
    )
    return {"success": True, "pageIds": page_ids}


@app.post("/api/pages/{page_id}/audio_chunk")
async def upload_audio_chunk(
    page_id: str,
    audio_chunk: UploadFile = File(...),
    timestamp: str = Form(...)
):
    """Upload audio chunk during recording (streaming)."""
    from pathlib import Path
    import logging
    logger = logging.getLogger(__name__)
    
    try:
        # Create chunks directory
        DATA_DIR = Path("data")
        chunks_dir = DATA_DIR / page_id / "chunks"
        chunks_dir.mkdir(parents=True, exist_ok=True)
        
        # Save chunk
        chunk_filename = f"chunk_{timestamp}.webm"
        chunk_path = chunks_dir / chunk_filename
        
        content = await audio_chunk.read()
        with open(chunk_path, 'wb') as f:
            f.write(content)
        
        logger.info(f"Saved audio chunk for {page_id}: {len(content)} bytes")
        return {"success": True, "chunk_id": timestamp, "size": len(content)}
    except Exception as e:
        logger.error(f"Failed to save audio chunk: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/pages/{page_id}/audio")
async def get_audio(page_id: str):
    """Get combined audio for a page (from chunks or full recording)."""
    data_dir = Path("data") / page_id
    full_path = data_dir / "recording.webm"
    if full_path.exists():
        return FileResponse(full_path, media_type="audio/webm", filename=f"{page_id}.webm")

    chunks_dir = data_dir / "chunks"
    if not chunks_dir.exists():
        raise HTTPException(status_code=404, detail="Audio not found")

    chunk_files = list(chunks_dir.glob("chunk_*.webm"))
    if not chunk_files:
        raise HTTPException(status_code=404, detail="Audio not found")

    # Combine chunks on the fly involves complexity, let's suggest using export for full file
    # Or for now, just return 404 if no full recording. 
    # Usually frontend uploads full recording on stop.
    raise HTTPException(status_code=404, detail="Full audio recording not finalized yet. Please try Export MP3.")


@app.get("/api/pages/{page_id}/export/mp3")
async def export_mp3(page_id: str):
    """Convert and export audio as MP3 using ffmpeg"""
    import subprocess
    
    data_dir = Path("data") / page_id
    input_path = data_dir / "recording.webm"
    output_path = data_dir / "recording.mp3"
    
    if not input_path.exists():
        # Check for chunks?
        chunks_dir = data_dir / "chunks"
        if chunks_dir.exists() and list(chunks_dir.glob("chunk_*.webm")):
            # TODO: Merge chunks first. For now, rely on client uploading full blob.
            pass
        raise HTTPException(status_code=404, detail="Source audio recording not found")

    # If MP3 doesn't exist or is older than WebM, convert it
    if not output_path.exists() or output_path.stat().st_mtime < input_path.stat().st_mtime:
        try:
            cmd = [
                "ffmpeg", "-y",
                "-i", str(input_path),
                "-codec:a", "libmp3lame",
                
                # High quality settings
                "-qscale:a", "2", 
                
                # Write duration/metadata
                "-write_xing", "0", 
                
                str(output_path)
            ]
            
            # Run ffmpeg
            result = subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            
        except subprocess.CalledProcessError as e:
            print(f"FFmpeg error: {e.stderr.decode()}")
            raise HTTPException(status_code=500, detail="Audio conversion failed")
            
    return FileResponse(
        output_path, 
        media_type="audio/mpeg", 
        filename=f"meeting_{page_id}.mp3"
    )


            return stem

    chunk_files.sort(key=chunk_key)

    def iter_chunks():
        for path in chunk_files:
            with open(path, "rb") as fh:
                while True:
                    data = fh.read(8192)
                    if not data:
                        break
                    yield data

    headers = {"Content-Disposition": f"inline; filename={page_id}.webm"}
    return StreamingResponse(iter_chunks(), media_type="audio/webm", headers=headers)


# === Transcription API ===

@app.post("/api/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    language: str = Form(default="zh"),
    hotwords: Optional[str] = Form(default=None),
    use_saved_hotwords: bool = Form(default=True)
):
    """
    Transcribe an audio file.
    
    Args:
        file: Audio file (webm, mp3, wav, etc.)
        language: Language code (zh, en, ja)
        hotwords: Additional hotwords (space-separated)
        use_saved_hotwords: Whether to include saved hotwords
        
    Returns:
        Transcription result with segments and word timestamps
    """
    try:
        # Read file content
        content = await file.read()
        
        if len(content) == 0:
            raise HTTPException(status_code=400, detail="Empty audio file")
        
        # Get services
        svc = get_asr_service()
        hw_manager = get_hotword_manager()
        
        # Combine hotwords (only for whisper engine)
        all_hotwords = []
        if ASR_ENGINE == "whisper" and use_saved_hotwords:
            saved = hw_manager.get_hotwords_string()
            if saved:
                all_hotwords.append(saved)
        if hotwords:
            all_hotwords.append(hotwords)
        
        combined_hotwords = " ".join(all_hotwords) if all_hotwords else None
        
        # Generate initial prompt from categorized hotwords
        initial_prompt = hw_manager.generate_initial_prompt() if use_saved_hotwords else None
        
        # Transcribe
        result = svc.transcribe_bytes(
            content,
            filename=file.filename or "audio.webm",
            language=language,
            hotwords=combined_hotwords,
            initial_prompt=initial_prompt
        )
        
        return result
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# === Hotwords API ===

# === Hotwords API ===

class HotwordCreate(BaseModel):
    word: str
    category: str = "other"


class HotwordResponse(BaseModel):
    id: str
    word: str
    category: str
    createdAt: str
    updatedAt: str


@app.get("/api/hotwords")
async def get_hotwords():
    """Get all saved hotwords."""
    manager = get_hotword_manager()
    return {
        "hotwords": manager.get_all(),
        "categories": CATEGORIES
    }


@app.post("/api/hotwords")
async def add_hotword(data: HotwordCreate):
    """Add a new hotword."""
    manager = get_hotword_manager()
    hotword = manager.add(data.word, data.category)
    return {"success": True, "hotword": hotword}


@app.delete("/api/hotwords/{hotword_id}")
async def delete_hotword(hotword_id: str):
    """Delete a hotword by ID."""
    manager = get_hotword_manager()
    removed = manager.remove(hotword_id)
    if not removed:
        raise HTTPException(status_code=404, detail="Hotword not found")
    return {"success": True}


# === WebSocket Streaming ===

from fastapi import WebSocket, WebSocketDisconnect
import asyncio
from collections import deque

async def _handle_transcribe_socket(websocket: WebSocket, language: str = "zh"):
    """
    WebSocket endpoint for real-time transcription.
    Receives audio chunks (bytes) and returns incremental results.
    """
    await websocket.accept()
    print(f"WebSocket connected (Engine: {ASR_ENGINE})")
    
    svc = get_asr_service()
    chunk_queue: asyncio.Queue[bytes] = asyncio.Queue(maxsize=3)
    stop_event = asyncio.Event()
    header_chunk = None
    recent_chunks = deque(maxlen=6)

    def _extract_text_and_confidence(result: Dict[str, Any]):
        text = ""
        confidence = None

        if isinstance(result, dict):
            if result.get("text"):
                text = result.get("text", "")
            elif result.get("segments"):
                text = " ".join(seg.get("text", "").strip() for seg in result.get("segments", [])).strip()

            probs = []
            for seg in result.get("segments", []) or []:
                for word in seg.get("words", []) or []:
                    prob = word.get("probability")
                    if prob is not None:
                        probs.append(prob)
            if probs:
                confidence = round(sum(probs) / len(probs), 3)

        return text.strip(), confidence

    async def worker():
        seq = 0
        while not stop_event.is_set():
            chunk = await chunk_queue.get()
            if chunk is None:
                break
            seq += 1
            try:
                result = await asyncio.to_thread(
                    svc.transcribe_bytes,
                    chunk,
                    f"stream_{seq}.webm",
                    language=language
                )
                text, confidence = _extract_text_and_confidence(result or {})
                if text:
                    await websocket.send_json({
                        "type": "result",
                        "text": text,
                        "is_final": True,
                        "confidence": confidence,
                        "engine": ASR_ENGINE,
                        "seq": seq
                    })
            except Exception as e:
                await websocket.send_json({
                    "type": "error",
                    "message": str(e),
                    "seq": seq
                })

    worker_task = asyncio.create_task(worker())

    try:
        while True:
            message = await websocket.receive()
            if "bytes" in message and message["bytes"]:
                data = message["bytes"]
                if header_chunk is None:
                    header_chunk = data
                    continue
                recent_chunks.append(data)

                audio_bytes = header_chunk + b"".join(recent_chunks)
                if chunk_queue.full():
                    _ = chunk_queue.get_nowait()
                await chunk_queue.put(audio_bytes)
            elif "text" in message:
                if message["text"] == "close":
                    break
    except WebSocketDisconnect:
        print("WebSocket disconnected")
    except Exception as e:
        print(f"WebSocket connection error: {e}")
    finally:
        stop_event.set()
        try:
            await chunk_queue.put(None)
        except Exception:
            pass
        try:
            await worker_task
        except Exception:
            pass


@app.websocket("/ws/transcribe")
async def websocket_endpoint(websocket: WebSocket, language: str = "zh"):
    await _handle_transcribe_socket(websocket, language)


@app.websocket("/api/ws/transcribe")
async def websocket_endpoint_api(websocket: WebSocket, language: str = "zh"):
    await _handle_transcribe_socket(websocket, language)




# === Gemini AI Analysis ===

class AnalyzeRequest(BaseModel):
    transcript: str
    

@app.get("/api/gemini/status")
async def gemini_status():
    """Check if Gemini API is configured."""
    from .gemini_service import get_gemini_service
    service = get_gemini_service()
    return {
        "available": service.is_available(),
        "model": service.model
    }


@app.post("/api/preload")
async def preload_models():
    """Preload ASR models for faster first use."""
    status = {}

    try:
        get_transcription_service()
        status["whisper"] = "ready"
    except Exception as e:
        status["whisper"] = f"error: {e}"

    try:
        from .funasr_service import get_funasr_service
        get_funasr_service()
        status["funasr"] = "ready"
    except Exception as e:
        status["funasr"] = f"error: {e}"

    return {"success": True, "status": status}


@app.post("/api/analyze")
async def analyze_meeting(request: AnalyzeRequest):
    """
    Analyze meeting transcript using Gemini AI.
    Returns structured summary, title, key points, and TODOs.
    """
    from .gemini_service import get_gemini_service
    
    service = get_gemini_service()
    
    if not service.is_available():
        raise HTTPException(
            status_code=503, 
            detail="Gemini API 未配置。请在 .env 文件中设置 GEMINI_API_KEY"
        )
    
    if not request.transcript or len(request.transcript.strip()) < 10:
        raise HTTPException(
            status_code=400,
            detail="转录内容太短，无法分析"
        )
    
    try:
        result = await service.analyze_meeting(request.transcript)
        return {
            "success": True,
            **result
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# === Startup Event ===

@app.on_event("startup")
async def startup_event():
    """Initialize services on startup."""
    print(f"Starting Meeting Transcription API with {ASR_ENGINE} engine...")
    # Pre-load the model (will download if needed on first run)
    get_asr_service()
    # Preload both models for faster switching
    try:
        get_transcription_service()
        print("✅ Whisper model preloaded")
    except Exception as e:
        print(f"⚠️ Whisper preload failed: {e}")

    try:
        from .funasr_service import get_funasr_service
        get_funasr_service()
        print("✅ FunASR model preloaded")
    except Exception as e:
        print(f"⚠️ FunASR preload failed: {e}")
    
    # Check Gemini status
    from .gemini_service import get_gemini_service
    gemini = get_gemini_service()
    if gemini.is_available():
        print(f"✅ Gemini AI available (model: {gemini.model})")
    else:
        print("⚠️  Gemini AI not configured (set GEMINI_API_KEY in .env)")
    
    print("API ready!")


# === Main Entry ===

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=6543)
