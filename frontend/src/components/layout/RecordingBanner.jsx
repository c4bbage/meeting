import { useNavigate, useLocation } from 'react-router-dom';
import { useRecordingStore } from '../../store/recordingStore';
import { formatDuration } from '../../utils/helpers';
import { useEffect, useState } from 'react';

function RecordingBanner() {
    const navigate = useNavigate();
    const location = useLocation();
    const isRecording = useRecordingStore(state => state.isRecording);
    const recordingStartTime = useRecordingStore(state => state.recordingStartTime);
    const requestStop = useRecordingStore(state => state.requestStop);
    const [duration, setDuration] = useState(0);

    useEffect(() => {
        if (isRecording && recordingStartTime) {
            const interval = setInterval(() => {
                setDuration(Math.floor((Date.now() - recordingStartTime) / 1000));
            }, 1000);

            return () => clearInterval(interval);
        }
    }, [isRecording, recordingStartTime]);

    // Don't show banner if already on recording page
    const isOnRecordingPage = location.pathname.startsWith('/recording');
    if (!isRecording || isOnRecordingPage) return null;

    const handleStopRecording = () => {
        // Navigate to recording page and request stop
        requestStop();
        navigate('/recording');
    };

    return (
        <div className="recording-banner">
            <div className="recording-banner-content">
                <div className="recording-banner-status">
                    <span className="recording-status-dot active"></span>
                    <span>录音进行中</span>
                    <span className="recording-banner-timer">{formatDuration(duration)}</span>
                </div>
                <div className="recording-banner-actions">
                    <button
                        className="btn btn-sm btn-secondary"
                        onClick={() => navigate('/recording')}
                    >
                        返回录音
                    </button>
                    <button
                        className="btn btn-sm btn-danger"
                        onClick={handleStopRecording}
                    >
                        停止并保存
                    </button>
                </div>
            </div>
        </div>
    );
}

export default RecordingBanner;
