import { useState, useMemo } from 'react';
import { formatDateTime } from '../../utils/helpers';

function TodoCalendarView({ todos, onDateClick, onCreateTodo }) {
    const [currentDate, setCurrentDate] = useState(new Date());
    const [viewMode, setViewMode] = useState('month'); // 'month' or 'week'
    const [quickAddDate, setQuickAddDate] = useState(null); // dateKey for inline add
    const [quickAddContent, setQuickAddContent] = useState('');

    // 获取当前月份的第一天和最后一天
    const getMonthBounds = (date) => {
        const year = date.getFullYear();
        const month = date.getMonth();
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        return { firstDay, lastDay };
    };

    // 获取当前周的第一天和最后一天
    const getWeekBounds = (date) => {
        const d = new Date(date); // clone to avoid mutating input
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1); // 周一为第一天
        const firstDay = new Date(d);
        firstDay.setDate(diff);
        const lastDay = new Date(firstDay);
        lastDay.setDate(firstDay.getDate() + 6);
        return { firstDay, lastDay };
    };

    // 按日期分组待办事项
    const todosByDate = useMemo(() => {
        const map = new Map();

        todos.forEach(todo => {
            // 使用 deadline 或 createdAt 作为日期
            const dateStr = todo.deadline || todo.createdAt;
            if (!dateStr) return;

            const date = new Date(dateStr);
            const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

            if (!map.has(key)) {
                map.set(key, []);
            }
            map.get(key).push(todo);
        });

        return map;
    }, [todos]);

    // 生成日历网格
    const calendarDays = useMemo(() => {
        const { firstDay, lastDay } = viewMode === 'month'
            ? getMonthBounds(currentDate)
            : getWeekBounds(new Date(currentDate));

        const days = [];
        const startDay = new Date(firstDay);

        // 调整到周一
        const dayOfWeek = startDay.getDay();
        const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        startDay.setDate(startDay.getDate() + diff);

        // 生成日历格子
        const totalDays = viewMode === 'month' ? 42 : 7; // 6周或1周
        for (let i = 0; i < totalDays; i++) {
            const date = new Date(startDay);
            date.setDate(startDay.getDate() + i);

            const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
            const dayTodos = todosByDate.get(dateKey) || [];
            const completed = dayTodos.filter(t => t.completed).length;
            const total = dayTodos.length;

            const today = new Date(new Date().toDateString());
            const overdue = dayTodos.filter(t => !t.completed && t.deadline && new Date(t.deadline) < today).length;

            days.push({
                date: new Date(date),
                dateKey,
                todos: dayTodos,
                completed,
                overdue,
                total,
                isCurrentMonth: date.getMonth() === currentDate.getMonth(),
                isToday: dateKey === new Date().toISOString().split('T')[0]
            });
        }

        return days;
    }, [currentDate, viewMode, todosByDate]);

    const handlePrevious = () => {
        const newDate = new Date(currentDate);
        if (viewMode === 'month') {
            newDate.setMonth(newDate.getMonth() - 1);
        } else {
            newDate.setDate(newDate.getDate() - 7);
        }
        setCurrentDate(newDate);
    };

    const handleNext = () => {
        const newDate = new Date(currentDate);
        if (viewMode === 'month') {
            newDate.setMonth(newDate.getMonth() + 1);
        } else {
            newDate.setDate(newDate.getDate() + 7);
        }
        setCurrentDate(newDate);
    };

    const handleToday = () => {
        setCurrentDate(new Date());
    };

    const handleQuickAdd = async () => {
        if (!quickAddContent.trim() || !quickAddDate || !onCreateTodo) return;
        await onCreateTodo(quickAddContent.trim(), quickAddDate);
        setQuickAddContent('');
        setQuickAddDate(null);
    };

    const handleDayClick = (day) => {
        if (quickAddDate === day.dateKey) return; // don't navigate while quick-adding
        if (day.total > 0) {
            onDateClick(day.dateKey, day.todos);
        } else if (onCreateTodo) {
            setQuickAddDate(day.dateKey);
            setQuickAddContent('');
        }
    };

    const handleQuickAddToggle = (e, dateKey) => {
        e.stopPropagation();
        setQuickAddDate(quickAddDate === dateKey ? null : dateKey);
        setQuickAddContent('');
    };

    const getMonthYearText = () => {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth() + 1;
        return `${year}年${month}月`;
    };

    return (
        <div className="calendar-view">
            {/* 日历头部 */}
            <div className="calendar-header">
                <div className="calendar-controls">
                    <button className="btn btn-sm btn-secondary" onClick={handlePrevious}>
                        ‹ {viewMode === 'month' ? '上月' : '上周'}
                    </button>
                    <button className="btn btn-sm btn-secondary" onClick={handleToday}>
                        今天
                    </button>
                    <button className="btn btn-sm btn-secondary" onClick={handleNext}>
                        {viewMode === 'month' ? '下月' : '下周'} ›
                    </button>
                </div>

                <h3 className="calendar-title">{getMonthYearText()}</h3>

                <div className="calendar-view-toggle">
                    <button
                        className={`btn btn-sm ${viewMode === 'month' ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={() => setViewMode('month')}
                    >
                        月视图
                    </button>
                    <button
                        className={`btn btn-sm ${viewMode === 'week' ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={() => setViewMode('week')}
                    >
                        周视图
                    </button>
                </div>
            </div>

            {/* 星期标题 */}
            <div className="calendar-weekdays">
                {['周一', '周二', '周三', '周四', '周五', '周六', '周日'].map(day => (
                    <div key={day} className="calendar-weekday">{day}</div>
                ))}
            </div>

            {/* 日历网格 */}
            <div className={`calendar-grid ${viewMode === 'week' ? 'calendar-grid-week' : ''}`}>
                {calendarDays.map((day, index) => (
                    <div
                        key={index}
                        className={`calendar-day ${!day.isCurrentMonth ? 'calendar-day-other-month' : ''} ${day.isToday ? 'calendar-day-today' : ''} ${day.total > 0 ? 'calendar-day-has-todos' : ''} ${day.overdue > 0 ? 'calendar-day-overdue' : ''}`}
                        onClick={() => handleDayClick(day)}
                    >
                        <div className="calendar-day-number">{day.date.getDate()}</div>
                        {day.total > 0 && (
                            <>
                                <div className="calendar-day-todos">
                                    <div className="calendar-day-badge">
                                        {day.completed}/{day.total}
                                    </div>
                                    {day.overdue > 0 && (
                                        <div className="calendar-day-overdue-badge">
                                            ⚠️ {day.overdue}
                                        </div>
                                    )}
                                    {day.completed === day.total && day.total > 0 && (
                                        <div className="calendar-day-complete-icon">✓</div>
                                    )}
                                </div>
                                <div className="calendar-day-tooltip">
                                    {day.todos.slice(0, 5).map(todo => (
                                        <div key={todo.id} className={`calendar-day-tooltip-item ${todo.completed ? 'completed' : ''}`}>
                                            <span className="calendar-day-tooltip-status">{todo.completed ? '✓' : '○'}</span>
                                            <span>{todo.content}</span>
                                        </div>
                                    ))}
                                    {day.total > 5 && (
                                        <div className="calendar-day-tooltip-more">
                                            还有 {day.total - 5} 项...
                                        </div>
                                    )}
                                </div>
                            </>
                        )}
                        {onCreateTodo && (
                            <div
                                className="calendar-day-add-hint"
                                onClick={(e) => handleQuickAddToggle(e, day.dateKey)}
                                title="添加待办"
                            >+</div>
                        )}
                        {quickAddDate === day.dateKey && (
                            <div className="calendar-day-quick-add" onClick={(e) => e.stopPropagation()}>
                                <input
                                    className="input input-sm"
                                    type="text"
                                    placeholder="新待办..."
                                    value={quickAddContent}
                                    onChange={(e) => setQuickAddContent(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') handleQuickAdd();
                                        if (e.key === 'Escape') setQuickAddDate(null);
                                    }}
                                    autoFocus
                                />
                                <button className="btn btn-sm btn-primary" onClick={handleQuickAdd}>+</button>
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}

export default TodoCalendarView;
