import { useEffect, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { usePageStore } from '../../store/pageStore';
import { useRecordingStore } from '../../store/recordingStore';
import { WebSocketService } from '../../services/WebSocketService';
import { PageService } from '../../services/Database';
import { formatDateTime } from '../../utils/helpers';
import Header from './Header';
import RecordingBanner from './RecordingBanner';

function Layout() {
    const navigate = useNavigate();
    const loadPages = usePageStore(state => state.loadPages);
    const checkGeminiStatus = usePageStore(state => state.checkGeminiStatus);
    const setWhisperAvailable = useRecordingStore(state => state.setWhisperAvailable);
    const [recoveryModal, setRecoveryModal] = useState(null);

    useEffect(() => {
        // Initialize on mount
        loadPages();
        checkGeminiStatus();

        // Check WebSocket server availability
        checkWhisperAvailability();

        // Check for unfinished recordings
        checkUnfinishedRecordings();
    }, []);

    const checkUnfinishedRecordings = async () => {
        try {
            const recordingPages = await PageService.findRecording();
            if (recordingPages.length > 0) {
                const page = recordingPages[0];
                setRecoveryModal({
                    id: page.id,
                    title: page.title || '未命名录音',
                    createdAt: page.createdAt
                });
            }
        } catch (error) {
            console.error('Failed to check unfinished recordings:', error);
        }
    };

    const handleRecoverRecording = () => {
        if (recoveryModal) {
            navigate(`/recording/${recoveryModal.id}`);
            setRecoveryModal(null);
        }
    };

    const handleDiscardRecording = async () => {
        if (recoveryModal) {
            // Mark page as completed (not recording)
            await PageService.update(recoveryModal.id, { status: 'completed' });
            setRecoveryModal(null);
        }
    };

    const checkWhisperAvailability = async () => {
        let resolved = false;
        let wsService = null;
        try {
            wsService = new WebSocketService();
            wsService.onOpen = () => {
                resolved = true;
                console.log('✅ Whisper ASR available');
                setWhisperAvailable(true);
                wsService.disconnect();
            };

            wsService.onError = () => {
                resolved = true;
                console.log('❌ Whisper ASR unavailable');
                setWhisperAvailable(false);
                wsService.disconnect();
            };

            wsService.onClose = () => {
                if (!resolved) {
                    setWhisperAvailable(false);
                }
            };

            wsService.connect('zh');
        } catch (error) {
            console.error('Failed to check Whisper availability:', error);
            setWhisperAvailable(false);
            if (wsService) {
                wsService.disconnect();
            }
        }
    };

    return (
        <div className="app">
            <Header />
            <RecordingBanner />
            <main className="main-content">
                <Outlet />
            </main>

            {/* Recording Recovery Modal */}
            {recoveryModal && (
                <div className="modal-overlay" onClick={() => setRecoveryModal(null)}>
                    <div className="modal-content" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>🎤 发现未完成的录音</h2>
                        </div>
                        <div className="modal-body">
                            <p>发现一个未完成的录音会话：</p>
                            <p className="text-primary" style={{ marginTop: '8px' }}>
                                <strong>{recoveryModal.title}</strong>
                            </p>
                            <p className="text-muted" style={{ marginTop: '4px' }}>
                                创建于：{formatDateTime(recoveryModal.createdAt)}
                            </p>
                            <p style={{ marginTop: '16px' }}>是否要恢复这个录音？</p>
                        </div>
                        <div className="modal-footer">
                            <button
                                className="btn btn-secondary"
                                onClick={handleDiscardRecording}
                            >
                                放弃录音
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={handleRecoverRecording}
                            >
                                恢复录音
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default Layout;
