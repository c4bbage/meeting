/**
 * SyncService - Backend synchronization for pages and segments
 * 提供跨设备数据同步功能
 */

// 动态获取 API 地址
// 在开发环境 (port 3000)，使用 /api 前缀会被 Vite 代理到后端
// 在生产环境，使用同源地址
const API_PORT = window.location.port;
const API_BASE = (API_PORT === '3000' || API_PORT === '3456')
    ? '/api'  // Vite proxy will forward to backend
    : `${window.location.origin}/api`;

/**
 * Check if backend is available
 */
async function isBackendAvailable() {
    try {
        // Health endpoint is at /health (not /api/health)
        const healthUrl = API_BASE.endsWith('/api')
            ? API_BASE.replace(/\/api$/, '/health')
            : `${API_BASE}/health`;
        const response = await fetch(healthUrl, {
            signal: AbortSignal.timeout(2000)
        });
        return response.ok;
    } catch {
        return false;
    }
}

/**
 * Page sync operations
 */
export const PageSync = {
    /**
     * Fetch all pages from backend
     */
    async fetchAll() {
        try {
            const response = await fetch(`${API_BASE}/pages`);
            if (!response.ok) throw new Error('Failed to fetch pages');
            const data = await response.json();
            return data.pages || [];
        } catch (error) {
            console.warn('Failed to fetch pages from backend:', error.message);
            return null;
        }
    },

    /**
     * Create a page on backend
     */
    async create(page) {
        try {
            const response = await fetch(`${API_BASE}/pages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: page.id,
                    title: page.title,
                    createdAt: page.createdAt instanceof Date ? page.createdAt.toISOString() : page.createdAt,
                    duration: page.duration || 0,
                    status: page.status || 'recording',
                    language: page.language || 'zh-CN',
                    notes: page.notes || null,
                    autoTitle: page.autoTitle || null,
                    summary: page.summary || null,
                    keyPoints: page.keyPoints || null,
                    decisions: page.decisions || null,
                    todos: page.todos || null,
                    todoCount: page.todoCount || 0,
                    wordCount: page.wordCount || 0,
                    analyzed: page.analyzed || false
                })
            });
            if (!response.ok) throw new Error('Failed to create page');
            const data = await response.json();
            return data.page;
        } catch (error) {
            console.warn('Failed to sync page to backend:', error.message);
            return null;
        }
    },

    /**
     * Update a page on backend
     */
    async update(pageId, updates) {
        try {
            // Only send fields that PageUpdate model accepts, strip Date objects and unknown fields
            const allowedFields = [
                'title', 'duration', 'status', 'language', 'autoTitle',
                'summary', 'keyPoints', 'decisions', 'todos', 'todoCount',
                'wordCount', 'analyzed', 'notes'
            ];
            const cleanData = {};
            for (const key of allowedFields) {
                if (key in updates && updates[key] !== undefined) {
                    cleanData[key] = updates[key];
                }
            }
            const response = await fetch(`${API_BASE}/pages/${pageId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(cleanData)
            });
            if (!response.ok) throw new Error('Failed to update page');
            const data = await response.json();
            return data.page;
        } catch (error) {
            console.warn('Failed to update page on backend:', error.message);
            return null;
        }
    },

    /**
     * Soft delete a page on backend
     */
    async delete(pageId) {
        try {
            const response = await fetch(`${API_BASE}/pages/${pageId}`, {
                method: 'DELETE'
            });
            return response.ok;
        } catch (error) {
            console.warn('Failed to delete page on backend:', error.message);
            return false;
        }
    }
};

/**
 * Segment sync operations
 */
export const SegmentSync = {
    /**
     * Fetch all segments for a page from backend
     */
    async fetchByPageId(pageId) {
        try {
            const response = await fetch(`${API_BASE}/pages/${pageId}/segments`);
            if (!response.ok) throw new Error('Failed to fetch segments');
            const data = await response.json();
            return data.segments || [];
        } catch (error) {
            console.warn('Failed to fetch segments from backend:', error.message);
            return null;
        }
    },

    /**
     * Bulk save segments to backend with version support
     * @param {string} pageId - The page ID
     * @param {Array} segments - Segments to save
     * @param {string} version - Transcript version ('realtime', 'final', 'fused')
     */
    async saveAll(pageId, segments, version = 'realtime') {
        try {
            const url = `${API_BASE}/pages/${pageId}/segments?version=${version}`;
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    segments: segments.map(seg => ({
                        id: seg.id,
                        text: seg.text,
                        timestamp: seg.timestamp,
                        endTime: seg.endTime || null,
                        confidence: seg.confidence || 0,
                        isFinal: seg.isFinal !== false,
                        speaker: seg.speaker || null,
                        speakerLabel: seg.speakerLabel || null,
                        speakerColor: seg.speakerColor || null,
                        words: seg.words || null,
                        source: seg.source || 'web_speech'
                    }))
                })
            });
            if (!response.ok) throw new Error('Failed to save segments');
            const data = await response.json();
            return data.count;
        } catch (error) {
            console.warn('Failed to sync segments to backend:', error.message);
            return null;
        }
    },

    /**
     * Search page IDs by transcript content (backend)
     */
    async searchPageIdsByText(query) {
        const trimmed = (query || '').trim();
        if (!trimmed) return [];
        try {
            const response = await fetch(
                `${API_BASE}/search/pages?query=${encodeURIComponent(trimmed)}`,
                { signal: AbortSignal.timeout(4000) }
            );
            if (!response.ok) throw new Error('Failed to search segments');
            const data = await response.json();
            return data.pageIds || [];
        } catch (error) {
            console.warn('Failed to search segments on backend:', error.message);
            return null;
        }
    }
};

export { isBackendAvailable };
