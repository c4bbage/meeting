import { useState, useMemo, useCallback } from 'react';

function parseNotes(raw) {
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
    } catch { /* legacy plain text */ }
    return raw.trim() ? [{ time: null, text: raw.trim() }] : [];
}

function formatNoteTime(iso) {
    if (!iso) return '(旧记录)';
    const d = new Date(iso);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${mm}-${dd} ${hh}:${mi}`;
}

function TodoBoardView({ todos, onUpdateCategory, onToggleComplete, onAddTodo, onDelete, onUpdateContent, onAddNote }) {
    const [draggedTodo, setDraggedTodo] = useState(null);
    const [dragOverColumn, setDragOverColumn] = useState(null);
    const [newColumnName, setNewColumnName] = useState('');
    const [showNewColumn, setShowNewColumn] = useState(false);
    const [customColumns, setCustomColumns] = useState([]);
    const [columnAddText, setColumnAddText] = useState({}); // { category: text }
    const [expandedNotes, setExpandedNotes] = useState(new Set());
    const [quickNoteId, setQuickNoteId] = useState(null);
    const [quickNoteText, setQuickNoteText] = useState('');
    const [editingId, setEditingId] = useState(null);
    const [editingText, setEditingText] = useState('');

    // Build parent -> children map
    const childTodosMap = useMemo(() => {
        const map = new Map();
        todos.forEach(todo => {
            if (todo.parentId) {
                if (!map.has(todo.parentId)) map.set(todo.parentId, []);
                map.get(todo.parentId).push(todo);
            }
        });
        return map;
    }, [todos]);

    // Group top-level todos by category (exclude sub-tasks)
    const columns = useMemo(() => {
        const map = new Map();
        // Add custom empty columns first
        customColumns.forEach(col => {
            if (!map.has(col)) map.set(col, []);
        });
        // Group existing todos (skip sub-tasks)
        todos.forEach(todo => {
            if (todo.parentId) return;
            const cat = todo.category || '未分类';
            if (!map.has(cat)) map.set(cat, []);
            map.get(cat).push(todo);
        });
        // Ensure at least some default columns
        if (map.size === 0) {
            map.set('任务', []);
            map.set('跟进', []);
            map.set('已完成', []);
        }
        return map;
    }, [todos, customColumns]);

    const handleDragStart = useCallback((e, todo) => {
        setDraggedTodo(todo);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', todo.id);
        // Add drag styling after a tick
        requestAnimationFrame(() => {
            e.target.classList.add('todo-board-card-dragging');
        });
    }, []);

    const handleDragEnd = useCallback((e) => {
        e.target.classList.remove('todo-board-card-dragging');
        setDraggedTodo(null);
        setDragOverColumn(null);
    }, []);

    const handleDragOver = useCallback((e, category) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDragOverColumn(category);
    }, []);

    const handleDragLeave = useCallback(() => {
        setDragOverColumn(null);
    }, []);

    const handleDrop = useCallback((e, targetCategory) => {
        e.preventDefault();
        setDragOverColumn(null);
        if (draggedTodo && draggedTodo.category !== targetCategory) {
            onUpdateCategory(draggedTodo.id, targetCategory);
        }
        setDraggedTodo(null);
    }, [draggedTodo, onUpdateCategory]);

    const handleAddColumn = () => {
        const name = newColumnName.trim();
        if (!name) return;
        if (columns.has(name)) {
            alert('该分类已存在');
            return;
        }
        setCustomColumns(prev => [...prev, name]);
        setNewColumnName('');
        setShowNewColumn(false);
    };

    const handleEditSave = useCallback((todoId) => {
        const text = editingText.trim();
        if (text && onUpdateContent) {
            onUpdateContent(todoId, text);
        }
        setEditingId(null);
        setEditingText('');
    }, [editingText, onUpdateContent]);

    const toggleNoteExpand = useCallback((todoId) => {
        setExpandedNotes(prev => {
            const next = new Set(prev);
            if (next.has(todoId)) next.delete(todoId);
            else next.add(todoId);
            return next;
        });
    }, []);

    const handleQuickNoteSave = useCallback((todoId) => {
        if (!quickNoteText.trim() || !onAddNote) { setQuickNoteId(null); return; }
        onAddNote(todoId, quickNoteText.trim());
        setQuickNoteId(null);
        setQuickNoteText('');
    }, [quickNoteText, onAddNote]);

    return (
        <div className="todo-board">
            <div className="todo-board-header">
                <h3>📌 看板视图</h3>
                <button
                    className="btn btn-sm btn-secondary"
                    onClick={() => setShowNewColumn(!showNewColumn)}
                >
                    + 新建分类
                </button>
            </div>

            {showNewColumn && (
                <div className="todo-board-new-column">
                    <input
                        className="input"
                        type="text"
                        placeholder="分类名称"
                        value={newColumnName}
                        onChange={(e) => setNewColumnName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddColumn()}
                        autoFocus
                    />
                    <button className="btn btn-sm btn-primary" onClick={handleAddColumn}>
                        添加
                    </button>
                    <button className="btn btn-sm btn-secondary" onClick={() => setShowNewColumn(false)}>
                        取消
                    </button>
                </div>
            )}

            <div className="todo-board-columns">
                {Array.from(columns.entries()).map(([category, categoryTodos]) => (
                    <div
                        key={category}
                        className={`todo-board-column ${dragOverColumn === category ? 'todo-board-column-dragover' : ''}`}
                        onDragOver={(e) => handleDragOver(e, category)}
                        onDragLeave={handleDragLeave}
                        onDrop={(e) => handleDrop(e, category)}
                    >
                        <div className="todo-board-column-header">
                            <span className="todo-board-column-title">
                                🏷️ {category}
                            </span>
                            <span className="todo-board-column-count">
                                {categoryTodos.length}
                            </span>
                        </div>

                        <div className="todo-board-column-body">
                            {categoryTodos.map(todo => {
                                const isOverdue = !todo.completed && todo.deadline && new Date(todo.deadline) < new Date(new Date().toDateString());
                                return (
                                <div
                                    key={todo.id}
                                    className={`todo-board-card ${todo.completed ? 'todo-board-card-completed' : ''} ${isOverdue ? 'overdue' : ''}`}
                                    draggable
                                    onDragStart={(e) => handleDragStart(e, todo)}
                                    onDragEnd={handleDragEnd}
                                >
                                    {onDelete && (
                                        <button
                                            className="todo-board-card-delete"
                                            onClick={(e) => { e.stopPropagation(); onDelete(todo); }}
                                            title="删除"
                                        >×</button>
                                    )}
                                    <div className="todo-board-card-top">
                                        <label className="todo-board-card-check">
                                            <input
                                                type="checkbox"
                                                checked={todo.completed}
                                                onChange={() => onToggleComplete(todo)}
                                            />
                                        </label>
                                        {editingId === todo.id ? (
                                            <input
                                                className="input input-sm todo-board-card-edit"
                                                type="text"
                                                value={editingText}
                                                onChange={(e) => setEditingText(e.target.value)}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') handleEditSave(todo.id);
                                                    if (e.key === 'Escape') { setEditingId(null); setEditingText(''); }
                                                }}
                                                onBlur={() => handleEditSave(todo.id)}
                                                autoFocus
                                            />
                                        ) : (
                                            <span
                                                className="todo-board-card-text"
                                                onDoubleClick={() => {
                                                    if (onUpdateContent) {
                                                        setEditingId(todo.id);
                                                        setEditingText(todo.content);
                                                    }
                                                }}
                                            >
                                                {todo.content}
                                            </span>
                                        )}
                                    </div>
                                    <div className="todo-board-card-meta">
                                        {todo.priority && (
                                            <span className={`priority-badge priority-${todo.priority}`}>
                                                {todo.priority}
                                            </span>
                                        )}
                                        {todo.assignee && (
                                            <span className="todo-board-card-assignee">
                                                👤 {todo.assignee}
                                            </span>
                                        )}
                                        {todo.deadline && (
                                            <span className="todo-board-card-deadline">
                                                📅 {todo.deadline}
                                            </span>
                                        )}
                                        {isOverdue && (
                                            <span className="todo-board-card-overdue">⚠️ 逾期</span>
                                        )}
                                    </div>
                                    {(() => {
                                        const entries = parseNotes(todo.notes);
                                        if (entries.length === 0) return null;
                                        const isNoteExpanded = expandedNotes.has(todo.id);
                                        const latest = entries[entries.length - 1];
                                        return (
                                            <div className="todo-board-card-notes">
                                                <div
                                                    className="todo-notes-header"
                                                    onClick={(e) => { e.stopPropagation(); entries.length > 1 && toggleNoteExpand(todo.id); }}
                                                    style={{ cursor: entries.length > 1 ? 'pointer' : 'default' }}
                                                >
                                                    <span className="todo-notes-label">
                                                        📝 {entries.length > 1 && `(${entries.length})`}
                                                        {entries.length > 1 && (isNoteExpanded ? ' ▾' : ' ▸')}
                                                    </span>
                                                    {!isNoteExpanded && (
                                                        <span className="todo-notes-latest">
                                                            <span className="todo-notes-time">{formatNoteTime(latest.time)}</span>
                                                            {' '}{latest.text}
                                                        </span>
                                                    )}
                                                </div>
                                                {isNoteExpanded && (
                                                    <div className="todo-notes-history">
                                                        {[...entries].reverse().map((entry, i) => (
                                                            <div key={i} className="todo-notes-entry">
                                                                <span className="todo-notes-time">{formatNoteTime(entry.time)}</span>
                                                                <span className="todo-notes-text">{entry.text}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })()}
                                    {onAddNote && (
                                        <>
                                            {quickNoteId !== todo.id && (
                                                <button
                                                    className="btn btn-sm btn-secondary todo-board-card-note-btn"
                                                    onClick={(e) => { e.stopPropagation(); setQuickNoteId(todo.id); setQuickNoteText(''); }}
                                                >
                                                    📝 备注
                                                </button>
                                            )}
                                            {quickNoteId === todo.id && (
                                                <div className="todo-board-card-note-input" onClick={(e) => e.stopPropagation()}>
                                                    <input
                                                        className="input input-sm"
                                                        type="text"
                                                        placeholder="添加进度备注..."
                                                        value={quickNoteText}
                                                        onChange={(e) => setQuickNoteText(e.target.value)}
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter') handleQuickNoteSave(todo.id);
                                                            if (e.key === 'Escape') setQuickNoteId(null);
                                                        }}
                                                        autoFocus
                                                    />
                                                    <button className="btn btn-sm btn-primary" onClick={() => handleQuickNoteSave(todo.id)}>保存</button>
                                                </div>
                                            )}
                                        </>
                                    )}
                                    {childTodosMap.has(todo.id) && (
                                        <div className="todo-board-card-subtasks">
                                            {childTodosMap.get(todo.id).map(child => (
                                                <label key={child.id} className={`todo-board-subtask ${child.completed ? 'todo-board-subtask-done' : ''}`}>
                                                    <input
                                                        type="checkbox"
                                                        checked={child.completed}
                                                        onChange={() => onToggleComplete(child)}
                                                    />
                                                    <span>{child.content}</span>
                                                </label>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                );
                            })}

                            {categoryTodos.length === 0 && (
                                <div className="todo-board-empty">
                                    拖拽任务到此分类
                                </div>
                            )}

                            {onAddTodo && (
                                <div className="todo-board-column-add">
                                    <input
                                        className="input input-sm"
                                        type="text"
                                        placeholder="+ 添加任务..."
                                        value={columnAddText[category] || ''}
                                        onChange={(e) => setColumnAddText(prev => ({ ...prev, [category]: e.target.value }))}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' && columnAddText[category]?.trim()) {
                                                onAddTodo(columnAddText[category].trim(), category);
                                                setColumnAddText(prev => ({ ...prev, [category]: '' }));
                                            }
                                        }}
                                    />
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

export default TodoBoardView;
