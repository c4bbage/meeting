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
from .storage import PageStorage, SegmentStorage, SpeakerDataStorage, TodoStorage, ReviewStorage
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


def flatten_todo_tree(raw_todos):
    """Flatten TodoItems with string subtasks into flat list with parent_id linkage."""
    flat = []
    counter = [0]

    for item in raw_todos:
        idx = counter[0]
        counter[0] += 1
        todo = {k: v for k, v in item.items() if k != 'subtasks'}
        todo['_tempIdx'] = idx
        flat.append(todo)
        for sub_text in (item.get('subtasks') or []):
            sub_idx = counter[0]
            counter[0] += 1
            flat.append({
                'content': sub_text,
                'category': todo.get('category', 'other'),
                'priority': todo.get('priority', '中'),
                'assignee': todo.get('assignee'),
                'deadline': todo.get('deadline'),
                'completed': False,
                'needs_reminder': False,
                '_tempIdx': sub_idx,
                '_tempParent': idx,
            })

    return flat


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


@app.get("/api/health")
async def health_check_api():
    """Health check endpoint (aliased under /api for frontend compatibility)."""
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
    notes: Optional[str] = None


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
    notes: Optional[str] = None


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
async def get_segments(page_id: str, version: Optional[str] = None):
    """
    Get segments for a page, optionally filtered by transcript version.
    
    Args:
        page_id: Page ID
        version: Optional transcript version ('realtime', 'final', 'fused')
                If not specified, uses the page's activeVersion
    """
    # Get page to determine active version if not specified
    if not version:
        page = PageStorage.get_by_id(page_id)
        if page:
            version = page.get('activeVersion', 'realtime')
        else:
            version = 'realtime'  # Default fallback
    
    segments = SegmentStorage.get_by_page_id(page_id, transcript_version=version)
    
    return {
        'success': True,
        'segments': segments,
        'version': version,
        'count': len(segments)
    }


@app.post("/api/pages/{page_id}/segments")
async def save_segments(page_id: str, data: SegmentsBulkCreate, version: Optional[str] = 'realtime'):
    """Bulk save segments for a page with specified version (replaces existing for that version)."""
    try:
        segments_data = [
            {"pageId": page_id, **seg.model_dump()}
            for seg in data.segments
        ]
        count = SegmentStorage.bulk_create(page_id, segments_data, transcript_version=version)
        return {"success": True, "count": count, "version": version}
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


# === Speaker Data API ===

class SpeakerDataCreate(BaseModel):
    data: Dict[str, Any]


@app.get("/api/pages/{page_id}/speakers")
async def get_speaker_data(page_id: str):
    """Get speaker data for a page."""
    speaker_data = SpeakerDataStorage.get(page_id)
    return {"success": True, "speakerData": speaker_data}


@app.post("/api/pages/{page_id}/speakers")
async def save_speaker_data(page_id: str, request: SpeakerDataCreate):
    """Save speaker data for a page."""
    try:
        speaker_data = SpeakerDataStorage.save(page_id, request.data)
        return {"success": True, "speakerData": speaker_data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# === Todos API ===

class TodoCreate(BaseModel):
    id: str
    pageId: str
    content: str
    category: str = "other"
    deadline: Optional[str] = None
    priority: str = "medium"
    assignee: Optional[str] = None
    completed: bool = False
    needsReminder: bool = False
    notes: Optional[str] = None
    parentId: Optional[str] = None
    sortOrder: int = 0
    dismissed: bool = False
    attachments: Optional[list] = None
    createdAt: Optional[str] = None
    updatedAt: Optional[str] = None


class TodoUpdate(BaseModel):
    content: Optional[str] = None
    category: Optional[str] = None
    deadline: Optional[str] = None
    priority: Optional[str] = None
    assignee: Optional[str] = None
    completed: Optional[bool] = None
    needsReminder: Optional[bool] = None
    notes: Optional[str] = None
    parentId: Optional[str] = None
    sortOrder: Optional[int] = None
    dismissed: Optional[bool] = None
    attachments: Optional[list] = None


class TodosBulkSync(BaseModel):
    todos: List[TodoCreate]


class TodoReorderItem(BaseModel):
    id: str
    sortOrder: int


class TodosBulkReorder(BaseModel):
    updates: List[TodoReorderItem]


@app.get("/api/todos")
async def get_all_todos():
    """Get all todos across all pages (for TodoView global overview)."""
    todos = TodoStorage.get_all()
    return {"success": True, "todos": todos}


@app.get("/api/pages/{page_id}/todos")
async def get_todos(page_id: str):
    """Get all todos for a page."""
    todos = TodoStorage.get_by_page_id(page_id)
    return {"success": True, "todos": todos}


@app.post("/api/pages/{page_id}/todos")
async def create_todo(page_id: str, todo: TodoCreate):
    """Create a new todo."""
    try:
        todo_data = todo.model_dump()
        todo_data['pageId'] = page_id
        created = TodoStorage.create(todo_data)
        return {"success": True, "todo": created}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/pages/{page_id}/todos/sync")
async def sync_todos(page_id: str, data: TodosBulkSync):
    """Bulk sync todos for a page (replaces existing)."""
    try:
        todos_data = [t.model_dump() for t in data.todos]
        count = TodoStorage.bulk_sync(page_id, todos_data)
        return {"success": True, "count": count}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.put("/api/todos/reorder")
async def reorder_todos(data: TodosBulkReorder):
    """Batch update sort_order for multiple todos."""
    try:
        count = TodoStorage.batch_update_sort_order([u.model_dump() for u in data.updates])
        return {"success": True, "count": count}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.put("/api/todos/{todo_id}")
async def update_todo(todo_id: str, data: TodoUpdate):
    """Update a todo. Only fields explicitly sent in the request are updated."""
    # Use model_fields_set to distinguish "not sent" from "sent as null"
    update_data = {k: v for k, v in data.model_dump().items() if k in data.model_fields_set}
    todo = TodoStorage.update(todo_id, update_data)
    if not todo:
        raise HTTPException(status_code=404, detail="Todo not found")
    return {"success": True, "todo": todo}


@app.delete("/api/todos/{todo_id}")
async def delete_todo(todo_id: str):
    """Delete a todo."""
    success = TodoStorage.delete(todo_id)
    if not success:
        raise HTTPException(status_code=404, detail="Todo not found")
    return {"success": True}


# === Reviews API ===

class ReviewCreate(BaseModel):
    date: str
    note: str
    stats: Optional[Dict[str, Any]] = None


@app.get("/api/reviews")
async def get_reviews():
    """Get all daily reviews."""
    reviews = ReviewStorage.get_all()
    return {"success": True, "reviews": reviews}


@app.get("/api/reviews/{date}")
async def get_review(date: str):
    """Get review by date."""
    review = ReviewStorage.get_by_date(date)
    return {"success": True, "review": review}


@app.post("/api/reviews")
async def save_review(data: ReviewCreate):
    """Create or update a daily review."""
    try:
        review = ReviewStorage.create(data.model_dump())
        return {"success": True, "review": review}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/reviews/{date}")
async def delete_review(date: str):
    """Delete a review by date."""
    success = ReviewStorage.delete(date)
    if not success:
        raise HTTPException(status_code=404, detail="Review not found")
    return {"success": True}


# === AI Text to Todos API ===

class TextToTodosRequest(BaseModel):
    text: str
    pageId: Optional[str] = None


@app.post("/api/ai/text-to-todos")
async def text_to_todos(data: TextToTodosRequest):
    """Use AI to extract todos from arbitrary text using structured output."""
    try:
        from .gemini_service import get_gemini_service, TodoItem
        import asyncio

        gemini = get_gemini_service()
        if not gemini.is_available():
            return {"success": False, "error": "Gemini API not available", "todos": []}

        prompt = (
            "请从以下文本中提取所有待办事项。\n"
            "重要规则：如果多个待办事项属于同一件事的不同步骤或子项，"
            "请将它们归组为一个父任务下的 subtasks，而不是拆成独立的待办。\n"
            "如果没有找到待办事项，返回空数组。\n\n"
            f"文本内容：\n{data.text}"
        )

        from google.genai import types
        from pydantic import BaseModel, Field

        class TodoList(BaseModel):
            todos: list[TodoItem] = Field(description="提取的待办事项列表")

        def _run():
            response = gemini.client.models.generate_content(
                model=gemini.model,
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=TodoList,
                    temperature=0.3,
                )
            )
            if response.parsed:
                return response.parsed.model_dump()
            return json.loads(response.text)

        result = await asyncio.to_thread(_run)
        raw_todos = result.get('todos', [])
        todos = flatten_todo_tree(raw_todos)

        return {"success": True, "todos": todos}
    except Exception as e:
        return {"success": False, "error": str(e), "todos": []}


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
        # Read chunk content first
        content = await audio_chunk.read()
        
        # Validate chunk has content
        if len(content) == 0:
            logger.warning(f"Empty audio chunk for {page_id} at {timestamp}")
            return {"success": True, "warning": "empty_chunk", "chunk_id": timestamp}
        
        # Basic WebM validation (check for EBML header)
        if len(content) >= 4:
            # WebM files should start with EBML header (0x1A 0x45 0xDF 0xA3)
            ebml_header = content[:4]
            if ebml_header[0] != 0x1A or ebml_header[1] != 0x45:
                logger.warning(f"Corrupted WebM chunk for {page_id} at {timestamp} (invalid EBML header)")
                # Still save it, but log the warning
                # Don't block the recording process
        
        # Create chunks directory
        DATA_DIR = Path("data")
        chunks_dir = DATA_DIR / page_id / "chunks"
        chunks_dir.mkdir(parents=True, exist_ok=True)
        
        # Save chunk
        chunk_filename = f"chunk_{timestamp}.webm"
        chunk_path = chunks_dir / chunk_filename
        
        with open(chunk_path, 'wb') as f:
            f.write(content)
        
        logger.debug(f"Saved audio chunk for {page_id}: {len(content)} bytes")
        return {"success": True, "chunk_id": timestamp, "size": len(content)}
        
    except Exception as e:
        # Log error but return success to avoid blocking frontend
        logger.error(f"Failed to save audio chunk for {page_id}: {e}")
        return {
            "success": True, 
            "warning": "chunk_save_failed",
            "chunk_id": timestamp,
            "error": str(e)
        }


@app.get("/api/pages/{page_id}/audio")
async def get_audio(page_id: str):
    """Get combined audio for a page (from chunks or full recording)."""
    import logging
    logger = logging.getLogger(__name__)
    data_dir = Path("data") / page_id
    full_path = data_dir / "recording.webm"
    if full_path.exists():
        return FileResponse(full_path, media_type="audio/webm", filename=f"{page_id}.webm")

    chunks_dir = data_dir / "chunks"
    if not chunks_dir.exists():
        raise HTTPException(status_code=404, detail="Audio not found")

    chunk_files = sorted(chunks_dir.glob("chunk_*.webm"))
    if not chunk_files:
        raise HTTPException(status_code=404, detail="Audio not found")

    # Combine chunks into a single file as fallback
    combined_path = data_dir / "recording.webm"
    try:
        with open(combined_path, 'wb') as out:
            for chunk_file in chunk_files:
                out.write(chunk_file.read_bytes())
        return FileResponse(combined_path, media_type="audio/webm", filename=f"{page_id}.webm")
    except Exception as e:
        logger.error(f"Failed to combine audio chunks for {page_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to combine audio chunks")


@app.post("/api/pages/{page_id}/upload")
async def upload_audio(
    page_id: str,
    file: UploadFile = File(...)
):
    """Upload complete audio file for a page."""
    import logging
    logger = logging.getLogger(__name__)

    try:
        # Create page directory
        DATA_DIR = Path("data")
        page_dir = DATA_DIR / page_id
        page_dir.mkdir(parents=True, exist_ok=True)

        # Save as recording.webm
        recording_path = page_dir / "recording.webm"

        content = await file.read()
        with open(recording_path, 'wb') as f:
            f.write(content)

        logger.info(f"Saved audio for {page_id}: {len(content)} bytes")
        return {"success": True, "size": len(content), "path": str(recording_path)}
    except Exception as e:
        logger.error(f"Failed to save audio: {e}")
        raise HTTPException(status_code=500, detail=str(e))


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





# === Transcription API ===

@app.post("/api/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    language: str = Form(default="zh"),
    hotwords: Optional[str] = Form(default=None),
    use_saved_hotwords: bool = Form(default=True),
    async_mode: bool = Form(default=True)
):
    """
    Transcribe an audio file.
    
    Args:
        file: Audio file (webm, mp3, wav, etc.)
        language: Language code (zh, en, ja)
        hotwords: Additional hotwords (space-separated)
        use_saved_hotwords: Whether to include saved hotwords
        async_mode: If True, returns task_id immediately for background processing
        
    Returns:
        If async_mode=True: {"task_id": "...", "status": "pending"}
        If async_mode=False: Transcription result (legacy, blocks request)
    """
    try:
        # Read file content
        content = await file.read()
        
        if len(content) == 0:
            raise HTTPException(status_code=400, detail="Empty audio file")
        
        filename = file.filename or "audio.webm"
        
        # Define transcription function
        def do_transcribe():
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
                filename=filename,
                language=language,
                hotwords=combined_hotwords,
                initial_prompt=initial_prompt
            )
            
            return result
        
        # Async mode: submit to background task
        if async_mode:
            from .task_service import get_task_service
            task_service = get_task_service()
            task_id = task_service.create_task("transcribe", do_transcribe)
            return {
                "task_id": task_id,
                "status": "pending",
                "message": "Transcription started in background"
            }
        
        # Legacy sync mode: block until complete
        result = do_transcribe()
        return result
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/tasks/{task_id}")
async def get_task_status(task_id: str):
    """
    Get the status and result of a background task.
    
    Returns:
        Task status object with result if completed
    """
    from .task_service import get_task_service
    task_service = get_task_service()
    
    task = task_service.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    return task


@app.post("/api/pages/{page_id}/fuse_transcripts")
async def fuse_transcripts(page_id: str, background: bool = True):
    """
    融合多份转录（支持 Web Speech + Streaming + Final 三源融合）

    Args:
        page_id: 页面ID
        background: 是否在后台执行 (默认True,返回task_id)

    Returns:
        task_id if background=True
        fused segments if background=False
    """
    from .fusion_service import get_fusion_service
    from .task_service import get_task_service

    # 获取所有可用的转录版本
    web_speech = SegmentStorage.get_by_page_id(page_id, transcript_version='web_speech')
    streaming = SegmentStorage.get_by_page_id(page_id, transcript_version='streaming')
    final = SegmentStorage.get_by_page_id(page_id, transcript_version='final')
    realtime = SegmentStorage.get_by_page_id(page_id, transcript_version='realtime')

    # 至少需要一个版本
    if not web_speech and not streaming and not final and not realtime:
        raise HTTPException(status_code=404, detail="No transcripts found for this page")

    def do_fusion():
        fusion_service = get_fusion_service()

        # 调用支持多源的融合方法
        result = fusion_service.fuse_transcripts(
            realtime_segments=realtime,
            final_segments=final,
            web_speech_segments=web_speech,
            streaming_segments=streaming
        )

        fused_segments = result.get('segments', [])
        method = result.get('method', 'unknown')

        if not fused_segments:
            return {'success': False, 'error': 'No segments after fusion'}

        # 保存融合版本
        SegmentStorage.bulk_create(page_id, fused_segments, transcript_version='fused')

        # 更新页面元数据（包含所有版本信息）
        versions = {}
        if web_speech:
            versions['web_speech'] = {'segmentCount': len(web_speech), 'status': 'completed'}
        if streaming:
            versions['streaming'] = {'segmentCount': len(streaming), 'status': 'completed'}
        if final:
            versions['final'] = {'segmentCount': len(final), 'status': 'completed'}
        if realtime:
            versions['realtime'] = {'segmentCount': len(realtime), 'status': 'completed'}
        versions['fused'] = {'segmentCount': len(fused_segments), 'status': 'completed', 'method': method}

        PageStorage.update(page_id, {
            'transcriptVersions': versions,
            'activeVersion': 'fused'
        })

        return {
            'success': True,
            'segmentCount': len(fused_segments),
            'method': method,
            'sources': list(versions.keys()),
            'fusion_notes': result.get('fusion_notes')
        }

    if background:
        task_service = get_task_service()
        task_id = task_service.create_task('fuse_transcripts', do_fusion)
        return {'task_id': task_id, 'status': 'pending'}
    else:
        return do_fusion()


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
    notes: Optional[str] = None  # 用户录音时记录的笔记
    

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
        # 如果有笔记，附加到转录内容中
        content_to_analyze = request.transcript
        if request.notes:
            content_to_analyze += f"\n\n---\n【会议笔记（人工记录）】\n{request.notes}\n---"

        result = await service.analyze_meeting(content_to_analyze)
        # Flatten nested todos (subtasks) for frontend compatibility
        if 'todos' in result:
            result['todos'] = flatten_todo_tree(result['todos'])
        return {
            "success": True,
            **result
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
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
    
    # Initialize task service
    from .task_service import get_task_service
    task_service = get_task_service()
    print("✅ Background task service initialized")
    
    print("API ready!")


@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown."""
    from .task_service import get_task_service
    task_service = get_task_service()
    task_service.shutdown()
    print("Task service shutdown complete")


# === Main Entry ===

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=6543)
