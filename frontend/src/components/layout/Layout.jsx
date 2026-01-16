import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { usePageStore } from '../../store/pageStore';
import { useRecordingStore } from '../../store/recordingStore';
import { WebSocketService } from '../../services/WebSocketService';
import Header from './Header';
import RecordingBanner from './RecordingBanner';

function Layout() {
    const loadPages = usePageStore(state => state.loadPages);
    const checkGeminiStatus = usePageStore(state => state.checkGeminiStatus);
    const setWhisperAvailable = useRecordingStore(state => state.setWhisperAvailable);

    useEffect(() => {
        // Initialize on mount
        loadPages();
        checkGeminiStatus();

        // Check WebSocket server availability
        checkWhisperAvailability();
    }, []);

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
        </div>
    );
}

export default Layout;
