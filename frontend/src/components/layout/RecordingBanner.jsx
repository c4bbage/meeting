import { useNavigate } from 'react-router-dom';
import { useRecordingStore } from '../../store/recordingStore';
import { formatDuration } from '../../utils/helpers';
import { useEffect, useState } from 'react';

function RecordingBanner() {
    const navigate = useNavigate();
    const isRecording = useRecordingStore(state => state.isRecording);
    const recordingStartTime = useRecordingStore(state => state.recordingStartTime);
    const [duration, setDuration] = useState(0);

    useEffect(() => {
        if (isRecording && recordingStartTime) {
            const interval = setInterval(() => {
                setDuration(Math.floor((Date.now() - recordingStartTime) / 1000));
            }, 1000);

            return () => clearInterval(interval);
        }
    }, [isRecording, recordingStartTime]);

    if (!isRecording) return null;

    return (
        <div className="recording-banner">
            <div className="recording-banner-content">
                <div className="recording-banner-status">
                    <span className="recording-status-dot active"></span>
                    <span>录音进行中</span>
                    <span className="recording-banner-timer">{formatDuration(duration)}</span>
                </div>
                <button
                    className="btn btn-sm btn-secondary"
                    onClick={() => navigate('/recording')}
                >
                    返回录音
                </button>
            </div>
        </div>
    );
}

export default RecordingBanner;
