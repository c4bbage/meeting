"""
FastAPI Server for Meeting Transcription
Supports multiple ASR engines: faster-whisper, funasr
"""

import os
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List, Dict, Any

from .hotwords import get_hotword_manager, CATEGORIES
from .storage import PageStorage, SegmentStorage

# ASR Engine selection via environment variable
# Options: "whisper" (default), "funasr"
ASR_ENGINE = os.environ.get("ASR_ENGINE", "whisper").lower()

def get_asr_service():
    """Get the configured ASR service."""
    if ASR_ENGINE == "funasr":
        from .funasr_service import get_funasr_service
        return get_funasr_service()
    else:
        from .transcription import get_transcription_service
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


class PageUpdate(BaseModel):
    title: Optional[str] = None
    duration: Optional[int] = None
    status: Optional[str] = None
    language: Optional[str] = None


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
    uvicorn.run(app, host="0.0.0.0", port=8000)
