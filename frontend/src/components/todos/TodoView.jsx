import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageService, TodoService } from '../../services/Database';
import { usePageStore } from '../../store/pageStore';
import { formatDateTime } from '../../utils/helpers';

const PRIORITY_OPTIONS = ['高', '中', '低'];
const PAGE_SIZE_OPTIONS = [10, 20, 50];

function TodoView() {
    const navigate = useNavigate();
    const pages = usePageStore(state => state.pages);
    const loadPages = usePageStore(state => state.loadPages);

    const [todos, setTodos] = useState([]);
    const [loading, setLoading] = useState(true);
    const [editingId, setEditingId] = useState(null);
    const [editDraft, setEditDraft] = useState(null);
    const [pageSize, setPageSize] = useState(PAGE_SIZE_OPTIONS[1]);
    const [pageIndex, setPageIndex] = useState(1);
    const [filters, setFilters] = useState({
        search: '',
        status: 'all',
        followUp: 'all',
        category: 'all',
        priority: 'all',
        assignee: 'all',
        pageId: 'all'
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
                pageTitle
            ]
                .filter(Boolean)
                .join(' ')
                .toLowerCase();
            return haystack.includes(search);
        });
    }, [todos, filters, pageMap]);

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
        return { total, completed, followUp };
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

    const handleDelete = async (todo) => {
        if (!confirm('确定要删除这个待办吗？此操作无法撤销。')) return;
        await TodoService.delete(todo.id);
        setTodos(prev => prev.filter(item => item.id !== todo.id));
        if (todo.pageId) {
            const pageTodos = await TodoService.getByPageId(todo.pageId);
            await PageService.update(todo.pageId, { todoCount: pageTodos.length });
            await loadPages();
        }
    };

    const startEdit = (todo) => {
        setEditingId(todo.id);
        setEditDraft({
            content: todo.content || '',
            category: todo.category || '任务',
            priority: todo.priority || '中',
            assignee: todo.assignee || '',
            deadline: todo.deadline || '',
            needsReminder: !!todo.needsReminder
        });
    };

    const cancelEdit = () => {
        setEditingId(null);
        setEditDraft(null);
    };

    const handleSaveEdit = async () => {
        if (!editingId || !editDraft) return;
        const updates = {
            content: editDraft.content.trim(),
            category: editDraft.category.trim() || '任务',
            priority: editDraft.priority || '中',
            assignee: editDraft.assignee.trim() || null,
            deadline: editDraft.deadline.trim() || null,
            needsReminder: !!editDraft.needsReminder
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
                </div>
            </div>

            <div className="todo-filters">
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

            <div className="todo-overview-list">
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
                        const pageTitle = page?.title || page?.autoTitle || '未命名会议';
                        const isEditing = editingId === todo.id;

                        return (
                            <div key={todo.id} className={`todo-card ${todo.completed ? 'completed' : ''}`}>
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
                                        {todo.needsReminder && (
                                            <span className="todo-chip todo-chip-alert">🔔 跟进</span>
                                        )}
                                    </div>
                                </div>

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
                                            type="text"
                                            placeholder="截止日期（如 2024-03-12 / 下周五）"
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
                                                className={`btn btn-sm ${todo.needsReminder ? 'btn-primary' : 'btn-secondary'}`}
                                                onClick={() => handleToggleFollowUp(todo)}
                                            >
                                                {todo.needsReminder ? '已跟进' : '标记跟进'}
                                            </button>
                                            <button
                                                className="btn btn-sm btn-secondary"
                                                onClick={() => navigate(`/detail/${todo.pageId}`)}
                                                disabled={!todo.pageId}
                                            >
                                                查看会议
                                            </button>
                                            <button className="btn btn-sm btn-danger" onClick={() => handleDelete(todo)}>
                                                删除
                                            </button>
                                        </>
                                    )}
                                </div>

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
        </div>
    );
}

export default TodoView;
