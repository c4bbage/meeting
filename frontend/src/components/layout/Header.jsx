import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useRecordingStore } from '../../store/recordingStore';
import { usePageStore } from '../../store/pageStore';

function Header() {
    const navigate = useNavigate();
    const location = useLocation();
    const { checkGeminiStatus, geminiAvailable, startGeminiPolling, stopGeminiPolling } = usePageStore();
    const { whisperAvailable, checkWhisperStatus, isRecording, activeRecordingPageId, useWhisper, toggleWhisper } = useRecordingStore();
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);

    // Check status on mount and start polling
    useEffect(() => {
        checkWhisperStatus();
        startGeminiPolling();

        return () => {
            stopGeminiPolling();
        };
    }, []);

    // Monitor fullscreen changes
    useEffect(() => {
        const handleFullscreenChange = () => {
            setIsFullscreen(!!document.fullscreenElement);
        };

        document.addEventListener('fullscreenchange', handleFullscreenChange);
        return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
    }, []);

    const currentView = location.pathname === '/' ? 'list'
        : location.pathname.startsWith('/recording') ? 'recording'
            : location.pathname.startsWith('/detail') ? 'detail'
                : location.pathname.startsWith('/todos') ? 'todos'
                    : 'other';

    const handleStartNewRecording = async () => {
        if (isRecording && activeRecordingPageId) {
            navigate('/recording');
        } else {
            navigate('/recording');
        }
        setMobileMenuOpen(false);
    };

    const toggleFullscreen = async () => {
        try {
            if (!document.fullscreenElement) {
                await document.documentElement.requestFullscreen();
            } else {
                await document.exitFullscreen();
            }
        } catch (err) {
            console.error('Fullscreen toggle failed:', err);
        }
    };

    const handleNavClick = (path) => {
        navigate(path);
        setMobileMenuOpen(false);
    };

    return (
        <header className="header">
            <div className="header-content">
                <div className="header-left">
                    <h1 className="header-title" onClick={() => handleNavClick('/')} style={{ cursor: 'pointer' }}>
                        🎤 Meeting Transcription
                    </h1>
                </div>

                {/* Mobile Menu Toggle Button */}
                <button
                    className="mobile-menu-toggle btn btn-icon btn-secondary"
                    onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                    aria-label="Toggle menu"
                >
                    {mobileMenuOpen ? '✕' : '☰'}
                </button>

                <div className={`header-center ${mobileMenuOpen ? 'mobile-menu-open' : ''}`}>
                    <nav className="nav">
                        <button
                            className={`btn btn-sm nav-item ${currentView === 'list' ? 'btn-primary' : 'btn-secondary'}`}
                            onClick={() => handleNavClick('/')}
                        >
                            📝 会议列表
                        </button>
                        <button
                            className="btn btn-sm nav-item btn-primary"
                            onClick={handleStartNewRecording}
                        >
                            ➕ 新建录音
                        </button>
                        <button
                            className={`btn btn-sm nav-item ${currentView === 'hotwords' ? 'btn-primary' : 'btn-secondary'}`}
                            onClick={() => handleNavClick('/hotwords')}
                        >
                            🔤 热词管理
                        </button>
                        <button
                            className={`btn btn-sm nav-item ${currentView === 'todos' ? 'btn-primary' : 'btn-secondary'}`}
                            onClick={() => handleNavClick('/todos')}
                        >
                            ✅ 待办总览
                        </button>
                    </nav>
                </div>

                <div className="header-right">
                    <div className="header-status">
                        {/* Fullscreen Toggle Button - Desktop Only */}
                        <button
                            className="btn btn-icon btn-secondary fullscreen-btn"
                            onClick={toggleFullscreen}
                            title={isFullscreen ? '退出全屏' : '全屏显示'}
                        >
                            {isFullscreen ? '⛶' : '⛶'}
                        </button>

                        {whisperAvailable && (
                            <button
                                className={`btn btn-sm ${useWhisper ? 'btn-primary' : 'btn-secondary'}`}
                                onClick={toggleWhisper}
                                title="切换转录引擎"
                            >
                                {useWhisper ? '🧠 FunASR' : '🌐 Web Speech'}
                            </button>
                        )}

                        <div className="status-indicator" title={geminiAvailable ? 'Gemini AI 已就绪' : 'Gemini AI 不可用'}>
                            <span className={`status-dot ${geminiAvailable ? 'active' : ''}`}></span>
                            <span className="status-label">Gemini AI: {geminiAvailable ? '✅ Available' : '❌ Unavailable'}</span>
                        </div>
                    </div>
                </div>
            </div>
        </header>
    );
}

export default Header;
