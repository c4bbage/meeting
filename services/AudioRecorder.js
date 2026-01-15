/**
 * Audio Recorder Service
 * MediaRecorder API 封装（用于录制音频回放）
 */

export class AudioRecorderService {
    constructor() {
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.stream = null;
        this.isRecording = false;
        this.isPaused = false;
        this.startTime = null;

        // Web Audio API for volume analysis
        this.audioContext = null;
        this.analyser = null;
        this.sourceNode = null;
        this.volumeInterval = null;

        // Callbacks
        this.onDataAvailable = null;  // (blob) => {}
        this.onStop = null;           // (fullBlob) => {}
        this.onError = null;          // (error) => {}
        this.onVolumeChange = null;   // (volume, isSilent) => {}
    }

    /**
     * Check if MediaRecorder is supported
     */
    static isSupported() {
        return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
    }

    /**
     * Request microphone permission and initialize
     */
    async init() {
        try {
            this.stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });

            // Check supported MIME types
            const mimeType = this._getSupportedMimeType();

            this.mediaRecorder = new MediaRecorder(this.stream, {
                mimeType: mimeType
            });

            this._setupEventHandlers();

            // Initialize Web Audio API for volume analysis
            this._initAudioAnalyser();

            return true;
        } catch (error) {
            console.error('Failed to initialize audio recorder:', error);

            if (error.name === 'NotAllowedError') {
                if (this.onError) {
                    this.onError('麦克风权限被拒绝，请在浏览器设置中允许麦克风访问');
                }
            } else if (error.name === 'NotFoundError') {
                if (this.onError) {
                    this.onError('未找到麦克风设备');
                }
            } else {
                if (this.onError) {
                    this.onError('初始化录音失败: ' + error.message);
                }
            }

            return false;
        }
    }

    /**
     * Get supported MIME type for recording
     */
    _getSupportedMimeType() {
        const types = [
            'audio/webm;codecs=opus',
            'audio/webm',
            'audio/ogg;codecs=opus',
            'audio/mp4',
            'audio/wav'
        ];

        for (const type of types) {
            if (MediaRecorder.isTypeSupported(type)) {
                return type;
            }
        }

        return 'audio/webm'; // fallback
    }

    /**
     * Initialize Web Audio API analyser for volume detection
     */
    _initAudioAnalyser() {
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.analyser = this.audioContext.createAnalyser();

            // Configure analyser
            this.analyser.fftSize = 256;
            this.analyser.smoothingTimeConstant = 0.8;

            // Connect stream to analyser
            this.sourceNode = this.audioContext.createMediaStreamSource(this.stream);
            this.sourceNode.connect(this.analyser);
            // Note: Don't connect to destination to avoid feedback
        } catch (error) {
            console.warn('Failed to initialize audio analyser:', error);
        }
    }

    /**
     * Get current volume level (0-100)
     */
    getVolume() {
        if (!this.analyser) return 0;

        const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
        this.analyser.getByteFrequencyData(dataArray);

        // Calculate average volume
        const sum = dataArray.reduce((a, b) => a + b, 0);
        const average = sum / dataArray.length;

        // Normalize to 0-100
        return Math.min(100, Math.round((average / 255) * 100 * 2));
    }

    /**
     * Get frequency data for waveform visualization
     * @returns {Uint8Array} Frequency data array
     */
    getFrequencyData() {
        if (!this.analyser) return new Uint8Array(0);

        const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
        this.analyser.getByteFrequencyData(dataArray);
        return dataArray;
    }

    /**
     * Get time domain data for waveform visualization
     * @returns {Uint8Array} Time domain data array
     */
    getWaveformData() {
        if (!this.analyser) return new Uint8Array(0);

        const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
        this.analyser.getByteTimeDomainData(dataArray);
        return dataArray;
    }

    /**
     * Start volume monitoring
     * @param {number} interval - Monitoring interval in ms (default 100ms)
     * @param {number} silenceThreshold - Volume below this is considered silent (default 5)
     */
    startVolumeMonitoring(interval = 100, silenceThreshold = 5) {
        this.stopVolumeMonitoring();

        this.volumeInterval = setInterval(() => {
            const volume = this.getVolume();
            const isSilent = volume < silenceThreshold;

            if (this.onVolumeChange) {
                this.onVolumeChange(volume, isSilent);
            }
        }, interval);
    }

    /**
     * Stop volume monitoring
     */
    stopVolumeMonitoring() {
        if (this.volumeInterval) {
            clearInterval(this.volumeInterval);
            this.volumeInterval = null;
        }
    }

    /**
     * Setup MediaRecorder event handlers
     */
    _setupEventHandlers() {
        this.mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                this.audioChunks.push(event.data);

                if (this.onDataAvailable) {
                    this.onDataAvailable(event.data);
                }
            }
        };

        this.mediaRecorder.onstop = () => {
            const fullBlob = new Blob(this.audioChunks, {
                type: this.mediaRecorder.mimeType
            });

            if (this.onStop) {
                this.onStop(fullBlob);
            }
        };

        this.mediaRecorder.onerror = (event) => {
            console.error('MediaRecorder error:', event.error);
            if (this.onError) {
                this.onError('录音错误: ' + event.error.message);
            }
        };
    }

    /**
     * Start recording
     */
    start(timeslice = 1000) {
        if (!this.mediaRecorder) {
            if (this.onError) {
                this.onError('录音器未初始化');
            }
            return false;
        }

        if (this.isRecording) {
            return true;
        }

        try {
            this.audioChunks = [];
            this.startTime = Date.now();
            this.isRecording = true;
            this.isPaused = false;

            // timeslice: emit data every N ms
            this.mediaRecorder.start(timeslice);

            return true;
        } catch (error) {
            console.error('Failed to start recording:', error);
            this.isRecording = false;
            if (this.onError) {
                this.onError('开始录音失败: ' + error.message);
            }
            return false;
        }
    }

    /**
     * Stop recording
     * @returns {Promise<{blob: Blob, mimeType: string}>} Recorded audio data
     */
    stop() {
        return new Promise((resolve) => {
            if (!this.mediaRecorder || !this.isRecording) {
                resolve(null);
                return;
            }

            try {
                // Store the original onStop callback
                const originalOnStop = this.onStop;

                // Set up one-time handler to resolve promise
                this.mediaRecorder.onstop = () => {
                    const mimeType = this.mediaRecorder?.mimeType || 'audio/webm';
                    const fullBlob = new Blob(this.audioChunks, { type: mimeType });

                    // Call original callback if exists
                    if (originalOnStop) {
                        originalOnStop(fullBlob);
                    }

                    console.log(`Audio recording stopped: ${(fullBlob.size / 1024).toFixed(1)} KB, ${mimeType}`);
                    resolve({ blob: fullBlob, mimeType });
                };

                this.isRecording = false;
                this.isPaused = false;
                this.mediaRecorder.stop();
            } catch (error) {
                console.warn('Error stopping recorder:', error);
                resolve(null);
            }
        });
    }

    /**
     * Pause recording
     */
    pause() {
        if (!this.mediaRecorder || !this.isRecording || this.isPaused) {
            return;
        }

        try {
            this.isPaused = true;
            this.mediaRecorder.pause();
        } catch (error) {
            console.warn('Error pausing recorder:', error);
        }
    }

    /**
     * Resume recording
     */
    resume() {
        if (!this.mediaRecorder || !this.isPaused) {
            return;
        }

        try {
            this.isPaused = false;
            this.mediaRecorder.resume();
        } catch (error) {
            console.warn('Error resuming recorder:', error);
        }
    }

    /**
     * Get current recording duration in seconds
     */
    getDuration() {
        if (!this.startTime) {
            return 0;
        }
        return Math.floor((Date.now() - this.startTime) / 1000);
    }

    /**
     * Get the recorded audio as Blob
     */
    getBlob() {
        if (this.audioChunks.length === 0) {
            return null;
        }

        return new Blob(this.audioChunks, {
            type: this.mediaRecorder?.mimeType || 'audio/webm'
        });
    }

    /**
     * Get audio stream for visualization
     */
    getStream() {
        return this.stream;
    }

    /**
     * Cleanup resources
     */
    destroy() {
        this.stop();
        this.stopVolumeMonitoring();

        // Cleanup audio analyser
        if (this.sourceNode) {
            this.sourceNode.disconnect();
            this.sourceNode = null;
        }

        if (this.audioContext) {
            this.audioContext.close().catch(() => { });
            this.audioContext = null;
        }

        this.analyser = null;

        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }

        this.mediaRecorder = null;
        this.audioChunks = [];
        this.onDataAvailable = null;
        this.onStop = null;
        this.onError = null;
        this.onVolumeChange = null;
    }
}

export default AudioRecorderService;
