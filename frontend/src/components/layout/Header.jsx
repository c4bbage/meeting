import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useRecordingStore } from '../../store/recordingStore';
import { usePageStore } from '../../store/pageStore';

function Header() {
    const navigate = useNavigate();
    const location = useLocation();
    const { checkGeminiStatus, geminiAvailable, startGeminiPolling, stopGeminiPolling } = usePageStore();
    const { whisperAvailable, checkWhisperStatus, isRecording, activeRecordingPageId, useWhisper, toggleWhisper } = useRecordingStore();

    // Check status on mount and start polling
    useEffect(() => {
        checkWhisperStatus();
        startGeminiPolling();

        return () => {
            stopGeminiPolling();
        };
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
    };

    return (
        <header className="header">
            <div className="header-content">
                <div className="header-left">
                    <h1 className="header-title" onClick={() => navigate('/')} style={{ cursor: 'pointer' }}>
                        🎤 Meeting Transcription
                    </h1>
                </div>

                <div className="header-center">
                    <nav className="nav">
                        <button
                            className={`btn btn-sm nav-item ${currentView === 'list' ? 'btn-primary' : 'btn-secondary'}`}
                            onClick={() => navigate('/')}
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
                            onClick={() => navigate('/hotwords')}
                        >
                            🔤 热词管理
                        </button>
                        <button
                            className={`btn btn-sm nav-item ${currentView === 'todos' ? 'btn-primary' : 'btn-secondary'}`}
                            onClick={() => navigate('/todos')}
                        >
                            ✅ 待办总览
                        </button>
                    </nav>
                </div>

                <div className="header-right">
                    <div className="header-status">
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
