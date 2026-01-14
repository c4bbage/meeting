/**
 * Utility Functions
 */

/**
 * Generate a UUID v4
 */
export function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

/**
 * Format date to readable string
 */
export function formatDate(date) {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Format date with time
 */
export function formatDateTime(date) {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}`;
}

/**
 * Format relative time (e.g., "3 分钟前")
 */
export function formatRelativeTime(date) {
    const now = new Date();
    const d = new Date(date);
    const diff = Math.floor((now - d) / 1000); // seconds

    if (diff < 60) {
        return '刚刚';
    } else if (diff < 3600) {
        const mins = Math.floor(diff / 60);
        return `${mins} 分钟前`;
    } else if (diff < 86400) {
        const hours = Math.floor(diff / 3600);
        return `${hours} 小时前`;
    } else if (diff < 604800) {
        const days = Math.floor(diff / 86400);
        return `${days} 天前`;
    } else {
        return formatDate(date);
    }
}

/**
 * Format duration in seconds to HH:MM:SS or MM:SS
 */
export function formatDuration(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;

    if (h > 0) {
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Format duration to human readable (e.g., "5 分 23 秒")
 */
export function formatDurationHuman(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;

    let parts = [];
    if (h > 0) parts.push(`${h} 小时`);
    if (m > 0) parts.push(`${m} 分`);
    if (s > 0 || parts.length === 0) parts.push(`${s} 秒`);

    return parts.join(' ');
}

/**
 * Debounce function
 */
export function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Truncate text with ellipsis
 */
export function truncate(text, maxLength = 100) {
    if (!text || text.length <= maxLength) {
        return text;
    }
    return text.substring(0, maxLength) + '...';
}

/**
 * Check if browser supports required features
 */
export function checkBrowserSupport() {
    const results = {
        speechRecognition: !!(window.SpeechRecognition || window.webkitSpeechRecognition),
        mediaRecorder: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder),
        indexedDB: !!window.indexedDB,
        isChrome: /Chrome/.test(navigator.userAgent) && !/Edge/.test(navigator.userAgent),
        isEdge: /Edg/.test(navigator.userAgent),
        isFirefox: /Firefox/.test(navigator.userAgent),
        isSafari: /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent)
    };

    results.isSupported = results.speechRecognition && results.mediaRecorder && results.indexedDB;
    results.browserName = results.isChrome ? 'Chrome' :
        results.isEdge ? 'Edge' :
            results.isFirefox ? 'Firefox' :
                results.isSafari ? 'Safari' : 'Unknown';

    return results;
}

/**
 * Escape HTML to prevent XSS
 */
export function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Download content as file
 */
export function downloadFile(content, filename, mimeType = 'text/plain') {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
