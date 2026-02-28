import { useMemo } from 'react';

function TodoAnalytics({ todos }) {
    // 按分类统计
    const categoryStats = useMemo(() => {
        const stats = new Map();

        todos.forEach(todo => {
            const category = todo.category || '未分类';
            if (!stats.has(category)) {
                stats.set(category, { total: 0, completed: 0 });
            }
            const stat = stats.get(category);
            stat.total++;
            if (todo.completed) stat.completed++;
        });

        return Array.from(stats.entries()).map(([category, data]) => ({
            category,
            total: data.total,
            completed: data.completed,
            pending: data.total - data.completed,
            completionRate: data.total > 0 ? Math.round((data.completed / data.total) * 100) : 0
        })).sort((a, b) => b.total - a.total);
    }, [todos]);

    // 按优先级统计
    const priorityStats = useMemo(() => {
        const stats = { '高': 0, '中': 0, '低': 0, '未设置': 0 };
        const completed = { '高': 0, '中': 0, '低': 0, '未设置': 0 };

        todos.forEach(todo => {
            const priority = todo.priority || '未设置';
            stats[priority] = (stats[priority] || 0) + 1;
            if (todo.completed) {
                completed[priority] = (completed[priority] || 0) + 1;
            }
        });

        return Object.entries(stats).map(([priority, total]) => ({
            priority,
            total,
            completed: completed[priority],
            pending: total - completed[priority],
            completionRate: total > 0 ? Math.round((completed[priority] / total) * 100) : 0
        }));
    }, [todos]);

    // 按负责人统计
    const assigneeStats = useMemo(() => {
        const stats = new Map();

        todos.forEach(todo => {
            const assignee = todo.assignee || '未分配';
            if (!stats.has(assignee)) {
                stats.set(assignee, { total: 0, completed: 0 });
            }
            const stat = stats.get(assignee);
            stat.total++;
            if (todo.completed) stat.completed++;
        });

        return Array.from(stats.entries()).map(([assignee, data]) => ({
            assignee,
            total: data.total,
            completed: data.completed,
            pending: data.total - data.completed,
            completionRate: data.total > 0 ? Math.round((data.completed / data.total) * 100) : 0
        })).sort((a, b) => b.total - a.total);
    }, [todos]);

    // 总体统计
    const overallStats = useMemo(() => {
        const total = todos.length;
        const completed = todos.filter(t => t.completed).length;
        const pending = total - completed;
        const needsFollowUp = todos.filter(t => t.needsReminder && !t.completed).length;
        const overdue = todos.filter(t => {
            if (t.completed || !t.deadline) return false;
            return new Date(t.deadline) < new Date();
        }).length;

        return {
            total,
            completed,
            pending,
            needsFollowUp,
            overdue,
            completionRate: total > 0 ? Math.round((completed / total) * 100) : 0
        };
    }, [todos]);

    // 最近8周趋势
    const weeklyTrend = useMemo(() => {
        const weeks = [];
        const now = new Date();
        for (let i = 7; i >= 0; i--) {
            const weekStart = new Date(now);
            weekStart.setDate(now.getDate() - now.getDay() + 1 - i * 7);
            weekStart.setHours(0, 0, 0, 0);
            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekStart.getDate() + 6);
            weekEnd.setHours(23, 59, 59, 999);

            const weekTodos = todos.filter(t => {
                const d = new Date(t.deadline || t.createdAt);
                return d >= weekStart && d <= weekEnd;
            });
            const total = weekTodos.length;
            const completed = weekTodos.filter(t => t.completed).length;
            const mm = String(weekStart.getMonth() + 1).padStart(2, '0');
            const dd = String(weekStart.getDate()).padStart(2, '0');

            weeks.push({
                label: `${mm}/${dd}`,
                total,
                completed,
                rate: total > 0 ? Math.round((completed / total) * 100) : 0
            });
        }
        return weeks;
    }, [todos]);

    return (
        <div className="todo-analytics">
            {/* 总体统计卡片 */}
            <div className="analytics-overview">
                <div className="analytics-card">
                    <div className="analytics-card-icon">📊</div>
                    <div className="analytics-card-content">
                        <div className="analytics-card-value">{overallStats.total}</div>
                        <div className="analytics-card-label">总待办</div>
                    </div>
                </div>

                <div className="analytics-card analytics-card-success">
                    <div className="analytics-card-icon">✓</div>
                    <div className="analytics-card-content">
                        <div className="analytics-card-value">{overallStats.completed}</div>
                        <div className="analytics-card-label">已完成</div>
                    </div>
                </div>

                <div className="analytics-card analytics-card-warning">
                    <div className="analytics-card-icon">⏳</div>
                    <div className="analytics-card-content">
                        <div className="analytics-card-value">{overallStats.pending}</div>
                        <div className="analytics-card-label">进行中</div>
                    </div>
                </div>

                <div className="analytics-card analytics-card-error">
                    <div className="analytics-card-icon">⚠️</div>
                    <div className="analytics-card-content">
                        <div className="analytics-card-value">{overallStats.overdue}</div>
                        <div className="analytics-card-label">已逾期</div>
                    </div>
                </div>

                <div className="analytics-card analytics-card-info">
                    <div className="analytics-card-icon">🔔</div>
                    <div className="analytics-card-content">
                        <div className="analytics-card-value">{overallStats.needsFollowUp}</div>
                        <div className="analytics-card-label">需跟进</div>
                    </div>
                </div>
            </div>

            {/* 完成率进度条 */}
            <div className="analytics-section">
                <h3 className="analytics-section-title">📈 总体完成率</h3>
                <div className="progress-bar-container">
                    <div className="progress-bar">
                        <div
                            className="progress-bar-fill"
                            style={{ width: `${overallStats.completionRate}%` }}
                        >
                            {overallStats.completionRate}%
                        </div>
                    </div>
                    <div className="progress-bar-label">
                        {overallStats.completed} / {overallStats.total} 已完成
                    </div>
                </div>
            </div>

            {/* 周趋势图 */}
            <div className="analytics-section">
                <h3 className="analytics-section-title">📅 近8周趋势</h3>
                <div className="analytics-weekly-chart">
                    {weeklyTrend.map((week, i) => {
                        const maxTotal = Math.max(...weeklyTrend.map(w => w.total), 1);
                        const barHeight = Math.max((week.total / maxTotal) * 100, 4);
                        const completedHeight = week.total > 0 ? (week.completed / week.total) * barHeight : 0;
                        return (
                            <div key={i} className="analytics-week-bar-group">
                                <div className="analytics-week-bar-container" title={`${week.label}: ${week.completed}/${week.total} 完成 (${week.rate}%)`}>
                                    <div className="analytics-week-bar-bg" style={{ height: `${barHeight}%` }}>
                                        <div className="analytics-week-bar-fill" style={{ height: `${completedHeight > 0 ? (completedHeight / barHeight) * 100 : 0}%` }} />
                                    </div>
                                </div>
                                <div className="analytics-week-label">{week.label}</div>
                                <div className="analytics-week-count">{week.total > 0 ? `${week.rate}%` : '-'}</div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* 分类统计 */}
            <div className="analytics-section">
                <h3 className="analytics-section-title">🏷️ 分类统计</h3>
                {categoryStats.length > 0 ? (
                    <div className="analytics-table">
                        <table>
                            <thead>
                                <tr>
                                    <th>分类</th>
                                    <th>总数</th>
                                    <th>已完成</th>
                                    <th>进行中</th>
                                    <th>完成率</th>
                                </tr>
                            </thead>
                            <tbody>
                                {categoryStats.map(stat => (
                                    <tr key={stat.category}>
                                        <td className="analytics-table-category">{stat.category}</td>
                                        <td>{stat.total}</td>
                                        <td className="text-success">{stat.completed}</td>
                                        <td className="text-warning">{stat.pending}</td>
                                        <td>
                                            <div className="analytics-mini-progress">
                                                <div
                                                    className="analytics-mini-progress-fill"
                                                    style={{ width: `${stat.completionRate}%` }}
                                                />
                                                <span className="analytics-mini-progress-text">
                                                    {stat.completionRate}%
                                                </span>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div className="analytics-empty">暂无分类数据</div>
                )}
            </div>

            {/* 优先级统计 */}
            <div className="analytics-section">
                <h3 className="analytics-section-title">🎯 优先级统计</h3>
                <div className="analytics-priority-grid">
                    {priorityStats.map(stat => (
                        <div key={stat.priority} className="analytics-priority-card">
                            <div className="analytics-priority-header">
                                <span className={`priority-badge priority-${stat.priority}`}>
                                    {stat.priority}
                                </span>
                                <span className="analytics-priority-total">{stat.total}</span>
                            </div>
                            <div className="analytics-priority-stats">
                                <div className="analytics-priority-stat">
                                    <span className="text-success">✓ {stat.completed}</span>
                                </div>
                                <div className="analytics-priority-stat">
                                    <span className="text-warning">⏳ {stat.pending}</span>
                                </div>
                            </div>
                            <div className="analytics-priority-progress">
                                <div
                                    className="analytics-priority-progress-fill"
                                    style={{ width: `${stat.completionRate}%` }}
                                />
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* 负责人统计 */}
            <div className="analytics-section">
                <h3 className="analytics-section-title">👥 负责人统计</h3>
                {assigneeStats.length > 0 ? (
                    <div className="analytics-table">
                        <table>
                            <thead>
                                <tr>
                                    <th>负责人</th>
                                    <th>总数</th>
                                    <th>已完成</th>
                                    <th>进行中</th>
                                    <th>完成率</th>
                                </tr>
                            </thead>
                            <tbody>
                                {assigneeStats.map(stat => (
                                    <tr key={stat.assignee}>
                                        <td className="analytics-table-assignee">{stat.assignee}</td>
                                        <td>{stat.total}</td>
                                        <td className="text-success">{stat.completed}</td>
                                        <td className="text-warning">{stat.pending}</td>
                                        <td>
                                            <div className="analytics-mini-progress">
                                                <div
                                                    className="analytics-mini-progress-fill"
                                                    style={{ width: `${stat.completionRate}%` }}
                                                />
                                                <span className="analytics-mini-progress-text">
                                                    {stat.completionRate}%
                                                </span>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div className="analytics-empty">暂无负责人数据</div>
                )}
            </div>
        </div>
    );
}

export default TodoAnalytics;