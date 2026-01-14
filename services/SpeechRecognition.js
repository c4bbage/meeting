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
        this.interimTimeout = null;

        // 防止重复提交的去重机制
        this.submittedTexts = new Set();

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
     * 检查文本是否重复或包含在已提交的文本中
     */
    _isDuplicate(text) {
        const normalized = text.trim().toLowerCase();
        if (this.submittedTexts.has(normalized)) {
            return true;
        }
        // 检查是否是已提交文本的子串
        for (const submitted of this.submittedTexts) {
            if (submitted.includes(normalized) || normalized.includes(submitted)) {
                return true;
            }
        }
        return false;
    }

    /**
     * 记录已提交的文本
     */
    _markAsSubmitted(text) {
        const normalized = text.trim().toLowerCase();
        this.submittedTexts.add(normalized);

        // 限制缓存大小，防止内存泄漏
        if (this.submittedTexts.size > 100) {
            const iterator = this.submittedTexts.values();
            this.submittedTexts.delete(iterator.next().value);
        }
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
                const transcript = result[0].transcript.trim();
                const isFinal = result.isFinal;
                const confidence = result[0].confidence || 0;

                if (!transcript) continue;

                if (isFinal) {
                    // 清除等待中的临时结果超时
                    if (this.interimTimeout) {
                        clearTimeout(this.interimTimeout);
                        this.interimTimeout = null;
                    }

                    // 避免重复提交
                    if (!this._isDuplicate(transcript)) {
                        this._markAsSubmitted(transcript);
                        this.lastFinalTranscript = transcript;
                        this.lastInterimTranscript = '';
                        this.pendingInterim = '';

                        if (this.onResult) {
                            this.onResult(transcript, true, confidence);
                        }
                    }
                } else {
                    // Interim result - 临时结果处理
                    this.lastInterimTranscript = transcript;
                    this.pendingInterim = transcript;
                    this.lastResultTime = now;

                    if (this.onResult) {
                        this.onResult(transcript, false, confidence);
                    }

                    // 设置超时：如果临时结果长时间没有变成最终结果，强制提交
                    // 这可以防止语速快时丢失内容
                    if (this.interimTimeout) {
                        clearTimeout(this.interimTimeout);
                    }

                    this.interimTimeout = setTimeout(() => {
                        if (this.pendingInterim && !this._isDuplicate(this.pendingInterim)) {
                            console.log('Forcing interim as final:', this.pendingInterim);
                            this._markAsSubmitted(this.pendingInterim);

                            if (this.onResult) {
                                this.onResult(this.pendingInterim, true, 0.7);
                            }
                            this.pendingInterim = '';
                        }
                    }, 2000); // 2秒后强制提交临时结果
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

            if (this.isRunning && !this.isPaused) {
                // Auto restart (handles Chrome's ~60s timeout)
                // 添加小延迟以确保稳定性
                setTimeout(() => {
                    if (this.isRunning && !this.isPaused) {
                        try {
                            this.recognition.start();
                        } catch (e) {
                            console.warn('Auto-restart failed:', e);
                            // 再次尝试
                            setTimeout(() => {
                                try {
                                    if (this.isRunning) {
                                        this.recognition.start();
                                    }
                                } catch (e2) {
                                    console.error('Second restart attempt failed:', e2);
                                }
                            }, 500);
                        }
                    }
                }, 100);
            } else {
                if (this.onEnd) {
                    this.onEnd();
                }
            }
        };

        // Handle errors
        this.recognition.onerror = (event) => {
            console.error('Speech Recognition Error:', event.error);

            // Handle specific errors
            switch (event.error) {
                case 'not-allowed':
                    if (this.onError) {
                        this.onError('麦克风权限被拒绝，请在浏览器设置中允许麦克风访问');
                    }
                    this.isRunning = false;
                    break;
                case 'no-speech':
                    // This is normal, just means no speech detected, don't stop
                    // 静音时自动重启以保持连接
                    break;
                case 'network':
                    if (this.onError) {
                        this.onError('网络错误，请检查网络连接');
                    }
                    // 尝试重连
                    setTimeout(() => {
                        if (this.isRunning) {
                            try {
                                this.recognition.start();
                            } catch (e) { }
                        }
                    }, 1000);
                    break;
                case 'aborted':
                    // User or system aborted, this is expected
                    break;
                case 'audio-capture':
                    if (this.onError) {
                        this.onError('无法捕获音频，请检查麦克风是否正常工作');
                    }
                    break;
                default:
                    if (this.onError) {
                        this.onError(`语音识别错误: ${event.error}`);
                    }
            }
        };

        // Handle start
        this.recognition.onstart = () => {
            // 重置去重缓存
            this.submittedTexts.clear();

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
            this.submittedTexts.clear();

            this.isRunning = true;
            this.isPaused = false;
            this.recognition.start();
            return true;
        } catch (e) {
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

        if (this.interimTimeout) {
            clearTimeout(this.interimTimeout);
            this.interimTimeout = null;
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

        if (this.interimTimeout) {
            clearTimeout(this.interimTimeout);
        }

        this.onResult = null;
        this.onError = null;
        this.onStart = null;
        this.onEnd = null;
        this.submittedTexts.clear();
    }
}

export default SpeechRecognitionService;
