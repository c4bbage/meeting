/**
 * Database Service - IndexedDB with Dexie.js
 * 数据持久化服务
 */

// Database instance
const db = new Dexie('MeetingTranscriptionDB');

// Define schema - Version 1 (original)
db.version(1).stores({
  pages: 'id, createdAt, updatedAt, status, syncStatus',
  segments: 'id, pageId, timestamp, isFinal',
  audioChunks: 'id, pageId, startTime'
});

// Version 2 - Add speaker support
db.version(2).stores({
  pages: 'id, createdAt, updatedAt, status, syncStatus',
  segments: 'id, pageId, timestamp, isFinal, speaker',
  audioChunks: 'id, pageId, startTime',
  speakerData: 'pageId'  // Store speaker diarization state per page
}).upgrade(tx => {
  // Migrate existing segments - add default speaker field
  return tx.table('segments').toCollection().modify(segment => {
    if (!segment.speaker) {
      segment.speaker = 'speaker_1';
      segment.speakerLabel = '说话人 1';
      segment.speakerColor = '#4CAF50';
    }
  });
});

/**
 * Page operations
 */
export const PageService = {
  /**
   * Create a new transcription page
   */
  async create(data = {}) {
    const page = {
      id: generateUUID(),
      title: data.title || `录音 ${formatDateTime(new Date())}`,
      createdAt: new Date(),
      updatedAt: new Date(),
      duration: 0,
      status: 'recording',
      syncStatus: 'pending',
      language: data.language || 'zh-CN',
      ...data
    };
    await db.pages.add(page);
    return page;
  },

  /**
   * Get all pages, sorted by creation date (newest first)
   */
  async getAll() {
    return await db.pages.orderBy('createdAt').reverse().toArray();
  },

  /**
   * Get a single page by ID
   */
  async getById(id) {
    return await db.pages.get(id);
  },

  /**
   * Update a page
   */
  async update(id, data) {
    data.updatedAt = new Date();
    await db.pages.update(id, data);
    return await this.getById(id);
  },

  /**
   * Delete a page and its segments
   */
  async delete(id) {
    await db.segments.where('pageId').equals(id).delete();
    await db.audioChunks.where('pageId').equals(id).delete();
    await db.speakerData.delete(id);
    await db.pages.delete(id);
  },

  /**
   * Find pages with recording status (for recovery)
   */
  async findRecording() {
    return await db.pages.where('status').equals('recording').toArray();
  }
};

/**
 * Segment operations
 */
export const SegmentService = {
  /**
   * Add a transcription segment
   */
  async add(pageId, data) {
    const segment = {
      id: generateUUID(),
      pageId,
      text: data.text,
      timestamp: data.timestamp,
      confidence: data.confidence || 0,
      isFinal: data.isFinal || false,
      speaker: data.speaker || null,
      speakerLabel: data.speakerLabel || null,
      speakerColor: data.speakerColor || null,
      createdAt: new Date()
    };
    await db.segments.add(segment);
    return segment;
  },

  /**
   * Get all segments for a page
   */
  async getByPageId(pageId) {
    return await db.segments
      .where('pageId')
      .equals(pageId)
      .sortBy('timestamp');
  },

  /**
   * Get only final segments for a page
   */
  async getFinalByPageId(pageId) {
    return await db.segments
      .where('pageId')
      .equals(pageId)
      .filter(seg => seg.isFinal)
      .sortBy('timestamp');
  },

  /**
   * Delete all segments for a page
   */
  async deleteByPageId(pageId) {
    await db.segments.where('pageId').equals(pageId).delete();
  },

  /**
   * Update interim results to final (cleanup old interim)
   */
  async cleanupInterim(pageId) {
    await db.segments
      .where('pageId')
      .equals(pageId)
      .filter(seg => !seg.isFinal)
      .delete();
  }
};

/**
 * Speaker data operations - 保存说话人分离状态
 */
export const SpeakerDataService = {
  /**
   * Save speaker diarization state for a page
   */
  async save(pageId, data) {
    const existing = await db.speakerData.get(pageId);
    if (existing) {
      await db.speakerData.update(pageId, { data, updatedAt: new Date() });
    } else {
      await db.speakerData.add({
        pageId,
        data,
        createdAt: new Date(),
        updatedAt: new Date()
      });
    }
  },

  /**
   * Load speaker diarization state for a page
   */
  async load(pageId) {
    const record = await db.speakerData.get(pageId);
    return record?.data || null;
  },

  /**
   * Delete speaker data for a page
   */
  async delete(pageId) {
    await db.speakerData.delete(pageId);
  }
};

/**
 * Utility functions
 */
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function formatDateTime(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

export { db, generateUUID, formatDateTime };
