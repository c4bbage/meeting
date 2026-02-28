import { useState, useMemo, useEffect } from 'react';
import { formatDateTime } from '../../utils/helpers';
import { ReviewService } from '../../services/Database';

function TodoDailyReview({ todos, onSaveReview, onToggleComplete }) {
    const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
    const [reviewNote, setReviewNote] = useState('');
    const [showNoteEditor, setShowNoteEditor] = useState(false);
    const [savedReview, setSavedReview] = useState(null);
    const [saving, setSaving] = useState(false);

    // 获取指定日期的待办事项
    const dailyTodos = useMemo(() => {
        return todos.filter(todo => {
            const todoDate = todo.deadline || todo.createdAt;
            if (!todoDate) return false;
            const date = new Date(todoDate).toISOString().split('T')[0];
            return date === selectedDate;
        });
    }, [todos, selectedDate]);

    // 统计数据
    const stats = useMemo(() => {
        const total = dailyTodos.length;
        const completed = dailyTodos.filter(t => t.completed).length;
        const pending = total - completed;
        const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

        return { total, completed, pending, completionRate };
    }, [dailyTodos]);

    // 按分类分组
    const todosByCategory = useMemo(() => {
        const map = new Map();
        dailyTodos.forEach(todo => {
            const category = todo.category || '未分类';
            if (!map.has(category)) {
                map.set(category, []);
            }
            map.get(category).push(todo);
        });
        return map;
    }, [dailyTodos]);

    // 逾期待办（截止日期已过且未完成）
    const overdueTodos = useMemo(() => {
        const today = new Date(new Date().toDateString());
        return todos.filter(todo => {
            if (todo.completed || !todo.deadline) return false;
            return new Date(todo.deadline) < today;
        });
    }, [todos]);

    // Load saved review when date changes
    useEffect(() => {
        const loadReview = async () => {
            const review = await ReviewService.getByDate(selectedDate);
            setSavedReview(review);
            if (review) {
                setReviewNote(review.note || '');
            } else {
                setReviewNote('');
            }
        };
        loadReview();
    }, [selectedDate]);

    const handleDateChange = (e) => {
        setSelectedDate(e.target.value);
        setShowNoteEditor(false);
    };

    const handleSaveReview = async () => {
        if (!reviewNote.trim()) return;
        setSaving(true);
        try {
            const review = await ReviewService.save({
                date: selectedDate,
                note: reviewNote,
                stats
            });
            setSavedReview(review);
            if (onSaveReview) {
                onSaveReview({ date: selectedDate, note: reviewNote, stats });
            }
            setShowNoteEditor(false);
        } catch (e) {
            console.warn('Save review failed:', e);
        } finally {
            setSaving(false);
        }
    };

    const isToday = selectedDate === new Date().toISOString().split('T')[0];

    return (
        <div className="daily-review">
            {/* 日期选择器 */}
            <div className="daily-review-header">
                <div className="daily-review-date-picker">
                    <label htmlFor="review-date">选择日期：</label>
                    <input
                        id="review-date"
                        type="date"
                        value={selectedDate}
                        onChange={handleDateChange}
                        max={new Date().toISOString().split('T')[0]}
                        className="input"
                    />
                    {isToday && <span className="badge badge-success">今天</span>}
                </div>

                <button
                    className="btn btn-sm btn-primary"
                    onClick={() => setShowNoteEditor(!showNoteEditor)}
                >
                    {showNoteEditor ? '取消编辑' : '📝 写复盘'}
                </button>
            </div>

            {/* 统计卡片 */}
            <div className="daily-review-stats">
                <div className="review-stat-card">
                    <div className="review-stat-icon">📊</div>
                    <div className="review-stat-content">
                        <div className="review-stat-value">{stats.total}</div>
                        <div className="review-stat-label">总待办</div>
                    </div>
                </div>

                <div className="review-stat-card review-stat-success">
                    <div className="review-stat-icon">✓</div>
                    <div className="review-stat-content">
                        <div className="review-stat-value">{stats.completed}</div>
                        <div className="review-stat-label">已完成</div>
                    </div>
                </div>

                <div className="review-stat-card review-stat-warning">
                    <div className="review-stat-icon">⏳</div>
                    <div className="review-stat-content">
                        <div className="review-stat-value">{stats.pending}</div>
                        <div className="review-stat-label">未完成</div>
                    </div>
                </div>

                <div className="review-stat-card review-stat-info">
                    <div className="review-stat-icon">📈</div>
                    <div className="review-stat-content">
                        <div className="review-stat-value">{stats.completionRate}%</div>
                        <div className="review-stat-label">完成率</div>
                    </div>
                </div>
            </div>

            {/* 复盘笔记编辑器 */}
            {showNoteEditor && (
                <div className="daily-review-note-editor">
                    <h4>📝 今日复盘</h4>
                    <textarea
                        className="review-textarea"
                        placeholder="记录今天的收获、反思和改进计划...&#10;&#10;例如:&#10;- 今天完成了哪些重要任务？&#10;- 遇到了什么困难？如何解决的？&#10;- 明天需要重点关注什么？"
                        value={reviewNote}
                        onChange={(e) => setReviewNote(e.target.value)}
                        rows={8}
                    />
                    <div className="review-note-actions">
                        <button
                            className="btn btn-primary"
                            onClick={handleSaveReview}
                            disabled={!reviewNote.trim() || saving}
                        >
                            {saving ? '保存中...' : (savedReview ? '更新复盘' : '保存复盘')}
                        </button>
                    </div>
                </div>
            )}

            {/* 已保存的复盘内容 */}
            {savedReview && !showNoteEditor && (
                <div className="daily-review-saved">
                    <div className="daily-review-saved-header">
                        <h4>📝 复盘记录</h4>
                        <button
                            className="btn btn-sm btn-secondary"
                            onClick={() => setShowNoteEditor(true)}
                        >
                            编辑
                        </button>
                    </div>
                    <div className="daily-review-saved-content">
                        {savedReview.note.split('\n').map((line, i) => (
                            <p key={i}>{line || '\u00A0'}</p>
                        ))}
                    </div>
                    <div className="text-muted text-sm mt-sm">
                        保存于 {new Date(savedReview.updatedAt).toLocaleString()}
                    </div>
                </div>
            )}

            {/* 逾期待办 */}
            {overdueTodos.length > 0 && (
                <div className="review-overdue-section">
                    <h4>⚠️ 逾期待办 ({overdueTodos.length})</h4>
                    <div className="review-todo-list">
                        {overdueTodos.map(todo => (
                            <div key={todo.id} className="review-todo-item review-todo-overdue">
                                <label className="review-todo-status" style={{ cursor: onToggleComplete ? 'pointer' : 'default' }}>
                                    <input
                                        type="checkbox"
                                        checked={todo.completed}
                                        onChange={() => onToggleComplete && onToggleComplete(todo)}
                                        style={{ display: 'none' }}
                                    />
                                    ○
                                </label>
                                <div className="review-todo-content">
                                    <div className="review-todo-text">{todo.content}</div>
                                    <div className="review-todo-meta">
                                        {todo.deadline && (
                                            <span className="review-todo-deadline" style={{ color: 'var(--accent-error)' }}>
                                                📅 {new Date(todo.deadline).toLocaleDateString()}
                                            </span>
                                        )}
                                        {todo.category && (
                                            <span className={`priority-badge`}>🏷️ {todo.category}</span>
                                        )}
                                        {todo.assignee && (
                                            <span className="review-todo-assignee">👤 {todo.assignee}</span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* 待办列表 */}
            {dailyTodos.length > 0 ? (
                <div className="daily-review-todos">
                    <h4>📋 当日待办详情</h4>

                    {/* 按分类展示 */}
                    {Array.from(todosByCategory.entries()).map(([category, categoryTodos]) => (
                        <div key={category} className="review-category-section">
                            <h5 className="review-category-title">
                                🏷️ {category} ({categoryTodos.length})
                            </h5>
                            <div className="review-todo-list">
                                {categoryTodos.map(todo => (
                                    <div
                                        key={todo.id}
                                        className={`review-todo-item ${todo.completed ? 'review-todo-completed' : ''}`}
                                    >
                                        <label className="review-todo-status" style={{ cursor: onToggleComplete ? 'pointer' : 'default' }}>
                                            <input
                                                type="checkbox"
                                                checked={todo.completed}
                                                onChange={() => onToggleComplete && onToggleComplete(todo)}
                                                style={{ display: 'none' }}
                                            />
                                            {todo.completed ? '✓' : '○'}
                                        </label>
                                        <div className="review-todo-content">
                                            <div className="review-todo-text">{todo.content}</div>
                                            <div className="review-todo-meta">
                                                {todo.priority && (
                                                    <span className={`priority-badge priority-${todo.priority}`}>
                                                        {todo.priority}
                                                    </span>
                                                )}
                                                {todo.assignee && (
                                                    <span className="review-todo-assignee">
                                                        👤 {todo.assignee}
                                                    </span>
                                                )}
                                                {todo.deadline && (
                                                    <span className="review-todo-deadline">
                                                        📅 {new Date(todo.deadline).toLocaleDateString()}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="daily-review-empty">
                    <div className="daily-review-empty-icon">📭</div>
                    <div className="daily-review-empty-text">
                        {isToday ? '今天还没有待办事项' : '这一天没有待办事项'}
                    </div>
                </div>
            )}
        </div>
    );
}

export default TodoDailyReview;
