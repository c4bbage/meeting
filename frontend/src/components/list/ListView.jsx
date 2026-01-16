import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePageStore } from '../../store/pageStore';
import { formatDateTime, formatDurationHuman, truncate } from '../../utils/helpers';

function ListView() {
    const navigate = useNavigate();
    const pages = usePageStore(state => state.pages);
    const loadPages = usePageStore(state => state.loadPages);

    useEffect(() => {
        loadPages();
    }, []);

    const handleOpenPage = (pageId) => {
        navigate(`/detail/${pageId}`);
    };

    const renderPageCard = (page) => {
        const title = page.title || page.autoTitle || '未命名会议';
        const preview = page.preview || '';
        const wordCount = page.wordCount || 0;
        const todoCount = page.todoCount || 0;

        return (
            <div
                key={page.id}
                className="card"
                onClick={() => handleOpenPage(page.id)}
                style={{ cursor: 'pointer' }}
            >
                <div className="card-header">
                    <div className="card-title">{title}</div>
                    <div className="card-meta">
                        <span>📅 {formatDateTime(page.createdAt)}</span>
                        <span>⏱️ {formatDurationHuman(page.duration)}</span>
                    </div>
                </div>

                {preview && (
                    <div className="card-content">
                        {truncate(preview, 120)}
                    </div>
                )}

                <div className="card-footer">
                    <div className="card-stats">
                        <span className="stat-item">
                            <span className="stat-icon">📝</span>
                            <span>{wordCount} 字</span>
                        </span>
                        <span className="stat-item">
                            <span className="stat-icon">✅</span>
                            <span>{todoCount} 项待办</span>
                        </span>
                    </div>
                    {page.analyzed && (
                        <span className="badge badge-success">✨ 已分析</span>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div className="list-view">
            <div className="list-header">
                <h2>会议列表</h2>
                <p className="text-muted">共 {pages.length} 条录音</p>
            </div>

            {pages.length === 0 ? (
                <div className="empty-state">
                    <div className="empty-state-icon">🎤</div>
                    <h3>还没有录音</h3>
                    <p className="text-muted">点击右上角「新建录音」开始</p>
                </div>
            ) : (
                <div className="page-list">
                    {pages.map(renderPageCard)}
                </div>
            )}
        </div>
    );
}

export default ListView;
