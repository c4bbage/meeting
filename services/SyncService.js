/**
 * SyncService - Backend synchronization for pages and segments
 * 提供跨设备数据同步功能
 */

const API_BASE = 'http://localhost:8000';

/**
 * Check if backend is available
 */
async function isBackendAvailable() {
    try {
        const response = await fetch(`${API_BASE}/health`, {
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
            const response = await fetch(`${API_BASE}/api/pages`);
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
            const response = await fetch(`${API_BASE}/api/pages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: page.id,
                    title: page.title,
                    createdAt: page.createdAt instanceof Date ? page.createdAt.toISOString() : page.createdAt,
                    duration: page.duration || 0,
                    status: page.status || 'recording',
                    language: page.language || 'zh-CN'
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
            const response = await fetch(`${API_BASE}/api/pages/${pageId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates)
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
            const response = await fetch(`${API_BASE}/api/pages/${pageId}`, {
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
            const response = await fetch(`${API_BASE}/api/pages/${pageId}/segments`);
            if (!response.ok) throw new Error('Failed to fetch segments');
            const data = await response.json();
            return data.segments || [];
        } catch (error) {
            console.warn('Failed to fetch segments from backend:', error.message);
            return null;
        }
    },

    /**
     * Bulk save segments to backend
     */
    async saveAll(pageId, segments) {
        try {
            const response = await fetch(`${API_BASE}/api/pages/${pageId}/segments`, {
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
    }
};

export { isBackendAvailable };
