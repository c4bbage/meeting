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
    }

    /**
     * Get WebSocket URL
     */
    _getUrl(language = 'zh') {
        const isHttps = window.location.protocol === 'https:';
        const protocol = isHttps ? 'wss:' : 'ws:';

        // Dynamic port handling
        // If on 3456 (dev), backend is likely on 6543
        // If on 8443 with https, assume Caddy proxy; with http, assume static server -> 6543
        // Otherwise default to 6543 for local dev servers (e.g., 5500/3000)
        let host = window.location.hostname;
        let wsPort = window.location.port;

        if (wsPort === '3456') {
            wsPort = '6543'; // Direct to backend
        } else if (wsPort === '8443') {
            wsPort = isHttps ? '8443' : '6543';
        } else if (wsPort === '6543') {
            wsPort = '6543';
        } else if (!wsPort) {
            wsPort = isHttps ? '' : '6543';
        } else {
            wsPort = '6543';
        }

        // If no port (standard 80/443), don't append
        const portStr = wsPort ? `:${wsPort}` : '';
        const wsPath = (isHttps || wsPort === '8443') ? '/api/ws/transcribe' : '/ws/transcribe';

        return `${protocol}//${host}${portStr}${wsPath}?language=${encodeURIComponent(language)}`;
    }

    /**
     * Connect to WebSocket
     */
    connect(language = 'zh') {
        if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
            return;
        }

        this.suppressEvents = false;
        const url = this._getUrl(language);
        console.log(`Connecting to Neural Link: ${url}`);

        this.socket = new WebSocket(url);
        this.socket.binaryType = 'arraybuffer';

        this.socket.onopen = () => {
            if (this.suppressEvents) return;
            console.log('✅ Neural Link Connected');
            this.isConnected = true;
            this.reconnectAttempts = 0;
            if (this.pendingChunks.length > 0) {
                this.pendingChunks.forEach((buffer) => {
                    this.socket.send(buffer);
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

        this.socket.onclose = () => {
            if (this.suppressEvents) return;
            console.log('Neural Link Disconnected');
            this.isConnected = false;
            if (this.onClose) this.onClose();
        };

        this.socket.onerror = (error) => {
            if (this.suppressEvents) return;
            console.error('WebSocket Error:', error);
            this.isConnected = false;
            if (this.onError) this.onError(error);
        };
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
            this.pendingChunks.push(buffer);
            if (this.pendingChunks.length > this.maxPendingChunks) {
                this.pendingChunks.shift();
            }
            return;
        }
        this.socket.send(buffer);
    }

    /**
     * Disconnect
     */
    disconnect() {
        if (this.socket) {
            this.suppressEvents = true;
            this.socket.close();
            this.socket = null;
            this.isConnected = false;
            this.pendingChunks = [];
        }
    }
}
