import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useRecordingStore } from '../../store/recordingStore';
import { usePageStore } from '../../store/pageStore';
import { PageService, SegmentService, AudioService } from '../../services/Database';
import { AudioRecorderService } from '../../services/AudioRecorder';
import { SpeechRecognitionService } from '../../services/SpeechRecognition';
import { SpeakerDiarizerService } from '../../services/SpeakerDiarizer';
import { WebSocketService } from '../../services/WebSocketService';
import { getWhisperAPI } from '../../services/WhisperAPI';
import { formatDuration, escapeHtml } from '../../utils/helpers';

function RecordingView() {
    const { id } = useParams();
    const navigate = useNavigate();

    // Stores
    const {
        isRecording,
        recordingStartTime,
        activeRecordingPageId,
        webSpeechSegments,
        streamingSegments,
        interimTranscript,
        streamingInterimTranscript,
        currentVolume,
        recognitionActive,
        streamingActive,
        useWhisper,
        whisperAvailable,
        compareMode,
        audioDevices,
        selectedDeviceId,
        setRecording,
        setRecordingStartTime,
        setActiveRecordingPageId,
        addWebSpeechSegment,
        addStreamingSegment,
        setInterimTranscript,
        setStreamingInterimTranscript,
        appendTranscript,
        setVolume,
        setAudioDevices,
        setSelectedDeviceId,
        setRecognitionActive,
        setStreamingActive,
        toggleCompareMode,
        resetRecording,
        clearRecording
    } = useRecordingStore();

    const { createPage, loadPages } = usePageStore();

    // Local state
    const [timer, setTimer] = useState('00:00');
    const [canvasContext, setCanvasContext] = useState(null);
    const syncIntervalRef = useRef(null);

    // Services
    const audioRecorderRef = useRef(null);
    const speechServiceRef = useRef(null);
    const speakerDiarizerRef = useRef(null);
    const streamingDiarizerRef = useRef(null);
    const webSocketServiceRef = useRef(null);
    const visualizerAnimationRef = useRef(null);
    const recordingStartTimeRef = useRef(null);
    const lastStreamingTranscriptRef = useRef('');
    const streamingRecentRef = useRef([]);
    const streamingCommitTimerRef = useRef(null);
    const streamingLastCommittedTextRef = useRef('');
    const streamingLastConfidenceRef = useRef(0);
    const streamingLastSourceRef = useRef('');

    // Initialize services
    // Initialize services
    useEffect(() => {
        audioRecorderRef.current = new AudioRecorderService();
        speechServiceRef.current = new SpeechRecognitionService();
        speakerDiarizerRef.current = new SpeakerDiarizerService({ silenceThreshold: 5000 });
        streamingDiarizerRef.current = new SpeakerDiarizerService({ silenceThreshold: 5000 });

        // Load audio devices
        loadAudioDevices();

        // Check if we need to recover state (user navigated away and came back)
        if (isRecording && activeRecordingPageId) {
            console.log('🔄 Recovering recording view state...');
            // Re-attach visualizer
            startAudioVisualization();

            // Re-bind speech recognition callbacks if they are running in background
            setupSpeechRecognition(activeRecordingPageId);

            if (useWhisper && whisperAvailable && webSocketServiceRef.current) {
                // Re-bind websocket callbacks
                setupStreamingRecognition(activeRecordingPageId);
            }
        }

        return () => {
            // Only stop everything if we are NOT recording
            // If we are recording, we want services to stay alive in background
            if (!useRecordingStore.getState().isRecording) {
                if (audioRecorderRef.current) audioRecorderRef.current.stop();
                if (speechServiceRef.current) speechServiceRef.current.stop();
                if (webSocketServiceRef.current) webSocketServiceRef.current.disconnect();

                if (visualizerAnimationRef.current) {
                    cancelAnimationFrame(visualizerAnimationRef.current);
                }
            }
            clearStreamingCommitTimer();
        };
    }, []);

    // Timer
    useEffect(() => {
        if (isRecording && recordingStartTime) {
            const interval = setInterval(() => {
                const durationSeconds = Math.floor((Date.now() - recordingStartTime) / 1000);
                setTimer(formatDuration(durationSeconds));
            }, 1000);

            return () => clearInterval(interval);
        } else {
            setTimer('00:00');
        }
    }, [isRecording, recordingStartTime]);

    const loadAudioDevices = async () => {
        try {
            const devices = await AudioRecorderService.getAudioInputDevices();
            setAudioDevices(devices);

            if (!selectedDeviceId && devices.length > 0) {
                const defaultDevice = devices.find(d => d.deviceId === 'default');
                setSelectedDeviceId(defaultDevice ? defaultDevice.deviceId : devices[0].deviceId);
            }
        } catch (error) {
            console.error('Failed to load audio devices:', error);
        }
    };

    // Auto-start recording when opening recording page
    useEffect(() => {
        if (!id && !isRecording && selectedDeviceId) {
            // Small delay to ensure UI is ready
            const timer = setTimeout(() => {
                handleToggleRecording();
            }, 500);
            return () => clearTimeout(timer);
        }
    }, [selectedDeviceId, id]);

    const handleToggleRecording = async () => {
        if (isRecording) {
            await stopRecording();
        } else {
            await startRecording();
        }
    };

    const startRecording = async () => {
        // Create page if needed
        let pageId = activeRecordingPageId;
        if (!pageId) {
            const page = await createPage();
            pageId = page.id;
            setActiveRecordingPageId(pageId);
        }

        resetRecording();
        recordingStartTimeRef.current = null;
        lastStreamingTranscriptRef.current = '';
        streamingRecentRef.current = [];
        streamingLastCommittedTextRef.current = '';
        streamingLastConfidenceRef.current = 0;
        streamingLastSourceRef.current = '';
        clearStreamingCommitTimer();
        if (speakerDiarizerRef.current) {
            speakerDiarizerRef.current.reset();
        }
        if (streamingDiarizerRef.current) {
            streamingDiarizerRef.current.reset();
        }

        // Initialize audio recorder
        const audioReady = await audioRecorderRef.current.init(selectedDeviceId);
        if (!audioReady) {
            alert('无法访问麦克风，请检查权限设置');
            return;
        }

        // Setup speech recognition
        setupSpeechRecognition(pageId);

        if (useWhisper && whisperAvailable) {
            setupStreamingRecognition(pageId);
        }

        // Setup audio chunk streaming to backend
        setupAudioChunkStreaming(pageId);

        // Start recording
        const success = await audioRecorderRef.current.start(500);
        if (!success) {
            alert('无法启动录音，请检查麦克风权限');
            return;
        }

        setRecording(true);
        const startedAt = Date.now();
        setRecordingStartTime(startedAt);
        recordingStartTimeRef.current = startedAt;

        // Start visualization
        startAudioVisualization();

        // Start speech recognition
        const shouldStartWebSpeech = !useWhisper || !whisperAvailable || compareMode;
        if (shouldStartWebSpeech) {
            speechServiceRef.current.start();
        }

        // Start periodic segment sync (every 10 seconds)
        startPeriodicSync(pageId);

        console.log('🎤 Recording started');
    };

    const setupSpeechRecognition = (pageId) => {
        speechServiceRef.current.onResult = (transcript, isFinal, confidence) => {
            setRecognitionActive(true);

            if (isFinal) {
                const baseTime = recordingStartTimeRef.current || Date.now();
                const timestamp = Date.now() - baseTime;

                const segmentWithSpeaker = speakerDiarizerRef.current.processSegment({
                    text: transcript,
                    timestamp,
                    confidence
                });

                addWebSpeechSegment(segmentWithSpeaker);
                appendTranscript(transcript);
                setInterimTranscript('');

                // Save to database
                SegmentService.add(pageId, {
                    text: transcript,
                    timestamp,
                    confidence,
                    isFinal: true,
                    speaker: segmentWithSpeaker.speaker,
                    speakerLabel: segmentWithSpeaker.speakerLabel,
                    speakerColor: segmentWithSpeaker.speakerColor
                });
            } else {
                setInterimTranscript(transcript);
            }
        };

        speechServiceRef.current.onError = (error) => {
            console.error('Speech recognition error:', error);
            setRecognitionActive(false);
        };
    };

    const setupStreamingRecognition = (pageId) => {
        if (!webSocketServiceRef.current) {
            webSocketServiceRef.current = new WebSocketService();
        } else {
            webSocketServiceRef.current.disconnect();
        }

        lastStreamingTranscriptRef.current = '';
        streamingRecentRef.current = [];
        streamingLastCommittedTextRef.current = '';
        streamingLastConfidenceRef.current = 0;
        streamingLastSourceRef.current = '';
        setStreamingInterimTranscript('');
        clearStreamingCommitTimer();

        webSocketServiceRef.current.onOpen = () => {
            setStreamingActive(true);
        };

        webSocketServiceRef.current.onClose = () => {
            setStreamingActive(false);
            const { isRecording: recordingNow, compareMode: compareNow } = useRecordingStore.getState();
            if (recordingNow && !compareNow && speechServiceRef.current && !speechServiceRef.current.isRunning) {
                speechServiceRef.current.start();
            }
        };

        webSocketServiceRef.current.onError = (error) => {
            console.error('Streaming recognition error:', error);
            setStreamingActive(false);
            const { isRecording: recordingNow, compareMode: compareNow } = useRecordingStore.getState();
            if (recordingNow && !compareNow && speechServiceRef.current && !speechServiceRef.current.isRunning) {
                speechServiceRef.current.start();
            }
        };

        webSocketServiceRef.current.onResult = (payload) => {
            handleStreamingResult(pageId, payload);
        };

        webSocketServiceRef.current.connect('zh');
    };

    function normalizeStreamingText(text) {
        if (!text) return '';
        let cleaned = text.replace(/\s+/g, ' ').trim();
        cleaned = cleaned.replace(/^([。.\u2026,，!?！？;；:：、\-\—]+\s*)+/g, '');
        cleaned = cleaned.replace(/([。.!?！？，,])(?:\s*\1)+/g, '$1');
        cleaned = cleaned.replace(/([。.!?！？]){2,}/g, '$1');
        cleaned = cleaned.replace(/\s+([。.!?！？])/g, '$1');
        return cleaned.trim();
    }

    function shouldIgnoreStreamingText(text, confidence) {
        const compact = text.replace(/\s+/g, '');
        const punctuationOnly = /^[\.\,\!\?\:\;\-\—…，。！？；：、]+$/.test(compact);
        if (punctuationOnly && (compact.length <= 2 || confidence < 0.45)) {
            return true;
        }
        return false;
    }

    function isStreamingDuplicate(text) {
        const normalized = text.trim().toLowerCase();
        const now = Date.now();
        streamingRecentRef.current = streamingRecentRef.current.filter(
            (entry) => now - entry.time < 2500
        );
        if (streamingRecentRef.current.some((entry) => entry.text === normalized)) {
            return true;
        }
        streamingRecentRef.current.push({ text: normalized, time: now });
        if (streamingRecentRef.current.length > 100) {
            streamingRecentRef.current.shift();
        }
        return false;
    }

    function clearStreamingCommitTimer() {
        if (streamingCommitTimerRef.current) {
            clearTimeout(streamingCommitTimerRef.current);
            streamingCommitTimerRef.current = null;
        }
    }

    function getOverlapLength(prevText, nextText) {
        const maxLen = Math.min(prevText.length, nextText.length);
        for (let len = maxLen; len > 0; len--) {
            if (prevText.slice(-len) === nextText.slice(0, len)) {
                return len;
            }
        }
        return 0;
    }

    function getStreamingDeltaText(text) {
        const lastCommitted = streamingLastCommittedTextRef.current;
        if (!lastCommitted) {
            return text;
        }
        if (text.startsWith(lastCommitted)) {
            return text.slice(lastCommitted.length).trim();
        }
        const overlap = getOverlapLength(lastCommitted, text);
        if (overlap > 0) {
            return text.slice(overlap).trim();
        }
        return text;
    }

    function scheduleStreamingCommit(pageId, text, confidence, source) {
        clearStreamingCommitTimer();
        streamingCommitTimerRef.current = setTimeout(() => {
            commitStreamingText(pageId, text, confidence, source);
        }, 1200);
    }

    function commitStreamingText(pageId, text, confidence, source) {
        const trimmed = text.trim();
        if (!trimmed || !pageId) return;

        let commitText = trimmed;
        const lastCommitted = streamingLastCommittedTextRef.current;
        if (lastCommitted) {
            if (trimmed.startsWith(lastCommitted)) {
                commitText = trimmed.slice(lastCommitted.length).trim();
            } else {
                const overlap = getOverlapLength(lastCommitted, trimmed);
                if (overlap > 0) {
                    commitText = trimmed.slice(overlap).trim();
                }
            }
        }
        streamingLastCommittedTextRef.current = trimmed;
        if (!commitText) {
            return;
        }

        const baseTime = recordingStartTimeRef.current || Date.now();
        const timestamp = Date.now() - baseTime;
        const diarizer = streamingDiarizerRef.current || speakerDiarizerRef.current;
        const segmentWithSpeaker = diarizer.processSegment({
            text: commitText,
            timestamp,
            confidence
        });

        addStreamingSegment(segmentWithSpeaker);
        appendTranscript(commitText);
        setStreamingInterimTranscript('');

        SegmentService.add(pageId, {
            text: commitText,
            timestamp,
            confidence,
            isFinal: true,
            speaker: segmentWithSpeaker.speaker,
            speakerLabel: segmentWithSpeaker.speakerLabel,
            speakerColor: segmentWithSpeaker.speakerColor,
            source: source || 'streaming'
        });
    }

    function flushStreamingCommit(pageId) {
        clearStreamingCommitTimer();
        if (lastStreamingTranscriptRef.current && pageId) {
            commitStreamingText(
                pageId,
                lastStreamingTranscriptRef.current,
                streamingLastConfidenceRef.current || 0,
                streamingLastSourceRef.current
            );
        }
    }

    function handleStreamingResult(pageId, payload) {
        if (!payload || payload.type !== 'result') return;
        const text = normalizeStreamingText(payload.text || '');
        if (!text) return;

        const confidence = typeof payload.confidence === 'number' ? payload.confidence : 0;
        if (shouldIgnoreStreamingText(text, confidence)) {
            return;
        }
        if (isStreamingDuplicate(text)) {
            return;
        }

        const previousText = lastStreamingTranscriptRef.current;
        if (previousText && previousText !== text) {
            const overlap = getOverlapLength(previousText, text);
            const minLen = Math.min(previousText.length, text.length);
            const overlapThreshold = Math.min(6, Math.max(2, Math.floor(minLen * 0.5)));
            const isRelated =
                text.startsWith(previousText) ||
                previousText.startsWith(text) ||
                overlap >= overlapThreshold;
            if (!isRelated) {
                commitStreamingText(
                    pageId,
                    previousText,
                    streamingLastConfidenceRef.current || confidence,
                    streamingLastSourceRef.current || payload.engine || 'streaming'
                );
            }
        }

        lastStreamingTranscriptRef.current = text;
        streamingLastConfidenceRef.current = confidence;
        streamingLastSourceRef.current = payload.engine || 'streaming';
        setStreamingActive(true);
        setStreamingInterimTranscript(getStreamingDeltaText(text));
        scheduleStreamingCommit(pageId, text, confidence, payload.engine || 'streaming');
    }

    const runFinalTranscription = async (pageId, audioBlob) => {
        if (!pageId || !audioBlob) return false;
        try {
            const whisperAPI = getWhisperAPI();
            const available = await whisperAPI.isAvailable();
            if (!available) return false;

            const result = await whisperAPI.transcribe(audioBlob, { language: 'zh' });
            const segments = result?.segments || [];
            if (!segments.length) return false;

            await SegmentService.deleteByPageId(pageId);
            await SegmentService.addFromWhisper(pageId, segments, result.engine || 'final');
            await SegmentService.syncToBackend(pageId);
            return true;
        } catch (error) {
            console.warn('Final transcription failed:', error);
            return false;
        }
    };

    const setupAudioChunkStreaming = (pageId) => {
        // Stream audio chunks to backend as they're captured
        audioRecorderRef.current.onDataAvailable = async (blob) => {
            if (useWhisper && whisperAvailable && webSocketServiceRef.current) {
                try {
                    await webSocketServiceRef.current.sendAudio(blob);
                } catch (error) {
                    console.warn('Failed to stream audio chunk:', error);
                }
            }

            try {
                // Upload chunk to backend immediately
                const formData = new FormData();
                formData.append('audio_chunk', blob);
                formData.append('timestamp', Date.now());

                await fetch(`/api/pages/${pageId}/audio_chunk`, {
                    method: 'POST',
                    body: formData
                });
                console.log(`📤 Audio chunk uploaded: ${(blob.size / 1024).toFixed(1)} KB`);
            } catch (error) {
                console.warn('Failed to upload audio chunk:', error);
                // Chunk still saved locally in audioRecorder
            }
        };
    };

    const startPeriodicSync = (pageId) => {
        // Clear any existing interval
        if (syncIntervalRef.current) {
            clearInterval(syncIntervalRef.current);
        }

        // Sync segments every 10 seconds
        syncIntervalRef.current = setInterval(async () => {
            try {
                const synced = await SegmentService.syncToBackend(pageId);
                if (synced > 0) {
                    console.log(`🔄 Auto-synced ${synced} segments to backend`);
                }
            } catch (error) {
                console.warn('Periodic sync failed:', error);
            }
        }, 10000); // Every 10 seconds
    };

    const stopPeriodicSync = () => {
        if (syncIntervalRef.current) {
            clearInterval(syncIntervalRef.current);
            syncIntervalRef.current = null;
        }
    };

    const stopRecording = async () => {
        if (!audioRecorderRef.current || !activeRecordingPageId) return;

        console.log('⏹️ Stopping recording...');

        // Stop periodic sync
        stopPeriodicSync();

        // Stop speech recognition
        if (speechServiceRef.current) {
            speechServiceRef.current.stop();
        }
        if (webSocketServiceRef.current) {
            webSocketServiceRef.current.disconnect();
            setStreamingActive(false);
        }
        flushStreamingCommit(activeRecordingPageId);
        clearStreamingCommitTimer();
        recordingStartTimeRef.current = null;
        lastStreamingTranscriptRef.current = '';
        streamingRecentRef.current = [];
        streamingLastCommittedTextRef.current = '';
        streamingLastConfidenceRef.current = 0;
        streamingLastSourceRef.current = '';

        // Stop audio recorder
        const audioBlob = await audioRecorderRef.current.stop();

        // Stop visualization
        if (visualizerAnimationRef.current) {
            cancelAnimationFrame(visualizerAnimationRef.current);
        }

        let finalTranscribed = false;
        if (audioBlob && activeRecordingPageId) {
            await AudioService.save(activeRecordingPageId, audioBlob.blob, audioBlob.mimeType);

            const duration = recordingStartTime
                ? Math.round((Date.now() - recordingStartTime) / 1000)
                : 0;
            await PageService.update(activeRecordingPageId, {
                duration,
                status: 'completed'
            });

            finalTranscribed = await runFinalTranscription(activeRecordingPageId, audioBlob.blob);
        }

        if (!finalTranscribed && activeRecordingPageId) {
            await SegmentService.syncToBackend(activeRecordingPageId);
        }

        setRecording(false);
        await loadPages();

        // Navigate to detail view
        navigate(`/detail/${activeRecordingPageId}`);
        clearRecording();
    };

    const startAudioVisualization = () => {
        const canvas = document.getElementById('audio-visualizer');
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        setCanvasContext(ctx);

        const draw = () => {
            if (!audioRecorderRef.current || !isRecording) return;

            const volume = audioRecorderRef.current.getVolume();
            setVolume(volume);

            canvas.width = canvas.offsetWidth;
            canvas.height = canvas.offsetHeight;

            ctx.clearRect(0, 0, canvas.width, canvas.height);

            const waveform = audioRecorderRef.current.getWaveformData();
            if (waveform.length > 0) {
                const midY = canvas.height / 2;
                const amplitude = canvas.height * 0.25;
                ctx.lineWidth = 1.5;
                ctx.strokeStyle = 'rgba(0, 243, 255, 0.35)';
                ctx.beginPath();
                const sliceWidth = canvas.width / waveform.length;
                let xPos = 0;
                for (let i = 0; i < waveform.length; i++) {
                    const v = waveform[i] / 128.0 - 1;
                    const y = midY + v * amplitude;
                    if (i === 0) {
                        ctx.moveTo(xPos, y);
                    } else {
                        ctx.lineTo(xPos, y);
                    }
                    xPos += sliceWidth;
                }
                ctx.lineTo(canvas.width, midY);
                ctx.stroke();
            }

            visualizerAnimationRef.current = requestAnimationFrame(draw);
        };

        draw();
    };

    const handleDeviceChange = (deviceId) => {
        setSelectedDeviceId(deviceId);
    };

    const renderTranscript = () => {
        const segments = useWhisper && whisperAvailable && streamingSegments.length > 0
            ? streamingSegments
            : webSpeechSegments;
        const interim = useWhisper && whisperAvailable
            ? streamingInterimTranscript
            : interimTranscript;

        if (segments.length === 0 && !interim) {
            return (
                <div className="transcript-placeholder">
                    <p>{isRecording ? '🎤 正在聆听...' : '🎤 点击下方按钮开始录音'}</p>
                    <p className="text-muted mt-sm">转录的文字将在这里实时显示</p>
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

        if (interim) {
            html += `<div class="interim-text">${escapeHtml(interim)}</div>`;
        }

        html += '</div>';
        return <div dangerouslySetInnerHTML={{ __html: html }} />;
    };

    const recordingStatusLabel = isRecording ? '录音中' : '准备录音';
    const recognitionStatusLabel = (useWhisper && whisperAvailable ? streamingActive : recognitionActive)
        ? '🟢 LISTENING...'
        : '🟡 STANDBY';

    // AI Assistant State
    const [showAssistant, setShowAssistant] = useState(false);
    const [assistantLoading, setAssistantLoading] = useState(false);
    const [assistantContent, setAssistantContent] = useState(null);

    const handleAIAssistant = async () => {
        if (assistantLoading) return;

        setShowAssistant(true);
        setAssistantLoading(true);

        try {
            // Collect text
            const segments = useWhisper && whisperAvailable && streamingSegments.length > 0
                ? streamingSegments
                : webSpeechSegments;

            const text = segments.map(s => s.text).join(' ');
            console.log(`🤖 AI Assistant Request: sending ${text.length} chars from ${segments.length} segments`);

            if (!text || text.length < 10) {
                setAssistantContent('⚠️ 内容太少，请再说几句...');
                setAssistantLoading(false);
                return;
            }

            const response = await fetch('/api/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ transcript: text })
            });

            if (!response.ok) throw new Error('API Error');

            const result = await response.json();
            if (result.success) {
                setAssistantContent(result.summary);
            } else {
                setAssistantContent('❌ 分析失败');
            }
        } catch (error) {
            setAssistantContent('❌ 请求失败: ' + error.message);
        } finally {
            setAssistantLoading(false);
        }
    };

    return (
        <div className="recording-view">
            {isRecording && <canvas id="audio-visualizer"></canvas>}

            <div className={`recording-content ${showAssistant ? 'with-assistant' : ''}`}>
                <div className="recording-header">
                    <div className="recording-timer" id="timer">{timer}</div>
                    <div className={`status-strip ${isRecording ? 'active' : ''}`}>
                        <span className="status-item">
                            <span className={`status-dot ${isRecording ? 'active' : ''}`}></span>
                            <span>{recordingStatusLabel}</span>
                        </span>
                        <span className="status-divider">•</span>
                        <span className="status-item">
                            ENGINE: {useWhisper ? '🧠 FUNASR_ENGINE' : '🌐 WEB_SPEECH_API'}
                        </span>
                        <span className="status-divider">•</span>
                        <span className="status-item">ASR: {recognitionStatusLabel}</span>
                        {useWhisper && whisperAvailable && (
                            <>
                                <span className="status-divider">•</span>
                                <span className="status-item">STREAM: {streamingActive ? '🟢 LIVE' : '🟡 CONNECTING'}</span>
                            </>
                        )}
                    </div>
                </div>

                {!isRecording && (
                    <div className="recording-setup-row">
                        {audioDevices.length > 0 && (
                            <div className="device-selector-inline">
                                <label htmlFor="audio-device-select" className="text-sm text-muted mr-sm">
                                    🎤 选择麦克风:
                                </label>
                                <select
                                    id="audio-device-select"
                                    className="select select-sm"
                                    value={selectedDeviceId || ''}
                                    onChange={(e) => handleDeviceChange(e.target.value)}
                                >
                                    {audioDevices.map(device => (
                                        <option key={device.deviceId} value={device.deviceId}>
                                            {device.label || `Microphone ${device.deviceId.slice(0, 5)}...`}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}
                        <button className="btn btn-primary btn-lg" onClick={handleToggleRecording}>
                            开始录音
                        </button>
                    </div>
                )}

                {useWhisper && whisperAvailable && (
                    <div className="compare-toggle mb-sm text-center">
                        <button
                            className={`btn btn-sm ${compareMode ? 'btn-primary' : 'btn-secondary'}`}
                            onClick={toggleCompareMode}
                        >
                            {compareMode ? '对比模式：开' : '对比模式：关'}
                        </button>
                    </div>
                )}

                <div className="transcript-container">
                    {renderTranscript()}
                </div>

                {isRecording && (
                    <div className="recording-controls display-flex gap-md justify-center mt-md">
                        <button
                            className="btn btn-secondary btn-lg"
                            onClick={handleAIAssistant}
                            title="生成实时总结"
                        >
                            ✨ AI 助手
                        </button>
                        <button className="btn btn-primary btn-lg" onClick={handleToggleRecording}>
                            结束并保存
                        </button>
                    </div>
                )}
            </div>

            {/* AI Assistant Side Panel */}
            {showAssistant && (
                <div className="assistant-panel">
                    <div className="assistant-header">
                        <h3>🤖 会议助手</h3>
                        <button className="btn-close" onClick={() => setShowAssistant(false)}>×</button>
                    </div>
                    <div className="assistant-body">
                        {assistantLoading ? (
                            <div className="loading-spinner">Thinking...</div>
                        ) : (
                            <div className="markdown-body" dangerouslySetInnerHTML={{
                                __html: (assistantContent || '').replace(/\n/g, '<br>')
                            }} />
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

export default RecordingView;
