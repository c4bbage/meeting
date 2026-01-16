/**
 * WhisperAPI - Client for faster-whisper Python backend
 * 调用后端 API 进行高精度转录
 */

// 动态获取 API 地址
// 1. 本地静态服务器(如 8000)转发到后端 6543
// 2. 通过 HTTPS (Caddy/域名)使用同源
// 3. 其他开发端口也默认指向 6543
const API_PORT = window.location.port;
const IS_HTTPS = window.location.protocol === 'https:';
let apiPort = API_PORT;

if (API_PORT === '3000' || API_PORT === '3456') {
    apiPort = '6543';
} else if (API_PORT === '8000') {
    apiPort = IS_HTTPS ? '8000' : '6543';
} else if (API_PORT === '6543') {
    apiPort = '6543';
} else if (!API_PORT) {
    apiPort = IS_HTTPS ? '' : '6543';
} else {
    apiPort = '6543';
}

const API_BASE = apiPort
    ? `${window.location.protocol}//${window.location.hostname}:${apiPort}`
    : `${window.location.protocol}//${window.location.hostname}`;

export class WhisperAPI {
    constructor(baseUrl = API_BASE) {
        this.baseUrl = baseUrl;
        this.available = null; // null = unknown, true/false after check
    }

    /**
     * Check if the backend is available
     */
    async checkHealth() {
        try {
            const response = await fetch(`${this.baseUrl}/health`, {
                method: 'GET',
                signal: AbortSignal.timeout(3000) // 3s timeout
            });
            this.available = response.ok;
            return this.available;
        } catch (error) {
            console.warn('Whisper backend not available:', error.message);
            this.available = false;
            return false;
        }
    }

    /**
     * Check availability (cached)
     */
    async isAvailable() {
        if (this.available === null) {
            await this.checkHealth();
        }
        return this.available;
    }

    /**
     * Transcribe an audio blob
     * @param {Blob} audioBlob - Audio data
     * @param {Object} options - Transcription options
     * @param {string} options.language - Language code (zh, en, ja)
     * @param {string} options.hotwords - Additional hotwords (space-separated)
     * @param {boolean} options.useSavedHotwords - Whether to use saved hotwords
     * @returns {Promise<Object>} Transcription result with segments
     */
    async transcribe(audioBlob, options = {}) {
        const {
            language = 'zh',
            hotwords = '',
            useSavedHotwords = true
        } = options;

        const formData = new FormData();
        formData.append('file', audioBlob, 'recording.webm');
        formData.append('language', language);
        formData.append('use_saved_hotwords', useSavedHotwords.toString());

        if (hotwords) {
            formData.append('hotwords', hotwords);
        }

        try {
            const response = await fetch(`${this.baseUrl}/api/transcribe`, {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || 'Transcription failed');
            }

            return await response.json();
        } catch (error) {
            console.error('Transcription error:', error);
            throw error;
        }
    }

    // === Hotwords API ===

    /**
     * Get all saved hotwords
     */
    async getHotwords() {
        try {
            const response = await fetch(`${this.baseUrl}/api/hotwords`);
            if (!response.ok) {
                throw new Error('Failed to get hotwords');
            }
            return await response.json();
        } catch (error) {
            console.error('Get hotwords error:', error);
            return { hotwords: [], categories: {} };
        }
    }

    /**
     * Add a new hotword
     * @param {string} word - The hotword text
     * @param {string} category - Category (person, company, technology, etc.)
     */
    async addHotword(word, category = 'other') {
        try {
            const response = await fetch(`${this.baseUrl}/api/hotwords`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ word, category })
            });

            if (!response.ok) {
                throw new Error('Failed to add hotword');
            }

            return await response.json();
        } catch (error) {
            console.error('Add hotword error:', error);
            throw error;
        }
    }

    /**
     * Delete a hotword
     * @param {string} hotwordId - The hotword ID
     */
    async deleteHotword(hotwordId) {
        try {
            const response = await fetch(`${this.baseUrl}/api/hotwords/${hotwordId}`, {
                method: 'DELETE'
            });

            if (!response.ok) {
                throw new Error('Failed to delete hotword');
            }

            return await response.json();
        } catch (error) {
            console.error('Delete hotword error:', error);
            throw error;
        }
    }
}

// Singleton instance
let whisperAPIInstance = null;

/**
 * Get the singleton WhisperAPI instance
 */
export function getWhisperAPI() {
    if (!whisperAPIInstance) {
        whisperAPIInstance = new WhisperAPI();
    }
    return whisperAPIInstance;
}

export default WhisperAPI;
