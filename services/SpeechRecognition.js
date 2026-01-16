/**
 * Speech Recognition Service - Enhanced Version
 * Web Speech API 封装 - 优化版本，减少内容丢失
 */

export class SpeechRecognitionService {
    constructor() {
        // Check browser support
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

        if (!SpeechRecognition) {
            this.isSupported = false;
            this.error = '您的浏览器不支持语音识别，请使用 Chrome 或 Edge 浏览器';
            return;
        }

        this.isSupported = true;
        this.recognition = new SpeechRecognition();
        this.isRunning = false;
        this.isPaused = false;
        this.isRestarting = false; // Prevent concurrent restart attempts

        // Enhanced Configuration for better recognition
        this.recognition.continuous = true;        // Keep listening
        this.recognition.interimResults = true;    // Get results while speaking
        this.recognition.lang = 'zh-CN';           // Chinese
        this.recognition.maxAlternatives = 3;      // 增加备选项以提高准确性

        // Buffer to prevent content loss
        this.lastInterimTranscript = '';
        this.lastFinalTranscript = '';
        this.pendingInterim = '';
        this.lastResultTime = 0;
        // 防止重复提交的去重机制（带时间窗口）
        this.recentSubmissions = [];
        this.duplicateWindowMs = 2500;
        this.errorCooldownMs = 10000;
        this.lastErrorTimes = {};

        // Callbacks
        this.onResult = null;       // (transcript, isFinal, confidence) => {}
        this.onError = null;        // (error) => {}
        this.onStart = null;        // () => {}
        this.onEnd = null;          // () => {}
        this.onSoundStart = null;   // () => {}
        this.onSoundEnd = null;     // () => {}

        this._setupEventHandlers();
    }

    /**
     * Check if Speech Recognition is supported
     */
    static isSupported() {
        return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    }

    /**
     * Set recognition language
     */
    setLanguage(lang) {
        if (this.recognition) {
            this.recognition.lang = lang;
        }
    }

    /**
     * 检查短时间内重复提交的文本
     */
    _isDuplicate(text) {
        const normalized = text.trim().toLowerCase();
        const now = Date.now();
        this.recentSubmissions = this.recentSubmissions.filter(
            (entry) => now - entry.time < this.duplicateWindowMs
        );
        return this.recentSubmissions.some((entry) => entry.text === normalized);
    }

    /**
     * 记录已提交的文本
     */
    _markAsSubmitted(text) {
        const normalized = text.trim().toLowerCase();
        this.recentSubmissions.push({ text: normalized, time: Date.now() });

        // 限制缓存大小，防止内存泄漏
        if (this.recentSubmissions.length > 100) {
            this.recentSubmissions.shift();
        }
    }

    /**
     * 选择最佳识别候选（按置信度）
     */
    _selectBestAlternative(result) {
        let best = result[0];
        for (let i = 1; i < result.length; i++) {
            const current = result[i];
            if ((current.confidence || 0) > (best.confidence || 0)) {
                best = current;
            }
        }
        return best;
    }

    /**
     * Throttle noisy errors (e.g., no-speech/network)
     */
    _shouldNotifyError(code) {
        const now = Date.now();
        const last = this.lastErrorTimes[code] || 0;
        if (now - last < this.errorCooldownMs) {
            return false;
        }
        this.lastErrorTimes[code] = now;
        return true;
    }

    /**
     * Safe restart - stops first then restarts after delay
     * Prevents "already started" errors
     */
    _safeRestart(delayMs = 100) {
        if (this.isRestarting || !this.isRunning || this.isPaused) {
            return;
        }
        this.isRestarting = true;

        // Stop first
        try {
            this.recognition.stop();
        } catch (e) {
            // Ignore stop errors
        }

        // Then restart after delay
        setTimeout(() => {
            if (this.isRunning && !this.isPaused) {
                try {
                    this.recognition.start();
                    this.isRestarting = false;
                } catch (e) {
                    console.warn('Safe restart failed:', e);
                    this.isRestarting = false;
                }
            } else {
                this.isRestarting = false;
            }
        }, delayMs);
    }

    /**
     * Setup event handlers
     */
    _setupEventHandlers() {
        // Handle results - Enhanced version
        this.recognition.onresult = (event) => {
            const now = Date.now();

            for (let i = event.resultIndex; i < event.results.length; i++) {
                const result = event.results[i];
                const best = this._selectBestAlternative(result);
                const transcript = best.transcript.trim();
                const isFinal = result.isFinal;
                const confidence = best.confidence || 0;

                if (!transcript) continue;

                if (isFinal) {
                    const isDuplicate = this._isDuplicate(transcript);

                    if (!isDuplicate) {
                        this._markAsSubmitted(transcript);
                        this.lastFinalTranscript = transcript;

                        if (this.onResult) {
                            this.onResult(transcript, true, confidence);
                        }
                    }

                    this.lastInterimTranscript = '';
                    this.pendingInterim = '';
                } else {
                    // Interim result - 临时结果处理
                    this.lastInterimTranscript = transcript;
                    this.pendingInterim = transcript;
                    this.lastResultTime = now;

                    if (this.onResult) {
                        this.onResult(transcript, false, confidence);
                    }

                }
            }
        };

        // Handle end - auto restart if still running
        this.recognition.onend = () => {
            // 在重启前，提交任何剩余的临时结果
            if (this.pendingInterim && !this._isDuplicate(this.pendingInterim)) {
                this._markAsSubmitted(this.pendingInterim);
                if (this.onResult) {
                    this.onResult(this.pendingInterim, true, 0.6);
                }
                this.pendingInterim = '';
            }

            this.isRestarting = false; // Reset restart flag

            if (this.isRunning && !this.isPaused) {
                // Auto restart (handles Chrome's ~60s timeout)
                this._safeRestart(100);
            } else {
                if (this.onEnd) {
                    this.onEnd();
                }
            }
        };

        // Handle errors
        this.recognition.onerror = (event) => {
            const code = event.error;
            if (code === 'no-speech') {
                return;
            }

            const notify = this._shouldNotifyError(code);
            if (notify) {
                console.warn('Speech Recognition Error:', code);
            }

            // Handle specific errors
            switch (code) {
                case 'not-allowed':
                    if (notify && this.onError) {
                        this.onError('麦克风权限被拒绝，请在浏览器设置中允许麦克风访问');
                    }
                    this.isRunning = false;
                    break;
                case 'no-speech':
                    // This is normal, just means no speech detected, don't stop
                    // 静音时自动重启以保持连接
                    break;
                case 'network':
                    if (notify && this.onError) {
                        this.onError('网络错误，请检查网络连接');
                    }
                    // 尝试重连 - 使用安全重启
                    this._safeRestart(1000);
                    break;
                case 'aborted':
                    // User or system aborted, this is expected
                    break;
                case 'audio-capture':
                    if (notify && this.onError) {
                        this.onError('无法捕获音频，请检查麦克风是否正常工作');
                    }
                    break;
                default:
                    if (notify && this.onError) {
                        this.onError(`语音识别错误: ${code}`);
                    }
            }
        };

        // Handle start
        this.recognition.onstart = () => {
            // 重置去重缓存
            this.recentSubmissions = [];

            if (this.onStart) {
                this.onStart();
            }
        };

        // Handle sound detection
        this.recognition.onsoundstart = () => {
            if (this.onSoundStart) {
                this.onSoundStart();
            }
        };

        this.recognition.onsoundend = () => {
            if (this.onSoundEnd) {
                this.onSoundEnd();
            }
        };
    }

    /**
     * Start recognition
     */
    start() {
        if (!this.isSupported) {
            if (this.onError) {
                this.onError(this.error);
            }
            return false;
        }

        if (this.isRunning) {
            return true;
        }

        try {
            // 重置状态
            this.lastInterimTranscript = '';
            this.lastFinalTranscript = '';
            this.pendingInterim = '';
            this.recentSubmissions = [];

            this.isRunning = true;
            this.isPaused = false;
            this.recognition.start();
            return true;
        } catch (e) {
            const isAlreadyStarted = e?.name === 'InvalidStateError' || /already started/i.test(e?.message || '');
            if (isAlreadyStarted) {
                this.isRunning = true;
                return true;
            }
            console.error('Failed to start speech recognition:', e);
            this.isRunning = false;
            if (this.onError) {
                this.onError('启动语音识别失败: ' + e.message);
            }
            return false;
        }
    }

    /**
     * Stop recognition
     */
    stop() {
        // 提交剩余的临时结果
        if (this.pendingInterim && !this._isDuplicate(this.pendingInterim)) {
            this._markAsSubmitted(this.pendingInterim);
            if (this.onResult) {
                this.onResult(this.pendingInterim, true, 0.6);
            }
        }

        this.isRunning = false;
        this.isPaused = false;
        this.pendingInterim = '';

        if (this.recognition) {
            try {
                this.recognition.stop();
            } catch (e) {
                console.warn('Error stopping recognition:', e);
            }
        }
    }

    /**
     * Pause recognition (stops but allows resume)
     */
    pause() {
        this.isPaused = true;

        // 提交剩余的临时结果
        if (this.pendingInterim && !this._isDuplicate(this.pendingInterim)) {
            this._markAsSubmitted(this.pendingInterim);
            if (this.onResult) {
                this.onResult(this.pendingInterim, true, 0.6);
            }
            this.pendingInterim = '';
        }

        if (this.recognition) {
            try {
                this.recognition.stop();
            } catch (e) {
                console.warn('Error pausing recognition:', e);
            }
        }
    }

    /**
     * Resume recognition after pause
     */
    resume() {
        if (!this.isRunning) {
            return this.start();
        }

        this.isPaused = false;

        try {
            this.recognition.start();
            return true;
        } catch (e) {
            console.warn('Error resuming recognition:', e);
            return false;
        }
    }

    /**
     * Cleanup
     */
    destroy() {
        this.stop();

        this.onResult = null;
        this.onError = null;
        this.onStart = null;
        this.onEnd = null;
        this.recentSubmissions = [];
    }
}

export default SpeechRecognitionService;
