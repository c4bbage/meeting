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
                auto_title TEXT DEFAULT NULL,
                summary TEXT DEFAULT NULL,
                key_points TEXT DEFAULT NULL,
                decisions TEXT DEFAULT NULL,
                todos TEXT DEFAULT NULL,
                todo_count INTEGER DEFAULT 0,
                word_count INTEGER DEFAULT 0,
                analyzed INTEGER DEFAULT 0,
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
        
        # Speaker data table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS speaker_data (
                page_id TEXT PRIMARY KEY,
                data TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (page_id) REFERENCES pages(id)
            )
        """)

        # Todos table (independent storage for better sync)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS todos (
                id TEXT PRIMARY KEY,
                page_id TEXT NOT NULL,
                content TEXT NOT NULL,
                category TEXT DEFAULT 'other',
                deadline TEXT,
                priority TEXT DEFAULT 'medium',
                assignee TEXT,
                completed INTEGER DEFAULT 0,
                needs_reminder INTEGER DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                deleted_at TEXT DEFAULT NULL,
                FOREIGN KEY (page_id) REFERENCES pages(id)
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_todos_page_id ON todos(page_id)")

        # Create indexes
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_segments_page_id ON segments(page_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_pages_deleted_at ON pages(deleted_at)")

        # Ensure new columns exist on older databases
        cursor.execute("PRAGMA table_info(pages)")
        existing_columns = {row[1] for row in cursor.fetchall()}
        columns_to_add = {
            "auto_title": "TEXT DEFAULT NULL",
            "summary": "TEXT DEFAULT NULL",
            "key_points": "TEXT DEFAULT NULL",
            "decisions": "TEXT DEFAULT NULL",
            "todos": "TEXT DEFAULT NULL",
            "todo_count": "INTEGER DEFAULT 0",
            "word_count": "INTEGER DEFAULT 0",
            "analyzed": "INTEGER DEFAULT 0"
        }
        for column, definition in columns_to_add.items():
            if column not in existing_columns:
                cursor.execute(f"ALTER TABLE pages ADD COLUMN {column} {definition}")


# Initialize on import
init_db()


def _serialize_json(value: Any) -> Optional[str]:
    if value is None:
        return None
    return json.dumps(value, ensure_ascii=False)


def _parse_json(value: Optional[str], default: Any):
    if not value:
        return default
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return default


def _row_value(row: sqlite3.Row, key: str, default: Any = None):
    return row[key] if key in row.keys() else default


class PageStorage:
    """Page CRUD operations with soft delete."""
    
    @staticmethod
    def create(page_data: Dict[str, Any]) -> Dict[str, Any]:
        """Create a new page."""
        now = datetime.now().isoformat()
        key_points = _serialize_json(page_data.get('keyPoints') or page_data.get('key_points'))
        decisions = _serialize_json(page_data.get('decisions'))
        todos = _serialize_json(page_data.get('todos'))
        analyzed = 1 if page_data.get('analyzed') else 0
        with get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO pages (
                    id, title, created_at, updated_at, duration, status, language,
                    auto_title, summary, key_points, decisions, todos, todo_count, word_count, analyzed
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                page_data.get('id'),
                page_data.get('title') or '未命名录音',
                page_data.get('createdAt') or now,
                now,
                page_data.get('duration') or 0,
                page_data.get('status') or 'completed',
                page_data.get('language') or 'zh-CN',
                page_data.get('autoTitle'),
                page_data.get('summary'),
                key_points,
                decisions,
                todos,
                page_data.get('todoCount') or 0,
                page_data.get('wordCount') or 0,
                analyzed
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
                elif key == 'autoTitle':
                    db_key = 'auto_title'
                elif key == 'summary':
                    db_key = 'summary'
                elif key == 'keyPoints':
                    db_key = 'key_points'
                    value = _serialize_json(value)
                elif key == 'decisions':
                    db_key = 'decisions'
                    value = _serialize_json(value)
                elif key == 'todos':
                    db_key = 'todos'
                    value = _serialize_json(value)
                elif key == 'todoCount':
                    db_key = 'todo_count'
                elif key == 'wordCount':
                    db_key = 'word_count'
                elif key == 'analyzed':
                    db_key = 'analyzed'
                    value = 1 if value else 0
                else:
                    continue
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
            'autoTitle': _row_value(row, 'auto_title'),
            'summary': _row_value(row, 'summary'),
            'keyPoints': _parse_json(_row_value(row, 'key_points'), []),
            'decisions': _parse_json(_row_value(row, 'decisions'), []),
            'todos': _parse_json(_row_value(row, 'todos'), []),
            'todoCount': _row_value(row, 'todo_count', 0),
            'wordCount': _row_value(row, 'word_count', 0),
            'analyzed': bool(_row_value(row, 'analyzed', 0)),
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
    def search_page_ids_by_text(query: str, include_deleted: bool = False) -> List[str]:
        """Find page IDs whose final segments contain the query text."""
        trimmed = (query or "").strip().lower()
        if not trimmed:
            return []

        like_query = f"%{trimmed}%"
        with get_connection() as conn:
            cursor = conn.cursor()
            if include_deleted:
                cursor.execute(
                    "SELECT DISTINCT page_id FROM segments "
                    "WHERE is_final = 1 AND LOWER(text) LIKE ?",
                    (like_query,)
                )
            else:
                cursor.execute(
                    "SELECT DISTINCT page_id FROM segments "
                    "WHERE deleted_at IS NULL AND is_final = 1 AND LOWER(text) LIKE ?",
                    (like_query,)
                )
            rows = cursor.fetchall()
            return [row["page_id"] for row in rows]
    
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


class SpeakerDataStorage:
    """Speaker data storage operations."""

    @staticmethod
    def save(page_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """Save or update speaker data for a page."""
        now = datetime.now().isoformat()
        data_json = json.dumps(data, ensure_ascii=False)

        with get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT page_id FROM speaker_data WHERE page_id = ?",
                (page_id,)
            )
            existing = cursor.fetchone()

            if existing:
                cursor.execute(
                    "UPDATE speaker_data SET data = ?, updated_at = ? WHERE page_id = ?",
                    (data_json, now, page_id)
                )
            else:
                cursor.execute(
                    "INSERT INTO speaker_data (page_id, data, created_at, updated_at) VALUES (?, ?, ?, ?)",
                    (page_id, data_json, now, now)
                )

        return SpeakerDataStorage.get(page_id)

    @staticmethod
    def get(page_id: str) -> Optional[Dict[str, Any]]:
        """Get speaker data for a page."""
        with get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT * FROM speaker_data WHERE page_id = ?",
                (page_id,)
            )
            row = cursor.fetchone()
            if not row:
                return None

            return {
                'pageId': row['page_id'],
                'data': json.loads(row['data']),
                'createdAt': row['created_at'],
                'updatedAt': row['updated_at']
            }

    @staticmethod
    def delete(page_id: str) -> bool:
        """Delete speaker data for a page."""
        with get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "DELETE FROM speaker_data WHERE page_id = ?",
                (page_id,)
            )
            return cursor.rowcount > 0


class TodoStorage:
    """Todo CRUD operations."""

    @staticmethod
    def create(todo_data: Dict[str, Any]) -> Dict[str, Any]:
        """Create a new todo."""
        now = datetime.now().isoformat()
        with get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO todos (
                    id, page_id, content, category, deadline, priority,
                    assignee, completed, needs_reminder, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                todo_data.get('id'),
                todo_data.get('pageId'),
                todo_data.get('content', ''),
                todo_data.get('category', 'other'),
                todo_data.get('deadline'),
                todo_data.get('priority', 'medium'),
                todo_data.get('assignee'),
                1 if todo_data.get('completed') else 0,
                1 if todo_data.get('needsReminder') else 0,
                todo_data.get('createdAt') or now,
                now
            ))
        return TodoStorage.get_by_id(todo_data['id'])

    @staticmethod
    def get_by_id(todo_id: str) -> Optional[Dict[str, Any]]:
        """Get a single todo by ID."""
        with get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM todos WHERE id = ? AND deleted_at IS NULL", (todo_id,))
            row = cursor.fetchone()
            return TodoStorage._row_to_dict(row) if row else None

    @staticmethod
    def get_by_page_id(page_id: str) -> List[Dict[str, Any]]:
        """Get all todos for a page."""
        with get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT * FROM todos WHERE page_id = ? AND deleted_at IS NULL ORDER BY created_at",
                (page_id,)
            )
            rows = cursor.fetchall()
            return [TodoStorage._row_to_dict(row) for row in rows]

    @staticmethod
    def update(todo_id: str, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Update a todo."""
        now = datetime.now().isoformat()
        with get_connection() as conn:
            cursor = conn.cursor()

            fields = []
            values = []
            for key, value in data.items():
                if key == 'content':
                    fields.append("content = ?")
                    values.append(value)
                elif key == 'category':
                    fields.append("category = ?")
                    values.append(value)
                elif key == 'deadline':
                    fields.append("deadline = ?")
                    values.append(value)
                elif key == 'priority':
                    fields.append("priority = ?")
                    values.append(value)
                elif key == 'assignee':
                    fields.append("assignee = ?")
                    values.append(value)
                elif key == 'completed':
                    fields.append("completed = ?")
                    values.append(1 if value else 0)
                elif key == 'needsReminder':
                    fields.append("needs_reminder = ?")
                    values.append(1 if value else 0)

            if fields:
                fields.append("updated_at = ?")
                values.append(now)
                values.append(todo_id)

                cursor.execute(
                    f"UPDATE todos SET {', '.join(fields)} WHERE id = ?",
                    values
                )

        return TodoStorage.get_by_id(todo_id)

    @staticmethod
    def delete(todo_id: str) -> bool:
        """Soft delete a todo."""
        now = datetime.now().isoformat()
        with get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "UPDATE todos SET deleted_at = ? WHERE id = ?",
                (now, todo_id)
            )
            return cursor.rowcount > 0

    @staticmethod
    def bulk_sync(page_id: str, todos: List[Dict[str, Any]]) -> int:
        """Bulk sync todos for a page (replaces existing)."""
        now = datetime.now().isoformat()
        with get_connection() as conn:
            cursor = conn.cursor()

            # Delete existing todos for this page
            cursor.execute("DELETE FROM todos WHERE page_id = ?", (page_id,))

            # Insert new todos
            for todo in todos:
                cursor.execute("""
                    INSERT INTO todos (
                        id, page_id, content, category, deadline, priority,
                        assignee, completed, needs_reminder, created_at, updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    todo.get('id'),
                    page_id,
                    todo.get('content', ''),
                    todo.get('category', 'other'),
                    todo.get('deadline'),
                    todo.get('priority', 'medium'),
                    todo.get('assignee'),
                    1 if todo.get('completed') else 0,
                    1 if todo.get('needsReminder') else 0,
                    todo.get('createdAt') or now,
                    todo.get('updatedAt') or now
                ))

        return len(todos)

    @staticmethod
    def _row_to_dict(row: sqlite3.Row) -> Dict[str, Any]:
        """Convert sqlite row to dict with camelCase keys."""
        return {
            'id': row['id'],
            'pageId': row['page_id'],
            'content': row['content'],
            'category': row['category'],
            'deadline': row['deadline'],
            'priority': row['priority'],
            'assignee': row['assignee'],
            'completed': bool(row['completed']),
            'needsReminder': bool(row['needs_reminder']),
            'createdAt': row['created_at'],
            'updatedAt': row['updated_at']
        }
