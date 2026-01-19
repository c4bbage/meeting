/**
 * WebSocketService - Real-time Transcription Client
 * Handles connection to backend WebSocket and audio streaming
 */

export class WebSocketService {
    constructor() {
        this.socket = null;
        this.isConnected = false;
        this.onResult = null; // (payload) => {}
        this.onError = null;  // (error) => {}
        this.onOpen = null;   // () => {}
        this.onClose = null;  // () => {}
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 3;
        this.pendingChunks = [];
        this.maxPendingChunks = 10;
        this.suppressEvents = false;
        // Reconnect params
        this.currentReconnectAttempts = 0;
        this.reconnectTimer = null;
        this.lastUrl = null;
        this.lastLanguage = null;
    }

    /**
     * Get WebSocket URL
     */
    _getUrl(language = 'zh') {
        const isHttps = window.location.protocol === 'https:';
        const protocol = isHttps ? 'wss:' : 'ws:';

        // Dynamic port handling
        // ... (port logic)
        let host = window.location.hostname;
        let wsPort = window.location.port;

        if (wsPort === '3456') {
            wsPort = '6543'; // Direct to backend
        } else if (wsPort === '8000') {
            wsPort = isHttps ? '8000' : '6543';
        } else if (wsPort === '6543') {
            wsPort = '6543';
        } else if (!wsPort) {
            wsPort = isHttps ? '' : '6543';
        } else {
            wsPort = '6543';
        }

        const portStr = wsPort ? `:${wsPort}` : '';
        const wsPath = (isHttps || wsPort === '8000') ? '/api/ws/transcribe' : '/ws/transcribe';
        return `${protocol}//${host}${portStr}${wsPath}?language=${encodeURIComponent(language)}`;
    }

    /**
     * Connect to WebSocket
     */
    connect(language = 'zh') {
        // Clear any pending reconnect
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
            return;
        }

        this.suppressEvents = false;
        this.lastLanguage = language;
        const url = this._getUrl(language);
        this.lastUrl = url;

        console.log(`Connecting to Neural Link: ${url}`);

        this.socket = new WebSocket(url);
        this.socket.binaryType = 'arraybuffer';

        this.socket.onopen = () => {
            if (this.suppressEvents) return;
            console.log('✅ Neural Link Connected');
            this.isConnected = true;
            this.currentReconnectAttempts = 0; // Reset attempts on success

            // Check pending chunks
            if (this.pendingChunks.length > 0) {
                // Send pending in order
                this.pendingChunks.forEach((buffer) => {
                    if (this.socket.readyState === WebSocket.OPEN) {
                        this.socket.send(buffer);
                    }
                });
                this.pendingChunks = [];
            }
            if (this.onOpen) this.onOpen();
        };

        this.socket.onmessage = (event) => {
            if (this.suppressEvents) return;
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'result' && this.onResult) {
                    this.onResult(data);
                } else if (data.type === 'error' && this.onError) {
                    this.onError(data.message || 'Streaming error');
                }
            } catch (e) {
                console.error('Failed to parse WS message:', e);
            }
        };

        this.socket.onclose = (event) => {
            if (this.suppressEvents) return;
            console.log('Neural Link Disconnected', event.code, event.reason);
            this.isConnected = false;

            // Try to reconnect if not normal closure
            if (event.code !== 1000) {
                this._attemptReconnect();
            }

            if (this.onClose) this.onClose();
        };

        this.socket.onerror = (error) => {
            if (this.suppressEvents) return;
            console.error('WebSocket Error:', error);
            // On error, onclose will usually be called straight after
        };
    }

    _attemptReconnect() {
        if (this.currentReconnectAttempts >= this.maxReconnectAttempts) {
            console.warn('Max reconnect attempts reached for Neural Link');
            if (this.onError) this.onError('连接断开，且重连失败');
            return;
        }

        this.currentReconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, this.currentReconnectAttempts), 10000); // Backoff 2s, 4s... max 10s

        console.log(`Attempting reconnect in ${delay}ms (Attempt ${this.currentReconnectAttempts})`);

        this.reconnectTimer = setTimeout(() => {
            if (!this.suppressEvents) { // Ensure user hasn't manually stopped it
                this.connect(this.lastLanguage);
            }
        }, delay);
    }

    /**
     * Send audio chunk
     * @param {Blob|ArrayBuffer} chunk 
     */
    async sendAudio(chunk) {
        if (!chunk) return;

        const buffer = chunk instanceof ArrayBuffer
            ? chunk
            : (chunk.arrayBuffer ? await chunk.arrayBuffer() : null);

        if (!buffer) return;

        if (!this.socket || !this.isConnected || this.socket.readyState !== WebSocket.OPEN) {
            // Buffer while offline
            this.pendingChunks.push(buffer);
            if (this.pendingChunks.length > this.maxPendingChunks) {
                this.pendingChunks.shift(); // Drop oldest
            }

            // If completely disconnected and no reconnect pending, trigger reconnect
            if (!this.isConnected && !this.reconnectTimer && !this.suppressEvents) {
                this._attemptReconnect();
            }
            return;
        }
        this.socket.send(buffer);
    }

    /**
     * Disconnect
     */
    disconnect() {
        this.suppressEvents = true; // Prevent auto-reconnect
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        if (this.socket) {
            this.socket.close();
            this.socket = null;
        }

        this.isConnected = false;
        this.pendingChunks = [];
        this.currentReconnectAttempts = 0;
    }
}
