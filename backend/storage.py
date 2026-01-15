"""
Storage Service - SQLite database for pages and segments
支持跨设备数据同步，使用软删除
"""

import sqlite3
import json
import os
from datetime import datetime
from typing import Optional, List, Dict, Any
from contextlib import contextmanager

# Database path
DB_PATH = os.path.join(os.path.dirname(__file__), "data", "meeting.db")


def get_db_path():
    """Get database path, ensure directory exists."""
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    return DB_PATH


@contextmanager
def get_connection():
    """Get a database connection with context manager."""
    conn = sqlite3.connect(get_db_path())
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    """Initialize database tables."""
    with get_connection() as conn:
        cursor = conn.cursor()
        
        # Pages table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS pages (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                duration INTEGER DEFAULT 0,
                status TEXT DEFAULT 'completed',
                language TEXT DEFAULT 'zh-CN',
                deleted_at TEXT DEFAULT NULL
            )
        """)
        
        # Segments table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS segments (
                id TEXT PRIMARY KEY,
                page_id TEXT NOT NULL,
                text TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                end_time INTEGER,
                confidence REAL DEFAULT 0,
                is_final INTEGER DEFAULT 1,
                speaker TEXT,
                speaker_label TEXT,
                speaker_color TEXT,
                words TEXT,
                source TEXT DEFAULT 'web_speech',
                created_at TEXT NOT NULL,
                deleted_at TEXT DEFAULT NULL,
                FOREIGN KEY (page_id) REFERENCES pages(id)
            )
        """)
        
        # Create indexes
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_segments_page_id ON segments(page_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_pages_deleted_at ON pages(deleted_at)")


# Initialize on import
init_db()


class PageStorage:
    """Page CRUD operations with soft delete."""
    
    @staticmethod
    def create(page_data: Dict[str, Any]) -> Dict[str, Any]:
        """Create a new page."""
        now = datetime.now().isoformat()
        with get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO pages (id, title, created_at, updated_at, duration, status, language)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                page_data.get('id'),
                page_data.get('title') or '未命名录音',
                page_data.get('createdAt') or now,
                now,
                page_data.get('duration') or 0,
                page_data.get('status') or 'completed',
                page_data.get('language') or 'zh-CN'
            ))
        return PageStorage.get_by_id(page_data['id'])
    
    @staticmethod
    def get_all(include_deleted: bool = False) -> List[Dict[str, Any]]:
        """Get all pages (excluding soft-deleted by default)."""
        with get_connection() as conn:
            cursor = conn.cursor()
            if include_deleted:
                cursor.execute("SELECT * FROM pages ORDER BY created_at DESC")
            else:
                cursor.execute("SELECT * FROM pages WHERE deleted_at IS NULL ORDER BY created_at DESC")
            rows = cursor.fetchall()
            return [PageStorage._row_to_dict(row) for row in rows]
    
    @staticmethod
    def get_by_id(page_id: str) -> Optional[Dict[str, Any]]:
        """Get a single page by ID."""
        with get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM pages WHERE id = ?", (page_id,))
            row = cursor.fetchone()
            return PageStorage._row_to_dict(row) if row else None
    
    @staticmethod
    def update(page_id: str, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Update a page."""
        now = datetime.now().isoformat()
        with get_connection() as conn:
            cursor = conn.cursor()
            
            # Build dynamic update query
            fields = []
            values = []
            for key, value in data.items():
                if key in ('title', 'duration', 'status', 'language'):
                    db_key = key
                    fields.append(f"{db_key} = ?")
                    values.append(value)
            
            if fields:
                fields.append("updated_at = ?")
                values.append(now)
                values.append(page_id)
                
                cursor.execute(f"UPDATE pages SET {', '.join(fields)} WHERE id = ?", values)
        
        return PageStorage.get_by_id(page_id)
    
    @staticmethod
    def soft_delete(page_id: str) -> bool:
        """Soft delete a page (set deleted_at timestamp)."""
        now = datetime.now().isoformat()
        with get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("UPDATE pages SET deleted_at = ? WHERE id = ?", (now, page_id))
            # Also soft delete associated segments
            cursor.execute("UPDATE segments SET deleted_at = ? WHERE page_id = ?", (now, page_id))
            return cursor.rowcount > 0
    
    @staticmethod
    def restore(page_id: str) -> bool:
        """Restore a soft-deleted page."""
        with get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("UPDATE pages SET deleted_at = NULL WHERE id = ?", (page_id,))
            cursor.execute("UPDATE segments SET deleted_at = NULL WHERE page_id = ?", (page_id,))
            return cursor.rowcount > 0
    
    @staticmethod
    def _row_to_dict(row: sqlite3.Row) -> Dict[str, Any]:
        """Convert sqlite row to dict with camelCase keys."""
        return {
            'id': row['id'],
            'title': row['title'],
            'createdAt': row['created_at'],
            'updatedAt': row['updated_at'],
            'duration': row['duration'],
            'status': row['status'],
            'language': row['language'],
            'deletedAt': row['deleted_at']
        }


class SegmentStorage:
    """Segment CRUD operations."""
    
    @staticmethod
    def create(segment_data: Dict[str, Any]) -> Dict[str, Any]:
        """Create a new segment."""
        now = datetime.now().isoformat()
        words_json = json.dumps(segment_data.get('words')) if segment_data.get('words') else None
        
        with get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO segments (id, page_id, text, timestamp, end_time, confidence, 
                    is_final, speaker, speaker_label, speaker_color, words, source, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                segment_data.get('id'),
                segment_data.get('pageId'),
                segment_data.get('text', ''),
                segment_data.get('timestamp', 0),
                segment_data.get('endTime'),
                segment_data.get('confidence', 0),
                1 if segment_data.get('isFinal', True) else 0,
                segment_data.get('speaker'),
                segment_data.get('speakerLabel'),
                segment_data.get('speakerColor'),
                words_json,
                segment_data.get('source', 'web_speech'),
                now
            ))
        return segment_data
    
    @staticmethod
    def bulk_create(page_id: str, segments: List[Dict[str, Any]]) -> int:
        """Bulk create segments for a page."""
        now = datetime.now().isoformat()
        with get_connection() as conn:
            cursor = conn.cursor()
            
            # Delete existing segments for this page first (replace strategy)
            cursor.execute("DELETE FROM segments WHERE page_id = ?", (page_id,))
            
            for seg in segments:
                words_json = json.dumps(seg.get('words')) if seg.get('words') else None
                cursor.execute("""
                    INSERT INTO segments (id, page_id, text, timestamp, end_time, confidence,
                        is_final, speaker, speaker_label, speaker_color, words, source, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    seg.get('id'),
                    page_id,
                    seg.get('text', ''),
                    seg.get('timestamp', 0),
                    seg.get('endTime'),
                    seg.get('confidence', 0),
                    1 if seg.get('isFinal', True) else 0,
                    seg.get('speaker'),
                    seg.get('speakerLabel'),
                    seg.get('speakerColor'),
                    words_json,
                    seg.get('source', 'web_speech'),
                    now
                ))
        return len(segments)
    
    @staticmethod
    def get_by_page_id(page_id: str, include_deleted: bool = False) -> List[Dict[str, Any]]:
        """Get all segments for a page."""
        with get_connection() as conn:
            cursor = conn.cursor()
            if include_deleted:
                cursor.execute("SELECT * FROM segments WHERE page_id = ? ORDER BY timestamp", (page_id,))
            else:
                cursor.execute(
                    "SELECT * FROM segments WHERE page_id = ? AND deleted_at IS NULL ORDER BY timestamp",
                    (page_id,)
                )
            rows = cursor.fetchall()
            return [SegmentStorage._row_to_dict(row) for row in rows]
    
    @staticmethod
    def delete_by_page_id(page_id: str) -> int:
        """Hard delete all segments for a page."""
        with get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM segments WHERE page_id = ?", (page_id,))
            return cursor.rowcount
    
    @staticmethod
    def _row_to_dict(row: sqlite3.Row) -> Dict[str, Any]:
        """Convert sqlite row to dict with camelCase keys."""
        words = None
        if row['words']:
            try:
                words = json.loads(row['words'])
            except json.JSONDecodeError:
                words = None
        
        return {
            'id': row['id'],
            'pageId': row['page_id'],
            'text': row['text'],
            'timestamp': row['timestamp'],
            'endTime': row['end_time'],
            'confidence': row['confidence'],
            'isFinal': bool(row['is_final']),
            'speaker': row['speaker'],
            'speakerLabel': row['speaker_label'],
            'speakerColor': row['speaker_color'],
            'words': words,
            'source': row['source'],
            'createdAt': row['created_at']
        }
