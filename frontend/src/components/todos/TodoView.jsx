import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageService, TodoService, AITodoService } from '../../services/Database';
import { usePageStore } from '../../store/pageStore';
import { formatDateTime } from '../../utils/helpers';
import TodoCalendarView from './TodoCalendarView';
import TodoAnalytics from './TodoAnalytics';
import TodoDailyReview from './TodoDailyReview';
import TodoBoardView from './TodoBoardView';

const PRIORITY_OPTIONS = ['高', '中', '低'];
const PAGE_SIZE_OPTIONS = [10, 20, 50];

// --- Timestamped notes helpers ---
function parseNotes(raw) {
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
    } catch { /* not JSON, legacy plain text */ }
    // Legacy plain-text note → wrap as single entry
    return raw.trim() ? [{ time: null, text: raw.trim() }] : [];
}

function serializeNotes(entries) {
    if (!entries || entries.length === 0) return '';
    return JSON.stringify(entries);
}

function addNoteEntry(existingRaw, newText) {
    if (!newText?.trim()) return existingRaw || '';
    const entries = parseNotes(existingRaw);
    entries.push({ time: new Date().toISOString(), text: newText.trim() });
    return serializeNotes(entries);
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

function TodoView() {
    const navigate = useNavigate();
    const pages = usePageStore(state => state.pages);
    const loadPages = usePageStore(state => state.loadPages);

    const [todos, setTodos] = useState([]);
    const [loading, setLoading] = useState(true);
    const [viewMode, setViewMode] = useState('list'); // 'list', 'calendar', 'analytics', 'review'
    const [editingId, setEditingId] = useState(null);
    const [editDraft, setEditDraft] = useState(null);
    const [pageSize, setPageSize] = useState(PAGE_SIZE_OPTIONS[1]);
    const [pageIndex, setPageIndex] = useState(1);
    const [selectedDateTodos, setSelectedDateTodos] = useState(null);
    const [showAddForm, setShowAddForm] = useState(false);
    const [showAIInput, setShowAIInput] = useState(false);
    const [aiText, setAiText] = useState('');
    const [aiLoading, setAiLoading] = useState(false);
    const [addingSubTaskFor, setAddingSubTaskFor] = useState(null); // parent todo id
    const [subTaskContent, setSubTaskContent] = useState('');
    const [draggedTodoId, setDraggedTodoId] = useState(null);
    const [dragOverTodoId, setDragOverTodoId] = useState(null);
    const [dragOverMode, setDragOverMode] = useState(null); // 'reorder' | 'nest'
    const [showDismissed, setShowDismissed] = useState(false);
    const [dismissDropHover, setDismissDropHover] = useState(false);
    const [quickNoteId, setQuickNoteId] = useState(null); // todo id for inline quick note
    const [quickNoteText, setQuickNoteText] = useState('');
    const [linkingTodoId, setLinkingTodoId] = useState(null); // todo id being linked
    const [attachmentTodoId, setAttachmentTodoId] = useState(null); // todo id for adding attachment
    const [attachmentDraft, setAttachmentDraft] = useState({ type: 'requirement', name: '', content: '' });
    const [newTodo, setNewTodo] = useState({
        content: '', category: '任务', priority: '中',
        assignee: '', deadline: '', needsReminder: false
    });
    const [filters, setFilters] = useState({
        search: '',
        status: 'all',
        followUp: 'all',
        category: 'all',
        priority: 'all',
        assignee: 'all',
        pageId: 'all',
        deadline: 'all'
    });

    useEffect(() => {
        loadPages();
        loadTodos();
    }, [loadPages]);

    useEffect(() => {
        setPageIndex(1);
    }, [filters, pageSize]);

    const loadTodos = async () => {
        setLoading(true);
        const items = await TodoService.getAll();
        setTodos(items);
        setLoading(false);
    };

    const pageMap = useMemo(() => {
        const map = new Map();
        pages.forEach(page => map.set(page.id, page));
        return map;
    }, [pages]);

    const categoryOptions = useMemo(() => {
        const set = new Set();
        todos.forEach(todo => {
            if (todo.category) set.add(todo.category);
        });
        return Array.from(set);
    }, [todos]);

    const assigneeOptions = useMemo(() => {
        const set = new Set();
        todos.forEach(todo => {
            if (todo.assignee) set.add(todo.assignee);
        });
        return Array.from(set);
    }, [todos]);

    const filteredTodos = useMemo(() => {
        const search = filters.search.trim().toLowerCase();
        return todos.filter(todo => {
            // Don't show sub-tasks at top level (they render under parents)
            if (todo.parentId) return false;
            // Hide dismissed unless showDismissed is on
            if (!showDismissed && todo.dismissed) return false;
            if (filters.status === 'active' && todo.completed) return false;
            if (filters.status === 'completed' && !todo.completed) return false;
            if (filters.followUp === 'needs' && !todo.needsReminder) return false;
            if (filters.followUp === 'none' && todo.needsReminder) return false;
            if (filters.category !== 'all' && todo.category !== filters.category) return false;
            if (filters.priority !== 'all' && todo.priority !== filters.priority) return false;
            if (filters.assignee !== 'all') {
                if (filters.assignee === 'unassigned' && todo.assignee) return false;
                if (filters.assignee !== 'unassigned' && todo.assignee !== filters.assignee) return false;
            }
            if (filters.pageId !== 'all' && todo.pageId !== filters.pageId) return false;
            if (filters.deadline !== 'all') {
                const todoDate = todo.deadline || todo.createdAt;
                if (!todoDate) return false;
                const dateStr = new Date(todoDate).toISOString().split('T')[0];
                if (dateStr !== filters.deadline) return false;
            }
            if (!search) return true;

            const pageTitle = pageMap.get(todo.pageId)?.title
                || pageMap.get(todo.pageId)?.autoTitle
                || '';
            const haystack = [
                todo.content,
                todo.assignee,
                todo.category,
                todo.priority,
                todo.deadline,
                todo.notes,
                pageTitle
            ]
                .filter(Boolean)
                .join(' ')
                .toLowerCase();
            return haystack.includes(search);
        }).sort((a, b) => {
            // Sort by sortOrder if set, otherwise by createdAt (newest first)
            const aOrder = a.sortOrder ?? Infinity;
            const bOrder = b.sortOrder ?? Infinity;
            if (aOrder !== Infinity || bOrder !== Infinity) {
                return aOrder - bOrder;
            }
            return new Date(b.createdAt) - new Date(a.createdAt);
        });
    }, [todos, filters, pageMap, showDismissed]);

    // Build a map of parentId -> children for sub-task rendering
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

    const totalPages = Math.max(1, Math.ceil(filteredTodos.length / pageSize));

    useEffect(() => {
        if (pageIndex > totalPages) {
            setPageIndex(totalPages);
        }
    }, [pageIndex, totalPages]);

    const pagedTodos = useMemo(() => {
        const start = (pageIndex - 1) * pageSize;
        return filteredTodos.slice(start, start + pageSize);
    }, [filteredTodos, pageIndex, pageSize]);

    const counts = useMemo(() => {
        const total = todos.length;
        const completed = todos.filter(t => t.completed).length;
        const followUp = todos.filter(t => t.needsReminder).length;
        const dismissed = todos.filter(t => t.dismissed).length;
        const today = new Date(new Date().toDateString());
        const overdue = todos.filter(t => !t.completed && t.deadline && new Date(t.deadline) < today).length;
        return { total, completed, followUp, overdue, dismissed };
    }, [todos]);

    const handleToggleComplete = async (todo) => {
        const updated = { completed: !todo.completed };
        await TodoService.update(todo.id, updated);
        setTodos(prev => prev.map(item => (
            item.id === todo.id ? { ...item, ...updated, updatedAt: new Date() } : item
        )));
    };

    const handleToggleFollowUp = async (todo) => {
        const updated = { needsReminder: !todo.needsReminder };
        await TodoService.update(todo.id, updated);
        setTodos(prev => prev.map(item => (
            item.id === todo.id ? { ...item, ...updated, updatedAt: new Date() } : item
        )));
    };

    const handleDismiss = async (todoId) => {
        await TodoService.update(todoId, { dismissed: true });
        setTodos(prev => prev.map(item => (
            item.id === todoId ? { ...item, dismissed: true, updatedAt: new Date() } : item
        )));
    };

    const handleRestore = async (todoId) => {
        await TodoService.update(todoId, { dismissed: false });
        setTodos(prev => prev.map(item => (
            item.id === todoId ? { ...item, dismissed: false, updatedAt: new Date() } : item
        )));
    };

    const handleAddAttachment = async (todoId) => {
        if (!attachmentDraft.name.trim() || !attachmentDraft.content.trim()) return;
        const todo = todos.find(t => t.id === todoId);
        const existing = todo?.attachments || [];
        const newAttachment = {
            id: Date.now().toString(),
            type: attachmentDraft.type,
            name: attachmentDraft.name.trim(),
            content: attachmentDraft.content.trim(),
            createdAt: new Date().toISOString()
        };
        const updated = [...existing, newAttachment];
        await TodoService.update(todoId, { attachments: updated });
        setTodos(prev => prev.map(t =>
            t.id === todoId ? { ...t, attachments: updated, updatedAt: new Date() } : t
        ));
        setAttachmentDraft({ type: 'requirement', name: '', content: '' });
        setAttachmentTodoId(null);
    };

    const handleDeleteAttachment = async (todoId, attachmentId) => {
        const todo = todos.find(t => t.id === todoId);
        const updated = (todo?.attachments || []).filter(a => a.id !== attachmentId);
        await TodoService.update(todoId, { attachments: updated });
        setTodos(prev => prev.map(t =>
            t.id === todoId ? { ...t, attachments: updated, updatedAt: new Date() } : t
        ));
    };

    const handleUpdateCategory = async (todoId, newCategory) => {
        await TodoService.update(todoId, { category: newCategory });
        setTodos(prev => prev.map(item => (
            item.id === todoId ? { ...item, category: newCategory, updatedAt: new Date() } : item
        )));
    };

    const handleDelete = async (todo) => {
        const children = childTodosMap.get(todo.id) || [];
        const msg = children.length > 0
            ? `确定要删除这个待办及其 ${children.length} 个子任务吗？此操作无法撤销。`
            : '确定要删除这个待办吗？此操作无法撤销。';
        if (!confirm(msg)) return;

        // Delete children first
        for (const child of children) {
            await TodoService.delete(child.id);
        }
        await TodoService.delete(todo.id);

        const childIds = new Set(children.map(c => c.id));
        setTodos(prev => prev.filter(item => item.id !== todo.id && !childIds.has(item.id)));

        if (todo.pageId) {
            const pageTodos = await TodoService.getByPageId(todo.pageId);
            await PageService.update(todo.pageId, { todoCount: pageTodos.length });
            await loadPages();
        }
    };

    const handleDateClick = (dateKey, dateTodos) => {
        setSelectedDateTodos({ date: dateKey, todos: dateTodos });
        // Set deadline filter to show only this date's todos
        setFilters(prev => ({ ...prev, deadline: dateKey }));
        setViewMode('list');
    };

    const handleSaveReview = () => {
        // ReviewService is now handled inside TodoDailyReview component
    };

    const handleAddTodo = async () => {
        if (!newTodo.content.trim()) {
            alert('待办内容不能为空');
            return;
        }
        const pageId = '_manual_';
        const todo = await TodoService.add(pageId, {
            content: newTodo.content.trim(),
            category: newTodo.category || '任务',
            priority: newTodo.priority || '中',
            assignee: newTodo.assignee.trim() || null,
            deadline: newTodo.deadline.trim() || null,
            needs_reminder: newTodo.needsReminder
        });
        setTodos(prev => [todo, ...prev]);
        setNewTodo({
            content: '', category: '任务', priority: '中',
            assignee: '', deadline: '', needsReminder: false
        });
        setShowAddForm(false);
    };

    const handleAddSubTask = async (parentTodo) => {
        if (!subTaskContent.trim()) return;
        const todo = await TodoService.add(parentTodo.pageId, {
            content: subTaskContent.trim(),
            category: parentTodo.category || '任务',
            priority: parentTodo.priority || '中',
            parentId: parentTodo.id
        });
        setTodos(prev => [...prev, todo]);
        setSubTaskContent('');
        setAddingSubTaskFor(null);
    };

    const handleAIGenerate = async () => {
        if (!aiText.trim() || aiText.trim().length < 10) {
            alert('请输入至少10个字符的内容');
            return;
        }
        setAiLoading(true);
        try {
            const generatedTodos = await AITodoService.generateFromText(aiText);
            if (generatedTodos.length === 0) {
                alert('未能从文本中提取到待办事项，请尝试更详细的内容');
                return;
            }
            const pageId = '_ai_generated_';
            const saved = await TodoService.addBatch(pageId, generatedTodos);
            setTodos(prev => [...saved, ...prev]);
            setAiText('');
            setShowAIInput(false);
            alert(`成功生成 ${saved.length} 条待办事项！`);
        } catch (e) {
            alert('AI 生成失败: ' + e.message);
        } finally {
            setAiLoading(false);
        }
    };

    const [expandedNotes, setExpandedNotes] = useState(new Set());

    const toggleNoteExpand = (todoId) => {
        setExpandedNotes(prev => {
            const next = new Set(prev);
            if (next.has(todoId)) next.delete(todoId);
            else next.add(todoId);
            return next;
        });
    };

    const handleQuickNoteSave = async (todoId) => {
        if (!quickNoteText.trim()) { setQuickNoteId(null); return; }
        const currentTodo = todos.find(t => t.id === todoId);
        const updatedNotes = addNoteEntry(currentTodo?.notes, quickNoteText);
        await TodoService.update(todoId, { notes: updatedNotes });
        setTodos(prev => prev.map(item =>
            item.id === todoId ? { ...item, notes: updatedNotes, updatedAt: new Date() } : item
        ));
        setQuickNoteId(null);
        setQuickNoteText('');
    };

    const handleLinkTodo = async (sourceId, targetId) => {
        const source = todos.find(t => t.id === sourceId);
        const target = todos.find(t => t.id === targetId);
        if (!source || !target || sourceId === targetId) return;

        const srcRelated = new Set(source.relatedIds || []);
        const tgtRelated = new Set(target.relatedIds || []);
        srcRelated.add(targetId);
        tgtRelated.add(sourceId);

        const srcArr = [...srcRelated];
        const tgtArr = [...tgtRelated];
        await TodoService.update(sourceId, { relatedIds: srcArr });
        await TodoService.update(targetId, { relatedIds: tgtArr });
        setTodos(prev => prev.map(t => {
            if (t.id === sourceId) return { ...t, relatedIds: srcArr };
            if (t.id === targetId) return { ...t, relatedIds: tgtArr };
            return t;
        }));
        setLinkingTodoId(null);
    };

    const handleUnlinkTodo = async (sourceId, targetId) => {
        const source = todos.find(t => t.id === sourceId);
        const target = todos.find(t => t.id === targetId);
        if (!source || !target) return;

        const srcArr = (source.relatedIds || []).filter(id => id !== targetId);
        const tgtArr = (target.relatedIds || []).filter(id => id !== sourceId);
        await TodoService.update(sourceId, { relatedIds: srcArr });
        await TodoService.update(targetId, { relatedIds: tgtArr });
        setTodos(prev => prev.map(t => {
            if (t.id === sourceId) return { ...t, relatedIds: srcArr };
            if (t.id === targetId) return { ...t, relatedIds: tgtArr };
            return t;
        }));
    };

    const startEdit = (todo) => {
        setEditingId(todo.id);
        setEditDraft({
            content: todo.content || '',
            category: todo.category || '任务',
            priority: todo.priority || '中',
            assignee: todo.assignee || '',
            deadline: todo.deadline || '',
            needsReminder: !!todo.needsReminder,
            newNote: '' // new note entry (appended on save)
        });
    };

    const cancelEdit = () => {
        setEditingId(null);
        setEditDraft(null);
    };

    const handleSaveEdit = async () => {
        if (!editingId || !editDraft) return;
        // Find the current todo to get existing notes
        const currentTodo = todos.find(t => t.id === editingId);
        const updatedNotes = editDraft.newNote?.trim()
            ? addNoteEntry(currentTodo?.notes, editDraft.newNote)
            : (currentTodo?.notes || '');

        const updates = {
            content: editDraft.content.trim(),
            category: editDraft.category.trim() || '任务',
            priority: editDraft.priority || '中',
            assignee: editDraft.assignee.trim() || null,
            deadline: editDraft.deadline.trim() || null,
            needsReminder: !!editDraft.needsReminder,
            notes: updatedNotes
        };

        if (!updates.content) {
            alert('待办内容不能为空');
            return;
        }

        await TodoService.update(editingId, updates);
        setTodos(prev => prev.map(item => (
            item.id === editingId ? { ...item, ...updates, updatedAt: new Date() } : item
        )));
        cancelEdit();
    };

    const handleFilterChange = (key, value) => {
        setFilters(prev => ({ ...prev, [key]: value }));
    };

    const handleDragStart = (e, todoId) => {
        setDraggedTodoId(todoId);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', todoId);
        requestAnimationFrame(() => {
            e.target.classList.add('todo-card-dragging');
        });
    };

    const handleDragEnd = (e) => {
        e.target.classList.remove('todo-card-dragging');
        setDraggedTodoId(null);
        setDragOverTodoId(null);
        setDragOverMode(null);
        setDismissDropHover(false);
    };

    const handleDragOver = (e, todoId) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (todoId === draggedTodoId) return;
        // Detect zone: center 40% = nest, top/bottom 30% = reorder
        const rect = e.currentTarget.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const ratio = y / rect.height;
        const mode = (ratio > 0.3 && ratio < 0.7) ? 'nest' : 'reorder';
        setDragOverTodoId(todoId);
        setDragOverMode(mode);
    };

    const handleDrop = async (e, targetTodoId) => {
        e.preventDefault();
        const currentMode = dragOverMode;
        setDragOverTodoId(null);
        setDragOverMode(null);
        if (!draggedTodoId || draggedTodoId === targetTodoId) return;

        // Nest mode: make dragged todo a child of target
        if (currentMode === 'nest') {
            const draggedTodo = todos.find(t => t.id === draggedTodoId);
            // Don't nest if target is already a child of dragged (prevent circular)
            if (draggedTodo && childTodosMap.has(draggedTodoId)) {
                const children = childTodosMap.get(draggedTodoId);
                if (children.some(c => c.id === targetTodoId)) return;
            }
            await TodoService.update(draggedTodoId, { parentId: targetTodoId });
            setTodos(prev => prev.map(t =>
                t.id === draggedTodoId ? { ...t, parentId: targetTodoId, updatedAt: new Date() } : t
            ));
            setDraggedTodoId(null);
            return;
        }

        // Reorder within filteredTodos
        const fromIdx = filteredTodos.findIndex(t => t.id === draggedTodoId);
        const toIdx = filteredTodos.findIndex(t => t.id === targetTodoId);
        if (fromIdx === -1 || toIdx === -1) return;

        const reordered = [...filteredTodos];
        const [moved] = reordered.splice(fromIdx, 1);
        reordered.splice(toIdx, 0, moved);

        // Build updates and apply optimistically
        const updates = reordered.map((todo, idx) => ({ id: todo.id, sortOrder: idx }));
        const sortMap = new Map(updates.map(u => [u.id, u.sortOrder]));
        setTodos(prev => prev.map(t => sortMap.has(t.id) ? { ...t, sortOrder: sortMap.get(t.id) } : t));
        setDraggedTodoId(null);

        // Batch update to IndexedDB + backend
        for (const { id, sortOrder } of updates) {
            await TodoService.update(id, { sortOrder });
        }
        // Also fire batch reorder to backend (non-blocking, faster than individual PUTs)
        fetch('/api/todos/reorder', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ updates })
        }).catch(err => console.warn('Batch reorder sync failed:', err));
    };

    return (
        <div className="todo-overview">
            <div className="todo-overview-header">
                <div>
                    <h1>✅ 待办总览</h1>
                    <p className="text-muted">跨会议统一管理待办事项，支持筛选与跟进标记</p>
                </div>
                <div className="todo-overview-summary">
                    <span className="badge">总计 {counts.total}</span>
                    <span className="badge badge-success">已完成 {counts.completed}</span>
                    <span className="badge badge-warning">跟进 {counts.followUp}</span>
                    {counts.overdue > 0 && (
                        <span className="badge badge-error">逾期 {counts.overdue}</span>
                    )}
                    {counts.dismissed > 0 && (
                        <button
                            className={`badge ${showDismissed ? 'badge-info' : 'badge-muted'}`}
                            onClick={() => setShowDismissed(!showDismissed)}
                            title={showDismissed ? '隐藏不关心的待办' : '显示不关心的待办'}
                            style={{ cursor: 'pointer', border: 'none' }}
                        >
                            {showDismissed ? '🙈 隐藏' : '👁️ 显示'}不关心 {counts.dismissed}
                        </button>
                    )}
                    <button
                        className="btn btn-sm btn-primary"
                        onClick={() => { setShowAddForm(!showAddForm); setShowAIInput(false); }}
                    >
                        + 新建待办
                    </button>
                    <button
                        className="btn btn-sm btn-secondary"
                        onClick={() => { setShowAIInput(!showAIInput); setShowAddForm(false); }}
                    >
                        🤖 AI 生成
                    </button>
                </div>
            </div>

            {/* 手动新建待办表单 */}
            {showAddForm && (
                <div className="todo-add-form">
                    <h4>+ 新建待办</h4>
                    <div className="todo-add-form-fields">
                        <input
                            className="input"
                            type="text"
                            placeholder="待办内容 *"
                            value={newTodo.content}
                            onChange={(e) => setNewTodo(prev => ({ ...prev, content: e.target.value }))}
                            autoFocus
                        />
                        <div className="todo-add-form-row">
                            <input
                                className="input"
                                type="text"
                                placeholder="分类（如：任务、跟进）"
                                value={newTodo.category}
                                onChange={(e) => setNewTodo(prev => ({ ...prev, category: e.target.value }))}
                            />
                            <select
                                className="select"
                                value={newTodo.priority}
                                onChange={(e) => setNewTodo(prev => ({ ...prev, priority: e.target.value }))}
                            >
                                {PRIORITY_OPTIONS.map(opt => (
                                    <option key={opt} value={opt}>{opt}</option>
                                ))}
                            </select>
                            <input
                                className="input"
                                type="text"
                                placeholder="负责人"
                                value={newTodo.assignee}
                                onChange={(e) => setNewTodo(prev => ({ ...prev, assignee: e.target.value }))}
                            />
                            <input
                                className="input"
                                type="date"
                                placeholder="截止日期"
                                value={newTodo.deadline}
                                onChange={(e) => setNewTodo(prev => ({ ...prev, deadline: e.target.value }))}
                            />
                        </div>
                        <div className="todo-add-form-actions">
                            <button className="btn btn-primary" onClick={handleAddTodo}>
                                添加
                            </button>
                            <button className="btn btn-secondary" onClick={() => setShowAddForm(false)}>
                                取消
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* AI 文本生成待办 */}
            {showAIInput && (
                <div className="todo-ai-form">
                    <h4>🤖 AI 智能提取待办</h4>
                    <p className="text-muted text-sm">粘贴会议纪要、邮件、聊天记录等内容，AI 自动提取待办事项</p>
                    <textarea
                        className="todo-ai-textarea"
                        placeholder={"在这里粘贴内容...\n\n例如：\n今天开会讨论了Q2计划，张三负责完成产品方案，下周五前提交。李四需要跟进客户反馈，本周内完成。"}
                        value={aiText}
                        onChange={(e) => setAiText(e.target.value)}
                        rows={6}
                    />
                    <div className="todo-ai-form-actions">
                        <button
                            className="btn btn-primary"
                            onClick={handleAIGenerate}
                            disabled={aiLoading || aiText.trim().length < 10}
                        >
                            {aiLoading ? '正在分析...' : '提取待办'}
                        </button>
                        <button className="btn btn-secondary" onClick={() => setShowAIInput(false)}>
                            取消
                        </button>
                    </div>
                </div>
            )}

            {/* 视图切换 */}
            <div className="todo-view-switcher">
                {[
                    { key: 'list',      icon: '📋', label: '列表',   desc: '筛选/搜索/编辑' },
                    { key: 'board',     icon: '📌', label: '看板',   desc: '拖拽分类管理' },
                    { key: 'calendar',  icon: '📅', label: '日历',   desc: '按日期查看' },
                    { key: 'analytics', icon: '📊', label: '分析',   desc: '分类/趋势统计' },
                    { key: 'review',    icon: '🔄', label: '复盘',   desc: '每日回顾' },
                ].map(v => (
                    <button
                        key={v.key}
                        className={`view-tab ${viewMode === v.key ? 'active' : ''}`}
                        onClick={() => setViewMode(v.key)}
                    >
                        <span className="view-tab-icon">{v.icon}</span>
                        <span className="view-tab-label">{v.label}</span>
                        <span className="view-tab-desc">{v.desc}</span>
                    </button>
                ))}
            </div>

            {/* 根据视图模式渲染不同内容 */}
            {viewMode === 'calendar' && (
                <TodoCalendarView
                    todos={todos}
                    onDateClick={handleDateClick}
                    onCreateTodo={async (content, dateKey) => {
                        const todo = await TodoService.add('_manual_', {
                            content,
                            category: '任务',
                            priority: '中',
                            deadline: dateKey
                        });
                        setTodos(prev => [todo, ...prev]);
                    }}
                />
            )}

            {viewMode === 'analytics' && (
                <TodoAnalytics todos={todos} />
            )}

            {viewMode === 'review' && (
                <TodoDailyReview
                    todos={todos}
                    onSaveReview={handleSaveReview}
                    onToggleComplete={handleToggleComplete}
                />
            )}

            {viewMode === 'board' && (
                <TodoBoardView
                    todos={todos}
                    onUpdateCategory={handleUpdateCategory}
                    onToggleComplete={handleToggleComplete}
                    onDelete={handleDelete}
                    onUpdateContent={async (todoId, newContent) => {
                        await TodoService.update(todoId, { content: newContent });
                        setTodos(prev => prev.map(t => t.id === todoId ? { ...t, content: newContent } : t));
                    }}
                    onAddNote={async (todoId, noteText) => {
                        const currentTodo = todos.find(t => t.id === todoId);
                        const updatedNotes = addNoteEntry(currentTodo?.notes, noteText);
                        await TodoService.update(todoId, { notes: updatedNotes });
                        setTodos(prev => prev.map(t => t.id === todoId ? { ...t, notes: updatedNotes, updatedAt: new Date() } : t));
                    }}
                    onAddTodo={async (content, category) => {
                        const todo = await TodoService.add('_manual_', {
                            content,
                            category,
                            priority: '中'
                        });
                        setTodos(prev => [todo, ...prev]);
                    }}
                />
            )}

            {viewMode === 'list' && (
                <>

            <div className="todo-filters">
                {filters.deadline !== 'all' && (
                    <div className="todo-filter-active-tag">
                        📅 {filters.deadline}
                        <button
                            className="btn btn-sm btn-secondary"
                            onClick={() => setFilters(prev => ({ ...prev, deadline: 'all' }))}
                            style={{ marginLeft: '6px', padding: '1px 6px', fontSize: '0.7rem' }}
                        >
                            ✕
                        </button>
                    </div>
                )}
                <input
                    className="input"
                    type="text"
                    placeholder="搜索内容 / 负责人 / 分类 / 截止日期"
                    value={filters.search}
                    onChange={(e) => handleFilterChange('search', e.target.value)}
                />
                <select
                    className="select"
                    value={filters.status}
                    onChange={(e) => handleFilterChange('status', e.target.value)}
                >
                    <option value="all">全部状态</option>
                    <option value="active">未完成</option>
                    <option value="completed">已完成</option>
                </select>
                <select
                    className="select"
                    value={filters.followUp}
                    onChange={(e) => handleFilterChange('followUp', e.target.value)}
                >
                    <option value="all">全部跟进</option>
                    <option value="needs">需要跟进</option>
                    <option value="none">不需要跟进</option>
                </select>
                <select
                    className="select"
                    value={filters.priority}
                    onChange={(e) => handleFilterChange('priority', e.target.value)}
                >
                    <option value="all">全部优先级</option>
                    {PRIORITY_OPTIONS.map(option => (
                        <option key={option} value={option}>{option}</option>
                    ))}
                </select>
                <select
                    className="select"
                    value={filters.category}
                    onChange={(e) => handleFilterChange('category', e.target.value)}
                >
                    <option value="all">全部分类</option>
                    {categoryOptions.map(option => (
                        <option key={option} value={option}>{option}</option>
                    ))}
                </select>
                <select
                    className="select"
                    value={filters.assignee}
                    onChange={(e) => handleFilterChange('assignee', e.target.value)}
                >
                    <option value="all">全部负责人</option>
                    <option value="unassigned">未分配</option>
                    {assigneeOptions.map(option => (
                        <option key={option} value={option}>{option}</option>
                    ))}
                </select>
                <select
                    className="select"
                    value={filters.pageId}
                    onChange={(e) => handleFilterChange('pageId', e.target.value)}
                >
                    <option value="all">全部会议</option>
                    {pages.map(page => {
                        const title = page.title || page.autoTitle || '未命名会议';
                        return (
                            <option key={page.id} value={page.id}>{title}</option>
                        );
                    })}
                </select>
            </div>

            {/* Dismiss drop zone — appears when dragging */}
            {draggedTodoId && (
                <div
                    className={`todo-dismiss-zone ${dismissDropHover ? 'hover' : ''}`}
                    onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDismissDropHover(true); }}
                    onDragLeave={() => setDismissDropHover(false)}
                    onDrop={(e) => {
                        e.preventDefault();
                        setDismissDropHover(false);
                        if (draggedTodoId) handleDismiss(draggedTodoId);
                        setDraggedTodoId(null);
                    }}
                >
                    🙈 拖到这里 = 不关心
                </div>
            )}

            <div
                className="todo-overview-list"
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                onDrop={async (e) => {
                    // If dropped on the list background (not on a card), unparent the dragged todo
                    if (e.target === e.currentTarget && draggedTodoId) {
                        e.preventDefault();
                        const dragged = todos.find(t => t.id === draggedTodoId);
                        if (dragged?.parentId) {
                            await TodoService.update(draggedTodoId, { parentId: null });
                            setTodos(prev => prev.map(t =>
                                t.id === draggedTodoId ? { ...t, parentId: null, updatedAt: new Date() } : t
                            ));
                        }
                        setDraggedTodoId(null);
                        setDragOverMode(null);
                    }
                }}
            >
                {loading ? (
                    <p className="text-muted">加载中...</p>
                ) : filteredTodos.length === 0 ? (
                    <div className="empty-state">
                        <div className="empty-state-icon">✅</div>
                        <h3>暂无待办</h3>
                        <p className="text-muted">调整筛选条件或生成新的 AI 待办</p>
                    </div>
                ) : (
                    pagedTodos.map(todo => {
                        const page = pageMap.get(todo.pageId);
                        const pageTitle = todo.pageId === '_manual_'
                            ? '手动创建'
                            : todo.pageId === '_ai_generated_'
                                ? 'AI 智能生成'
                                : (page?.title || page?.autoTitle || '未命名会议');
                        const isEditing = editingId === todo.id;

                        return (
                            <div
                                key={todo.id}
                                className={`todo-card ${todo.completed ? 'completed' : ''} ${todo.dismissed ? 'dismissed' : ''} ${!todo.completed && todo.deadline && new Date(todo.deadline) < new Date(new Date().toDateString()) ? 'overdue' : ''} ${dragOverTodoId === todo.id && dragOverMode === 'reorder' ? 'todo-card-dragover' : ''} ${dragOverTodoId === todo.id && dragOverMode === 'nest' ? 'todo-card-nest-target' : ''}`}
                                draggable={!isEditing}
                                onDragStart={(e) => handleDragStart(e, todo.id)}
                                onDragEnd={handleDragEnd}
                                onDragOver={(e) => handleDragOver(e, todo.id)}
                                onDrop={(e) => handleDrop(e, todo.id)}
                            >
                                <div className="todo-card-main">
                                    <label className="todo-card-check">
                                        <input
                                            type="checkbox"
                                            checked={todo.completed}
                                            onChange={() => handleToggleComplete(todo)}
                                        />
                                        {isEditing ? (
                                            <input
                                                className="input"
                                                type="text"
                                                value={editDraft?.content || ''}
                                                onChange={(e) => setEditDraft(prev => ({ ...prev, content: e.target.value }))}
                                            />
                                        ) : (
                                            <span className="todo-card-text">{todo.content}</span>
                                        )}
                                    </label>
                                    <div className="todo-card-meta">
                                        <span className="todo-chip">🏷️ {todo.category || '任务'}</span>
                                        <span className="todo-chip">⚡ {todo.priority || '中'}</span>
                                        <span className={`todo-chip ${todo.assignee ? '' : 'muted'}`}>
                                            👤 {todo.assignee || '未分配'}
                                        </span>
                                        {todo.deadline && (
                                            <span className="todo-chip">📅 {todo.deadline}</span>
                                        )}
                                        {!todo.completed && todo.deadline && new Date(todo.deadline) < new Date(new Date().toDateString()) && (
                                            <span className="todo-chip todo-chip-overdue">⚠️ 已逾期</span>
                                        )}
                                        {todo.needsReminder && (
                                            <span className="todo-chip todo-chip-alert">🔔 跟进</span>
                                        )}
                                    </div>
                                </div>

                                {todo.notes && !isEditing && (() => {
                                    const entries = parseNotes(todo.notes);
                                    if (entries.length === 0) return null;
                                    const isExpanded = expandedNotes.has(todo.id);
                                    const latest = entries[entries.length - 1];
                                    return (
                                        <div className="todo-card-notes">
                                            <div className="todo-notes-header"
                                                onClick={() => entries.length > 1 && toggleNoteExpand(todo.id)}
                                                style={{ cursor: entries.length > 1 ? 'pointer' : 'default' }}
                                            >
                                                <span className="todo-notes-label">
                                                    📝 备注 {entries.length > 1 && `(${entries.length}条)`}
                                                    {entries.length > 1 && (isExpanded ? ' ▾' : ' ▸')}
                                                </span>
                                                {!isExpanded && (
                                                    <span className="todo-notes-latest">
                                                        <span className="todo-notes-time">{formatNoteTime(latest.time)}</span>
                                                        {' '}{latest.text}
                                                    </span>
                                                )}
                                            </div>
                                            {isExpanded && (
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

                                {/* Related tasks display */}
                                {!isEditing && todo.relatedIds && todo.relatedIds.length > 0 && (
                                    <div className="todo-card-related" style={{ padding: '6px 12px', fontSize: '12px', color: 'var(--text-muted)' }}>
                                        <span>🔗 关联: </span>
                                        {todo.relatedIds.map(rid => {
                                            const related = todos.find(t => t.id === rid);
                                            if (!related) return null;
                                            return (
                                                <span key={rid} className="todo-related-tag" style={{
                                                    display: 'inline-flex', alignItems: 'center', gap: '4px',
                                                    background: 'rgba(0,243,255,0.08)', borderRadius: '4px',
                                                    padding: '2px 8px', marginRight: '6px', fontSize: '11px'
                                                }}>
                                                    {related.content.slice(0, 20)}{related.content.length > 20 ? '...' : ''}
                                                    <button
                                                        style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '0 2px', fontSize: '11px' }}
                                                        onClick={(e) => { e.stopPropagation(); handleUnlinkTodo(todo.id, rid); }}
                                                        title="取消关联"
                                                    >×</button>
                                                </span>
                                            );
                                        })}
                                    </div>
                                )}

                                {/* Attachments display */}
                                {!isEditing && todo.attachments && todo.attachments.length > 0 && (
                                    <div className="todo-attachments">
                                        {todo.attachments.map(att => (
                                            <div key={att.id} className={`todo-attachment todo-attachment-${att.type}`}>
                                                <span className="todo-attachment-icon">
                                                    {att.type === 'requirement' ? '📄' : '✅'}
                                                </span>
                                                <span className="todo-attachment-label">
                                                    {att.type === 'requirement' ? '需求' : '结果'}
                                                </span>
                                                <span className="todo-attachment-name">{att.name}</span>
                                                <button
                                                    className="todo-attachment-toggle"
                                                    onClick={(e) => {
                                                        const el = e.currentTarget.parentElement.querySelector('.todo-attachment-content');
                                                        if (el) el.classList.toggle('expanded');
                                                    }}
                                                >展开</button>
                                                <button
                                                    className="todo-attachment-delete"
                                                    onClick={() => handleDeleteAttachment(todo.id, att.id)}
                                                >×</button>
                                                <div className="todo-attachment-content">{att.content}</div>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {isEditing && (
                                    <div className="todo-card-edit">
                                        <input
                                            className="input"
                                            type="text"
                                            placeholder="负责人"
                                            value={editDraft?.assignee || ''}
                                            onChange={(e) => setEditDraft(prev => ({ ...prev, assignee: e.target.value }))}
                                        />
                                        <input
                                            className="input"
                                            type="date"
                                            placeholder="截止日期"
                                            value={editDraft?.deadline || ''}
                                            onChange={(e) => setEditDraft(prev => ({ ...prev, deadline: e.target.value }))}
                                        />
                                        <input
                                            className="input"
                                            type="text"
                                            placeholder="分类"
                                            value={editDraft?.category || ''}
                                            onChange={(e) => setEditDraft(prev => ({ ...prev, category: e.target.value }))}
                                        />
                                        <select
                                            className="select"
                                            value={editDraft?.priority || '中'}
                                            onChange={(e) => setEditDraft(prev => ({ ...prev, priority: e.target.value }))}
                                        >
                                            {PRIORITY_OPTIONS.map(option => (
                                                <option key={option} value={option}>{option}</option>
                                            ))}
                                        </select>
                                        <label className="todo-followup-toggle">
                                            <input
                                                type="checkbox"
                                                checked={!!editDraft?.needsReminder}
                                                onChange={(e) => setEditDraft(prev => ({
                                                    ...prev,
                                                    needsReminder: e.target.checked
                                                }))}
                                            />
                                            <span>需要跟进</span>
                                        </label>
                                        <textarea
                                            className="todo-notes-input"
                                            placeholder="添加新的进度备注（如：已完成初稿，等待审核...）"
                                            value={editDraft?.newNote || ''}
                                            onChange={(e) => setEditDraft(prev => ({ ...prev, newNote: e.target.value }))}
                                            rows={2}
                                        />
                                        {/* Show existing notes history in edit mode */}
                                        {(() => {
                                            const entries = parseNotes(todos.find(t => t.id === editingId)?.notes);
                                            if (entries.length === 0) return null;
                                            return (
                                                <div className="todo-notes-history-edit">
                                                    <span className="text-muted text-sm">历史备注：</span>
                                                    {[...entries].reverse().map((entry, i) => (
                                                        <div key={i} className="todo-notes-entry text-sm">
                                                            <span className="todo-notes-time">{formatNoteTime(entry.time)}</span>
                                                            <span className="todo-notes-text">{entry.text}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            );
                                        })()}
                                    </div>
                                )}

                                <div className="todo-card-actions">
                                    {isEditing ? (
                                        <>
                                            <button className="btn btn-sm btn-primary" onClick={handleSaveEdit}>
                                                保存
                                            </button>
                                            <button className="btn btn-sm btn-secondary" onClick={cancelEdit}>
                                                取消
                                            </button>
                                        </>
                                    ) : (
                                        <>
                                            <button className="btn btn-sm btn-secondary" onClick={() => startEdit(todo)}>
                                                编辑
                                            </button>
                                            <button
                                                className="btn btn-sm btn-secondary"
                                                onClick={() => {
                                                    setAddingSubTaskFor(addingSubTaskFor === todo.id ? null : todo.id);
                                                    setSubTaskContent('');
                                                }}
                                            >
                                                + 子任务
                                            </button>
                                            <button
                                                className="btn btn-sm btn-secondary"
                                                onClick={() => {
                                                    setQuickNoteId(quickNoteId === todo.id ? null : todo.id);
                                                    setQuickNoteText('');
                                                }}
                                            >
                                                📝 备注
                                            </button>
                                            <button
                                                className={`btn btn-sm ${todo.needsReminder ? 'btn-primary' : 'btn-secondary'}`}
                                                onClick={() => handleToggleFollowUp(todo)}
                                            >
                                                {todo.needsReminder ? '已跟进' : '标记跟进'}
                                            </button>
                                            <button
                                                className={`btn btn-sm ${linkingTodoId === todo.id ? 'btn-primary' : 'btn-secondary'}`}
                                                onClick={() => setLinkingTodoId(linkingTodoId === todo.id ? null : todo.id)}
                                            >
                                                🔗 关联
                                            </button>
                                            <button
                                                className="btn btn-sm btn-secondary"
                                                onClick={() => navigate(`/detail/${todo.pageId}`)}
                                                disabled={!todo.pageId || todo.pageId === '_manual_' || todo.pageId === '_ai_generated_'}
                                            >
                                                查看会议
                                            </button>
                                            <button className="btn btn-sm btn-danger" onClick={() => handleDelete(todo)}>
                                                删除
                                            </button>
                                            {todo.dismissed ? (
                                                <button className="btn btn-sm btn-primary" onClick={() => handleRestore(todo.id)}>
                                                    恢复
                                                </button>
                                            ) : (
                                                <button className="btn btn-sm btn-secondary" onClick={() => handleDismiss(todo.id)}>
                                                    🙈 不关心
                                                </button>
                                            )}
                                            <button
                                                className="btn btn-sm btn-secondary"
                                                onClick={() => setAttachmentTodoId(attachmentTodoId === todo.id ? null : todo.id)}
                                            >
                                                📎 附件
                                            </button>
                                        </>
                                    )}
                                </div>

                                {/* Sub-task inline add form */}
                                {addingSubTaskFor === todo.id && (
                                    <div className="todo-subtask-add">
                                        <input
                                            className="input"
                                            type="text"
                                            placeholder="子任务内容..."
                                            value={subTaskContent}
                                            onChange={(e) => setSubTaskContent(e.target.value)}
                                            onKeyDown={(e) => e.key === 'Enter' && handleAddSubTask(todo)}
                                            autoFocus
                                        />
                                        <button className="btn btn-sm btn-primary" onClick={() => handleAddSubTask(todo)}>
                                            添加
                                        </button>
                                        <button className="btn btn-sm btn-secondary" onClick={() => setAddingSubTaskFor(null)}>
                                            取消
                                        </button>
                                    </div>
                                )}

                                {/* Quick note inline form */}
                                {quickNoteId === todo.id && (
                                    <div className="todo-subtask-add">
                                        <input
                                            className="input"
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
                                        <button className="btn btn-sm btn-primary" onClick={() => handleQuickNoteSave(todo.id)}>
                                            保存
                                        </button>
                                        <button className="btn btn-sm btn-secondary" onClick={() => setQuickNoteId(null)}>
                                            取消
                                        </button>
                                    </div>
                                )}

                                {/* Link task picker */}
                                {linkingTodoId === todo.id && (
                                    <div className="todo-subtask-add" style={{ flexDirection: 'column', gap: '6px' }}>
                                        <span className="text-sm text-muted">选择要关联的任务：</span>
                                        <div style={{ maxHeight: '180px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                            {todos
                                                .filter(t => t.id !== todo.id && !t.parentId && !(todo.relatedIds || []).includes(t.id))
                                                .slice(0, 20)
                                                .map(t => (
                                                    <button
                                                        key={t.id}
                                                        className="btn btn-sm btn-secondary"
                                                        style={{ textAlign: 'left', justifyContent: 'flex-start', fontSize: '12px' }}
                                                        onClick={() => handleLinkTodo(todo.id, t.id)}
                                                    >
                                                        {t.completed ? '✅ ' : '⬜ '}{t.content.slice(0, 40)}{t.content.length > 40 ? '...' : ''}
                                                    </button>
                                                ))
                                            }
                                        </div>
                                        <button className="btn btn-sm btn-secondary" onClick={() => setLinkingTodoId(null)}>取消</button>
                                    </div>
                                )}

                                {/* Attachment add form */}
                                {attachmentTodoId === todo.id && (
                                    <div className="todo-attachment-form">
                                        <div className="todo-attachment-form-row">
                                            <select
                                                className="select"
                                                value={attachmentDraft.type}
                                                onChange={(e) => setAttachmentDraft(prev => ({ ...prev, type: e.target.value }))}
                                            >
                                                <option value="requirement">📄 需求文档</option>
                                                <option value="result">✅ 完成结果</option>
                                            </select>
                                            <input
                                                className="input"
                                                type="text"
                                                placeholder="名称（如：PRD v1、代码链接）"
                                                value={attachmentDraft.name}
                                                onChange={(e) => setAttachmentDraft(prev => ({ ...prev, name: e.target.value }))}
                                            />
                                        </div>
                                        <textarea
                                            className="input"
                                            placeholder="内容（链接、描述、代码片段等）"
                                            value={attachmentDraft.content}
                                            onChange={(e) => setAttachmentDraft(prev => ({ ...prev, content: e.target.value }))}
                                            rows={3}
                                            style={{ width: '100%', resize: 'vertical' }}
                                        />
                                        <div className="todo-attachment-form-actions">
                                            <button className="btn btn-sm btn-primary" onClick={() => handleAddAttachment(todo.id)}>
                                                添加
                                            </button>
                                            <button className="btn btn-sm btn-secondary" onClick={() => setAttachmentTodoId(null)}>
                                                取消
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {/* Render sub-tasks */}
                                {childTodosMap.has(todo.id) && (
                                    <div className="todo-subtasks">
                                        {childTodosMap.get(todo.id).map(child => (
                                            <div
                                                key={child.id}
                                                className={`todo-subtask-item ${child.completed ? 'completed' : ''}`}
                                                draggable
                                                onDragStart={(e) => handleDragStart(e, child.id)}
                                                onDragEnd={handleDragEnd}
                                            >
                                                <label className="todo-card-check">
                                                    <input
                                                        type="checkbox"
                                                        checked={child.completed}
                                                        onChange={() => handleToggleComplete(child)}
                                                    />
                                                    <span className="todo-card-text">{child.content}</span>
                                                </label>
                                                <button
                                                    className="btn btn-sm btn-secondary"
                                                    onClick={async () => {
                                                        await TodoService.update(child.id, { parentId: null });
                                                        setTodos(prev => prev.map(t =>
                                                            t.id === child.id ? { ...t, parentId: null, updatedAt: new Date() } : t
                                                        ));
                                                    }}
                                                    title="提升为独立任务"
                                                    style={{ marginLeft: 'auto', padding: '2px 6px', fontSize: '0.7rem' }}
                                                >
                                                    ↑
                                                </button>
                                                <button className="btn btn-sm btn-danger" onClick={() => handleDelete(child)} style={{ padding: '2px 6px', fontSize: '0.7rem' }}>
                                                    ×
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                <div className="todo-card-footer">
                                    <span className="text-muted text-sm">来自：{pageTitle}</span>
                                    <span className="text-muted text-sm">
                                        更新：{formatDateTime(todo.updatedAt || todo.createdAt)}
                                    </span>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            {filteredTodos.length > 0 && (
                <div className="pagination">
                    <div className="pagination-info">
                        第 {pageIndex} / {totalPages} 页
                    </div>
                    <div className="pagination-controls">
                        <button
                            className="btn btn-sm btn-secondary"
                            disabled={pageIndex <= 1}
                            onClick={() => setPageIndex(prev => Math.max(1, prev - 1))}
                        >
                            上一页
                        </button>
                        <div className="pagination-pages">
                            {Array.from({ length: Math.min(5, totalPages) }, (_, idx) => {
                                const start = Math.max(1, Math.min(
                                    pageIndex - 2,
                                    totalPages - 4
                                ));
                                const pageNumber = start + idx;
                                if (pageNumber > totalPages) return null;
                                return (
                                    <button
                                        key={pageNumber}
                                        className={`btn btn-sm ${pageNumber === pageIndex ? 'btn-primary' : 'btn-secondary'}`}
                                        onClick={() => setPageIndex(pageNumber)}
                                    >
                                        {pageNumber}
                                    </button>
                                );
                            })}
                        </div>
                        <button
                            className="btn btn-sm btn-secondary"
                            disabled={pageIndex >= totalPages}
                            onClick={() => setPageIndex(prev => Math.min(totalPages, prev + 1))}
                        >
                            下一页
                        </button>
                    </div>
                    <div className="pagination-size">
                        <span className="text-muted">每页</span>
                        <select
                            className="select select-sm"
                            value={pageSize}
                            onChange={(e) => setPageSize(Number(e.target.value))}
                        >
                            {PAGE_SIZE_OPTIONS.map(size => (
                                <option key={size} value={size}>{size}</option>
                            ))}
                        </select>
                    </div>
                </div>
            )}

            <div className="mt-lg">
                <button className="btn btn-secondary" onClick={() => navigate('/')}>
                    <span>←</span> 返回列表
                </button>
            </div>
            </>
            )}
        </div>
    );
}

export default TodoView;
