import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePageStore } from '../../store/pageStore';
import { SegmentService } from '../../services/Database';
import { formatDateTime, formatDurationHuman, truncate } from '../../utils/helpers';

const PAGE_SIZE_OPTIONS = [6, 12, 24];

function ListView() {
    const navigate = useNavigate();
    const pages = usePageStore(state => state.pages);
    const loadPages = usePageStore(state => state.loadPages);
    const [pageSize, setPageSize] = useState(PAGE_SIZE_OPTIONS[1]);
    const [pageIndex, setPageIndex] = useState(1);
    const [searchText, setSearchText] = useState('');
    const [includeTranscript, setIncludeTranscript] = useState(false);
    const [transcriptMatches, setTranscriptMatches] = useState(new Set());
    const [transcriptSearching, setTranscriptSearching] = useState(false);

    useEffect(() => {
        loadPages();
    }, [loadPages]);

    useEffect(() => {
        setPageIndex(1);
    }, [searchText, includeTranscript, pageSize]);

    useEffect(() => {
        let active = true;
        const query = searchText.trim();
        if (!includeTranscript || !query) {
            setTranscriptMatches(new Set());
            setTranscriptSearching(false);
            return undefined;
        }

        setTranscriptSearching(true);
        const timer = setTimeout(() => {
            SegmentService.searchPageIdsByText(query)
                .then(ids => {
                    if (!active) return;
                    setTranscriptMatches(new Set(ids));
                })
                .finally(() => {
                    if (!active) return;
                    setTranscriptSearching(false);
                });
        }, 300);

        return () => {
            active = false;
            clearTimeout(timer);
        };
    }, [searchText, includeTranscript]);

    const filteredPages = useMemo(() => {
        const query = searchText.trim().toLowerCase();
        if (!query) return pages;
        return pages.filter(page => {
            const metaParts = [
                page.title,
                page.autoTitle,
                page.preview,
                page.summary,
                ...(page.keyPoints || []),
                ...(page.decisions || [])
            ].filter(Boolean);

            const metaText = metaParts.join(' ').toLowerCase();
            const metaMatch = metaText.includes(query);
            const transcriptMatch = includeTranscript && transcriptMatches.has(page.id);
            return metaMatch || transcriptMatch;
        });
    }, [pages, searchText, includeTranscript, transcriptMatches]);

    const totalPages = Math.max(1, Math.ceil(filteredPages.length / pageSize));

    useEffect(() => {
        if (pageIndex > totalPages) {
            setPageIndex(totalPages);
        }
    }, [pageIndex, totalPages]);

    const pagedPages = useMemo(() => {
        const start = (pageIndex - 1) * pageSize;
        return filteredPages.slice(start, start + pageSize);
    }, [filteredPages, pageIndex, pageSize]);

    const pageNumbers = useMemo(() => {
        const buttons = [];
        const maxButtons = 5;
        let start = Math.max(1, pageIndex - Math.floor(maxButtons / 2));
        let end = Math.min(totalPages, start + maxButtons - 1);
        start = Math.max(1, end - maxButtons + 1);
        for (let i = start; i <= end; i++) {
            buttons.push(i);
        }
        return buttons;
    }, [pageIndex, totalPages]);

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
                <p className="text-muted">共 {filteredPages.length} / {pages.length} 条录音</p>
            </div>

            <div className="list-controls">
                <input
                    className="input"
                    type="text"
                    placeholder="搜索标题 / 总结 / 关键点"
                    value={searchText}
                    onChange={(e) => setSearchText(e.target.value)}
                />
                <label className="list-checkbox">
                    <input
                        type="checkbox"
                        checked={includeTranscript}
                        onChange={(e) => setIncludeTranscript(e.target.checked)}
                    />
                    <span>包含转录内容</span>
                </label>
                {includeTranscript && transcriptSearching && (
                    <span className="text-muted text-sm">正在搜索转录...</span>
                )}
            </div>

            {pages.length === 0 ? (
                <div className="empty-state">
                    <div className="empty-state-icon">🎤</div>
                    <h3>还没有录音</h3>
                    <p className="text-muted">点击右上角「新建录音」开始</p>
                </div>
            ) : (
                <>
                    {filteredPages.length === 0 ? (
                        <div className="empty-state">
                            <div className="empty-state-icon">🔍</div>
                            <h3>没有匹配的会议</h3>
                            <p className="text-muted">调整关键词或关闭转录搜索</p>
                        </div>
                    ) : (
                        <div className="page-list">
                            {pagedPages.map(renderPageCard)}
                        </div>
                    )}
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
                                {pageNumbers.map(number => (
                                    <button
                                        key={number}
                                        className={`btn btn-sm ${number === pageIndex ? 'btn-primary' : 'btn-secondary'}`}
                                        onClick={() => setPageIndex(number)}
                                    >
                                        {number}
                                    </button>
                                ))}
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
                </>
            )}
        </div>
    );
}

export default ListView;
