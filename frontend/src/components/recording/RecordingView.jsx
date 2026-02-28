import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useRecordingStore } from '../../store/recordingStore';
import { usePageStore } from '../../store/pageStore';
import { PageService, SegmentService, AudioService, TodoService } from '../../services/Database';
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
        clearRecording,
        stopRequested,
        clearStopRequest
    } = useRecordingStore();

    const { createPage, loadPages } = usePageStore();

    // Local state
    const [timer, setTimer] = useState('00:00');
    const [canvasContext, setCanvasContext] = useState(null);
    const [notes, setNotes] = useState(''); // 录音笔记
    const [showNotes, setShowNotes] = useState(false); // 是否显示笔记面板
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

    // Handle stop request from RecordingBanner
    useEffect(() => {
        if (stopRequested && isRecording) {
            clearStopRequest();
            stopRecording();
        }
    }, [stopRequested, isRecording]);

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

            console.log('🎙️ Submitting transcription task to backend...');

            // Submit transcription as async task
            const taskResult = await whisperAPI.transcribeAsync(audioBlob, { language: 'zh' });

            if (!taskResult || !taskResult.task_id) {
                console.warn('Failed to submit transcription task');
                return false;
            }

            const taskId = taskResult.task_id;
            console.log(`📋 Transcription task created: ${taskId}`);

            // Poll for task completion
            const pollInterval = 2000; // 2 seconds
            const maxAttempts = 60; // Max 2 minutes
            let attempts = 0;

            const pollTask = async () => {
                try {
                    const response = await fetch(`/api/tasks/${taskId}`);
                    if (!response.ok) {
                        throw new Error(`Task query failed: ${response.status}`);
                    }

                    const task = await response.json();
                    console.log(`📊 Task status: ${task.status} (${task.progress || 0}%)`);

                    if (task.status === 'completed') {
                        console.log('✅ Transcription completed successfully');

                        // Save final transcription with version='final'
                        const result = task.result;
                        const segments = result?.segments || [];

                        // Validate: only replace if we have meaningful results
                        const currentCount = await SegmentService.getFinalByPageId(pageId).then(s => s.length);
                        const shouldReplace = segments.length >= Math.max(1, currentCount * 0.5);

                        if (shouldReplace && segments.length > 0) {
                            console.log(`🔄 Saving final transcription (${segments.length} segments)`); await SegmentService.addFromWhisper(pageId, segments, result.engine || 'final');
                            await SegmentService.syncToBackend(pageId, { version: 'final' });

                            // Trigger AI fusion in background
                            try {
                                const fuseResult = await SegmentService.fusionTranscripts(pageId, true);
                                console.log(`🔄 AI Fusion task created: ${fuseResult.task_id}`);
                            } catch (error) {
                                console.warn('Failed to trigger AI fusion:', error);
                            }
                        } else {
                            console.warn('⚠️ Final transcription incomplete, keeping realtime segments');
                        }

                        return true;
                    } else if (task.status === 'failed') {
                        console.error('❌ Transcription failed:', task.error);
                        return false;
                    } else if (task.status === 'processing' || task.status === 'pending') {
                        attempts++;
                        if (attempts >= maxAttempts) {
                            console.warn('⏱️ Transcription timeout (exceeded max polling attempts)');
                            return false;
                        }

                        // Continue polling
                        await new Promise(resolve => setTimeout(resolve, pollInterval));
                        return pollTask();
                    }
                } catch (error) {
                    console.warn('Poll error:', error);
                    attempts++;
                    if (attempts >= maxAttempts) {
                        return false;
                    }
                    await new Promise(resolve => setTimeout(resolve, pollInterval));
                    return pollTask();
                }
            };

            return await pollTask();

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

        if (audioBlob && activeRecordingPageId) {
            await AudioService.save(activeRecordingPageId, audioBlob.blob, audioBlob.mimeType);

            // Auto-upload audio to backend for cross-device access
            try {
                const formData = new FormData();
                formData.append('file', audioBlob.blob, 'recording.webm');
                const uploadRes = await fetch(`/api/pages/${activeRecordingPageId}/upload`, {
                    method: 'POST',
                    body: formData
                });
                if (uploadRes.ok) {
                    console.log('✅ Audio auto-uploaded to backend');
                }
            } catch (err) {
                console.warn('⚠️ Audio auto-upload failed (can sync later):', err);
            }

            const duration = recordingStartTime
                ? Math.round((Date.now() - recordingStartTime) / 1000)
                : 0;

            // 保存笔记和状态
            const updateData = {
                duration,
                status: 'completed'
            };
            if (notes.trim()) {
                updateData.notes = notes.trim();
            }
            await PageService.update(activeRecordingPageId, updateData);

            // ✅ 异步执行最终转录，不阻塞UI（后台执行，完成后自动刷新）
            runFinalTranscription(activeRecordingPageId, audioBlob.blob)
                .then(success => {
                    if (success) {
                        console.log('✅ 最终高精度转录完成');
                        // 如果用户还在详情页，刷新页面以显示最终转录结果
                        const currentPath = window.location.pathname;
                        if (currentPath.includes(`/detail/${activeRecordingPageId}`)) {
                            console.log('📄 刷新页面以显示最终转录结果');
                            window.location.reload();
                        }
                    }
                })
                .catch(err => {
                    console.warn('⚠️ 最终转录失败，将使用实时转录结果:', err);
                });
        }

        // ✅ 分别同步三份转录到后端（Web Speech + Streaming + 最终转录）
        if (activeRecordingPageId) {
            // 1. 同步 Web Speech 实时转录
            SegmentService.syncBySourceToBackend(activeRecordingPageId, 'web_speech', 'web_speech')
                .then(count => {
                    if (count > 0) console.log(`✅ 已同步 ${count} 条 Web Speech 转录`);
                })
                .catch(err => console.warn('⚠️ Web Speech 同步失败:', err));

            // 2. 同步 FunASR Streaming 转录
            SegmentService.syncBySourceToBackend(activeRecordingPageId, 'streaming', 'streaming')
                .then(count => {
                    if (count > 0) console.log(`✅ 已同步 ${count} 条 Streaming 转录`);
                })
                .catch(err => console.warn('⚠️ Streaming 同步失败:', err));

            // 3. 同时保存一份合并的 realtime 版本（兼容旧逻辑）
            SegmentService.syncToBackend(activeRecordingPageId, { version: 'realtime' })
                .then(count => {
                    if (count > 0) console.log(`✅ 已同步 ${count} 条合并实时转录`);
                })
                .catch(err => console.warn('⚠️ 合并同步失败:', err));
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

    const LOW_CONFIDENCE_THRESHOLD = 0.6;

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

            // Add low confidence highlighting
            const isLowConfidence = typeof seg.confidence === 'number'
                && seg.confidence > 0
                && seg.confidence < LOW_CONFIDENCE_THRESHOLD;
            const confidenceClass = isLowConfidence ? ' low-confidence' : '';
            const confidenceTitle = isLowConfidence
                ? ` title="置信度 ${(seg.confidence * 100).toFixed(0)}%"`
                : '';

            html += `<span class="segment-text${confidenceClass}"${confidenceTitle}>${escapeHtml(seg.text)} </span>`;
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

                // Persist AI results to DB/Backend
                if (activeRecordingPageId) {
                    // Update Page metadata (Summary, Decisions, KeyPoints)
                    await PageService.update(activeRecordingPageId, {
                        summary: result.summary,
                        keyPoints: result.key_points,
                        decisions: result.decisions,
                        analyzed: true,
                        todos: result.todos, // Include full todos for backend persistence
                        todoCount: result.todos ? result.todos.length : 0
                    });

                    // Save Todos if any
                    if (result.todos && result.todos.length > 0) {
                        try {
                            const todos = result.todos.map(t => ({
                                ...t,
                                pageId: activeRecordingPageId
                            }));
                            await TodoService.addBatch(activeRecordingPageId, todos);
                            console.log(`Saved ${todos.length} todos locally`);
                        } catch (e) {
                            console.warn('Failed to save todos:', e);
                        }
                    }

                    console.log('✅ AI analysis saved to backend');
                }
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
                            className={`btn btn-lg ${showNotes ? 'btn-primary' : 'btn-secondary'}`}
                            onClick={() => setShowNotes(!showNotes)}
                            title="记录笔记"
                        >
                            📝 笔记 {notes.length > 0 && `(${notes.length}字)`}
                        </button>
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

                {/* Notes Panel */}
                {showNotes && isRecording && (
                    <div className="notes-panel">
                        <div className="notes-header">
                            <h4>📝 会议笔记</h4>
                            <span className="text-muted text-sm">边听边记，AI 总结时会参考这些内容</span>
                        </div>
                        <textarea
                            className="notes-textarea"
                            placeholder="在这里记录重要内容、想法、待办事项...&#10;&#10;例如:&#10;- 讨论了XX项目的进度&#10;- 需要跟进XX事项&#10;- 关键决定: ..."
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            autoFocus
                        />
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
