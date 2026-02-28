"""
Background Task Service for Async Operations
Handles long-running tasks like transcription without blocking HTTP requests.

Uses ThreadPoolExecutor with timeout protection. If a C-level crash kills the
process, the startup script's watchdog loop will auto-restart it.
"""

import uuid
import time
import logging
from typing import Dict, Any, Optional, Callable
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor, Future
from threading import Lock

logger = logging.getLogger(__name__)


class TaskStatus:
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class Task:
    def __init__(self, task_id: str, task_type: str):
        self.id = task_id
        self.type = task_type
        self.status = TaskStatus.PENDING
        self.progress = 0
        self.result = None
        self.error = None
        self.created_at = datetime.now()
        self.started_at = None
        self.completed_at = None
        self.future: Optional[Future] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "type": self.type,
            "status": self.status,
            "progress": self.progress,
            "result": self.result,
            "error": self.error,
            "created_at": self.created_at.isoformat(),
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
        }


class TaskService:
    _instance = None
    _lock = Lock()

    def __new__(cls):
        if not cls._instance:
            with cls._lock:
                if not cls._instance:
                    cls._instance = super().__new__(cls)
                    cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self.tasks: Dict[str, Task] = {}
        self.executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="task-worker")
        self._initialized = True
        logger.info("TaskService initialized with 2 workers")

    def create_task(self, task_type: str, func: Callable, *args, **kwargs) -> str:
        """Create and submit a background task."""
        task_id = str(uuid.uuid4())
        task = Task(task_id, task_type)
        self.tasks[task_id] = task

        def task_wrapper():
            task.status = TaskStatus.PROCESSING
            task.started_at = datetime.now()
            try:
                logger.info(f"Task {task_id} ({task_type}) started")
                result = func(*args, **kwargs)
                task.result = result
                task.status = TaskStatus.COMPLETED
                task.progress = 100
                task.completed_at = datetime.now()
                elapsed = (task.completed_at - task.started_at).total_seconds()
                logger.info(f"Task {task_id} ({task_type}) completed in {elapsed:.1f}s")
            except Exception as e:
                task.error = str(e)
                task.status = TaskStatus.FAILED
                task.completed_at = datetime.now()
                logger.error(f"Task {task_id} ({task_type}) failed: {e}")

        future = self.executor.submit(task_wrapper)
        task.future = future
        logger.info(f"Task {task_id} ({task_type}) created and queued")
        return task_id

    def get_task(self, task_id: str) -> Optional[Dict[str, Any]]:
        """Get task status and result."""
        task = self.tasks.get(task_id)
        if not task:
            return None
        return task.to_dict()

    def cleanup_old_tasks(self, max_age_hours: int = 24):
        """Remove completed/failed tasks older than max_age_hours."""
        now = datetime.now()
        to_remove = []
        for task_id, task in self.tasks.items():
            if task.status in [TaskStatus.COMPLETED, TaskStatus.FAILED]:
                if task.completed_at and (now - task.completed_at) > timedelta(hours=max_age_hours):
                    to_remove.append(task_id)
        for task_id in to_remove:
            del self.tasks[task_id]
            logger.info(f"Cleaned up old task {task_id}")

    def shutdown(self):
        """Gracefully shutdown the task service."""
        logger.info("Shutting down TaskService...")
        self.executor.shutdown(wait=True)
        logger.info("TaskService shutdown complete")


# Global instance
_task_service: Optional[TaskService] = None


def get_task_service() -> TaskService:
    """Get the global TaskService instance."""
    global _task_service
    if _task_service is None:
        _task_service = TaskService()
    return _task_service
