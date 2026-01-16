import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { usePageStore } from '../../store/pageStore';
import { PageService, SegmentService, AudioService, TodoService } from '../../services/Database';
import { formatDateTime, formatDurationHuman, escapeHtml, downloadFile } from '../../utils/helpers';

function DetailView() {
    const { id } = useParams();
    const navigate = useNavigate();

    const {
        pages,
        pageSummary,
        pageTodos,
        summaryLoading,
        todosLoading,
        geminiAvailable,
        loadPages,
        deletePage,
        updatePage,
        setSummaryLoading,
        setPageSummary,
        loadTodos,
        setPageTodos,
        toggleTodo
    } = usePageStore();

    const [page, setPage] = useState(null);
    const [segments, setSegments] = useState([]);
    const [audioUrl, setAudioUrl] = useState(null);
    const [audioLoading, setAudioLoading] = useState(true);
    const summaryLoadedFromPageRef = useRef(false);

    useEffect(() => {
        if (!id) return;
        summaryLoadedFromPageRef.current = false;
        setPageSummary(null);
    }, [id, setPageSummary]);

    useEffect(() => {
        if (id) {
            loadPageData();
        }
    }, [id, pages]);

    const loadPageData = async () => {
        // Load page
        const foundPage = pages.find(p => p.id === id);
        if (foundPage) {
            setPage(foundPage);
            if (!summaryLoadedFromPageRef.current && foundPage.summary) {
                setPageSummary(buildSummaryText(foundPage));
                summaryLoadedFromPageRef.current = true;
            }
        }

        // Load segments
        const segs = await SegmentService.getFinalByPageId(id);
        setSegments(segs);

        // Load audio
        loadAudio();

        // Load todos
        await loadTodos(id);
        const localTodos = await TodoService.getByPageId(id);
        if (localTodos.length === 0 && foundPage?.todos?.length) {
            const syncedTodos = await TodoService.upsertBatch(id, foundPage.todos);
            setPageTodos(syncedTodos);
        }
    };

    function buildSummaryText(pageData) {
        if (!pageData?.summary) return null;
        const title = pageData.autoTitle || pageData.title || 'AI 总结';
        let summaryText = `## ${title}\n\n${pageData.summary}\n\n`;
        if (pageData.keyPoints && pageData.keyPoints.length > 0) {
            summaryText += `### 关键要点\n${pageData.keyPoints.map(p => `- ${p}`).join('\n')}\n\n`;
        }
        if (pageData.decisions && pageData.decisions.length > 0) {
            summaryText += `### 决策\n${pageData.decisions.map(d => `- ${d}`).join('\n')}`;
        }
        return summaryText.trim();
    }

    const loadAudio = async () => {
        setAudioLoading(true);
        try {
            const audioBlob = await AudioService.getAudio(id);
            if (audioBlob) {
                const url = URL.createObjectURL(audioBlob);
                setAudioUrl(url);
            } else {
                const response = await fetch(`/api/pages/${id}/audio`);
                if (response.ok) {
                    const blob = await response.blob();
                    const url = URL.createObjectURL(blob);
                    setAudioUrl(url);
                }
            }
        } catch (error) {
            console.error('Failed to load audio:', error);
        } finally {
            setAudioLoading(false);
        }
    };

    const handleTitleChange = async (newTitle) => {
        if (page) {
            await updatePage(id, { title: newTitle });
            await loadPages();
            setPage({ ...page, title: newTitle });
        }
    };

    const handleDelete = async () => {
        await deletePage(id);
        navigate('/');
    };

    const handleExport = () => {
        if (!page) return;

        let content = `# ${page.title || page.autoTitle || '未命名会议'}\\n\\n`;
        content += `创建时间：${formatDateTime(page.createdAt)}\\n`;
        content += `时长：${formatDurationHuman(page.duration)}\\n\\n`;
        content += `## 转录内容\\n\\n`;

        let lastSpeaker = null;
        segments.forEach(seg => {
            const speaker = seg.speakerLabel || '说话人';
            if (speaker !== lastSpeaker) {
                content += `\\n【${speaker}】\\n`;
                lastSpeaker = speaker;
            }
            content += seg.text + ' ';
        });

        if (pageSummary) {
            content += `\\n\\n## AI 总结\\n\\n${pageSummary}`;
        }

        downloadFile(content, `meeting-${page.createdAt}.txt`, 'text/plain');
    };

    const handleDownloadAudio = async () => {
        if (!audioUrl || !page) return;

        const response = await fetch(audioUrl);
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `meeting-${page.createdAt}.webm`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleGenerateSummary = async () => {
        if (summaryLoading || !geminiAvailable) return;

        setSummaryLoading(true);
        setPageSummary(null);

        try {
            if (segments.length === 0) {
                setPageSummary('⚠️ 无转录内容，无法生成总结。');
                setSummaryLoading(false);
                return;
            }

            // Build transcript
            let transcript = '';
            let lastSpeaker = null;

            segments.forEach(seg => {
                const speaker = seg.speakerLabel || '说话人';
                if (speaker !== lastSpeaker) {
                    transcript += `\\n【${speaker}】\\n`;
                    lastSpeaker = speaker;
                }
                transcript += seg.text + ' ';
            });

            // Call API
            const response = await fetch('/api/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ transcript: transcript.trim() })
            });

            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
            }

            const result = await response.json();

            if (result.success) {
                let summaryText = `## ${result.title}\\n\\n${result.summary}\\n\\n`;
                if (result.key_points && result.key_points.length > 0) {
                    summaryText += `### 关键要点\\n${result.key_points.map(p => `- ${p}`).join('\\n')}\\n\\n`;
                }
                if (result.decisions && result.decisions.length > 0) {
                    summaryText += `### 决策\\n${result.decisions.map(d => `- ${d}`).join('\\n')}`;
                }

                setPageSummary(summaryText);

                // Reload todos if generated
                let storedTodos = [];
                if (result.todos && result.todos.length > 0) {
                    await TodoService.deleteByPageId(id);
                    storedTodos = await TodoService.addBatch(id, result.todos);
                    await loadTodos(id);
                } else {
                    await TodoService.deleteByPageId(id);
                    setPageTodos([]);
                }

                const shouldUpdateTitle = !page?.title || page.title.startsWith('录音 ');
                const wordCount = transcript.replace(/\s+/g, '').length;
                const updates = {
                    autoTitle: result.title,
                    summary: result.summary,
                    keyPoints: result.key_points || [],
                    decisions: result.decisions || [],
                    todos: storedTodos,
                    todoCount: storedTodos.length,
                    wordCount,
                    analyzed: true
                };
                if (shouldUpdateTitle) {
                    updates.title = result.title;
                }

                const updatedPage = await updatePage(id, updates);
                if (updatedPage) {
                    setPage(updatedPage);
                }

                await loadPages();
            } else {
                setPageSummary('❌ 分析失败');
            }
        } catch (error) {
            console.error('Summary generation failed:', error);
            setPageSummary(`❌ 生成失败: ${error.message}`);
        } finally {
            setSummaryLoading(false);
        }
    };

    const renderTranscript = () => {
        if (segments.length === 0) {
            return (
                <div className="transcript-placeholder text-center">
                    <p>暂无转录内容</p>
                </div>
            );
        }

        let html = '<div class="transcript-segments">';
        let lastSpeaker = null;

        segments.forEach((seg) => {
            const isNewSpeaker = seg.speaker !== lastSpeaker;
            if (isNewSpeaker) {
                if (lastSpeaker !== null) {
                    html += '</div></div>';
                }
                html += `
          <div class="speaker-block">
            <div class="speaker-label" style="color: ${seg.speakerColor}">
              <span class="speaker-dot" style="background-color: ${seg.speakerColor}"></span>
              ${escapeHtml(seg.speakerLabel)}
            </div>
            <div class="speaker-text">
        `;
            }

            html += `<span class="segment-text">${escapeHtml(seg.text)} </span>`;
            lastSpeaker = seg.speaker;
        });

        if (segments.length > 0) {
            html += '</div></div>';
        }

        html += '</div>';
        return <div dangerouslySetInnerHTML={{ __html: html }} />;
    };

    if (!page) {
        return <div className="loading">加载中...</div>;
    }

    const displayTitle = page.autoTitle && page.title && page.title.startsWith('录音 ')
        ? page.autoTitle
        : (page.title || page.autoTitle || '');

    return (
        <div className="page-detail">
            <div className="page-detail-header">
                <div className="page-detail-title">
                    <input
                        type="text"
                        value={displayTitle}
                        onChange={(e) => handleTitleChange(e.target.value)}
                        placeholder="输入标题..."
                    />
                </div>
                <div className="page-detail-meta">
                    <span>📅 {formatDateTime(page.createdAt)}</span>
                    <span>⏱️ {formatDurationHuman(page.duration)}</span>
                </div>
            </div>

            <div className="audio-player-section">
                <div className="audio-controls">
                    {audioLoading ? (
                        <div>🔄 加载音频中...</div>
                    ) : audioUrl ? (
                        <audio controls src={audioUrl} style={{ width: '100%' }}></audio>
                    ) : (
                        <div>❌ 无音频</div>
                    )}
                </div>
                <div className="audio-actions mt-sm">
                    <button
                        className="btn btn-sm btn-secondary"
                        onClick={handleDownloadAudio}
                        disabled={!audioUrl}
                    >
                        💾 下载音频
                    </button>
                </div>
            </div>

            <div className="detail-columns">
                <div className="detail-panel transcript-panel">
                    <div className="detail-panel-header">
                        <h3>📝 会议内容</h3>
                    </div>
                    <div className="detail-panel-body">
                        {renderTranscript()}
                    </div>
                </div>

                <div className="summary-panel">
                    <div className="summary-header">
                        <h3>🤖 AI 总结</h3>
                        <div className="summary-actions">
                            {geminiAvailable ? (
                                <button
                                    className="btn btn-sm btn-primary"
                                    onClick={handleGenerateSummary}
                                    disabled={summaryLoading}
                                >
                                    {summaryLoading ? '⏳ 生成中...' : '✨ 生成总结'}
                                </button>
                            ) : (
                                <span className="text-muted text-sm">⚠️ 后端 Gemini 未配置</span>
                            )}
                        </div>
                    </div>
                    <div className="summary-content">
                        {pageSummary ? (
                            <div
                                className="summary-text"
                                dangerouslySetInnerHTML={{
                                    __html: pageSummary.replace(/\n/g, '<br>')
                                }}
                            />
                        ) : (
                            <p className="text-muted">
                                点击「生成总结」按钮，AI 将自动分析会议内容并生成摘要和待办事项。
                            </p>
                        )}
                    </div>
                </div>

                <div className="todo-panel">
                    <div className="todo-header">
                        <h3>✅ 待办事项</h3>
                        <div className="todo-count">
                            {pageTodos.filter(t => t.completed).length}/{pageTodos.length} 已完成
                        </div>
                    </div>
                    <div className="todo-content">
                        {todosLoading ? (
                            <p className="text-muted">加载中...</p>
                        ) : pageTodos.length === 0 ? (
                            <p className="text-muted">暂无待办事项</p>
                        ) : (
                            <div className="todo-list">
                                {pageTodos.map(todo => (
                                    <div key={todo.id} className={`todo-item ${todo.completed ? 'completed' : ''}`}>
                                        <label className="todo-check">
                                            <input
                                                type="checkbox"
                                                checked={todo.completed}
                                                onChange={() => toggleTodo(todo.id)}
                                            />
                                            <span className="todo-text">{todo.content}</span>
                                        </label>
                                        <div className="todo-meta">
                                            {todo.assignee && <span className="todo-chip">👤 {todo.assignee}</span>}
                                            {todo.deadline && <span className="todo-chip">📅 {todo.deadline}</span>}
                                            {todo.priority && <span className="todo-chip">⚡ {todo.priority}</span>}
                                            {todo.category && <span className="todo-chip">🏷️ {todo.category}</span>}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div className="flex gap-md mt-lg">
                <button className="btn btn-primary" onClick={handleExport}>
                    📥 导出为文本
                </button>
                <button className="btn btn-danger" onClick={handleDelete}>
                    🗑️ 删除录音
                </button>
            </div>
        </div>
    );
}

export default DetailView;
