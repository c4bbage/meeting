/**
 * Database Service - IndexedDB with Dexie.js
 * 数据持久化服务 + 后端同步
 */

import Dexie from 'dexie';

import { PageSync, SegmentSync, isBackendAvailable } from './SyncService.js';
import { getWhisperAPI } from './WhisperAPI.js';

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

// Version 3 - Add hotwords and enhanced segments with word timestamps
db.version(3).stores({
  pages: 'id, createdAt, updatedAt, status, syncStatus',
  segments: 'id, pageId, timestamp, isFinal, speaker, source',
  audioChunks: 'id, pageId, startTime',
  speakerData: 'pageId',
  hotwords: 'id, word, category, createdAt'  // Custom vocabulary
}).upgrade(tx => {
  // Add source field to existing segments
  return tx.table('segments').toCollection().modify(segment => {
    if (!segment.source) {
      segment.source = 'web_speech';
    }
  });
});

// Version 4 - Add todos table and Page AI analysis fields
db.version(4).stores({
  pages: 'id, createdAt, updatedAt, status, syncStatus',
  segments: 'id, pageId, timestamp, isFinal, speaker, source',
  audioChunks: 'id, pageId, startTime',
  speakerData: 'pageId',
  hotwords: 'id, word, category, createdAt',
  todos: 'id, pageId, category, completed, deadline, createdAt'  // AI-extracted TODOs
}).upgrade(tx => {
  // Add analysis fields to existing pages
  return tx.table('pages').toCollection().modify(page => {
    if (!page.autoTitle) page.autoTitle = null;
    if (!page.summary) page.summary = null;
    if (!page.keyPoints) page.keyPoints = [];
    if (!page.decisions) page.decisions = [];
    if (!page.wordCount) page.wordCount = 0;
    if (!page.todoCount) page.todoCount = 0;
    if (!page.analyzed) page.analyzed = false;
  });
});

/**
 * Page operations with backend sync
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

    // Sync to backend (non-blocking)
    PageSync.create(page).then(result => {
      if (result) {
        db.pages.update(page.id, { syncStatus: 'synced' });
      }
    });

    return page;
  },

  /**
   * Get all pages, sorted by creation date (newest first)
   * Attempts to sync with backend first
   */
  async getAll() {
    // Try to fetch from backend first
    const backendPages = await PageSync.fetchAll();

    if (backendPages !== null) {
      // Merge backend data with local (backend is source of truth)
      for (const remotePage of backendPages) {
        const localPage = await db.pages.get(remotePage.id);
        if (!localPage) {
          // Add new page from backend
          await db.pages.add({
            ...remotePage,
            createdAt: new Date(remotePage.createdAt),
            updatedAt: new Date(remotePage.updatedAt),
            syncStatus: 'synced'
          });
        } else {
          // Update local page with backend data
          await db.pages.update(remotePage.id, {
            ...remotePage,
            createdAt: new Date(remotePage.createdAt),
            updatedAt: new Date(remotePage.updatedAt),
            syncStatus: 'synced'
          });
        }
      }

      // Remove locally deleted pages that exist in backend
      // (keep local pages that might not be synced yet)
    }

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

    await db.pages.update(id, data);

    // Sync to backend (Upsert logic)
    // Try to update first, if that fails (e.g. 404 not found on backend), try to create
    PageSync.update(id, data).then(updatedPage => {
      if (!updatedPage) {
        console.log('Update failed on backend, trying to create page...', id);
        // Fetch full local page to ensure we have all fields for creation
        db.pages.get(id).then(fullPage => {
          if (fullPage) {
            PageSync.create(fullPage);
          }
        });
      }
    });

    return await this.getById(id);
  },

  /**
   * Delete a page and its segments (soft delete on backend)
   */
  async delete(id) {
    // Soft delete on backend first
    await PageSync.delete(id);

    // Delete locally
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
   * @param {string} pageId - The page ID
   * @param {Object} data - Segment data
   * @param {string} data.text - Transcribed text
   * @param {number} data.timestamp - Start time in ms
   * @param {number} [data.endTime] - End time in ms (from whisper)
   * @param {number} [data.confidence] - Confidence score 0-1
   * @param {boolean} [data.isFinal] - Is final result
   * @param {string} [data.speaker] - Speaker ID
   * @param {string} [data.speakerLabel] - Speaker display name
   * @param {string} [data.speakerColor] - Speaker color
   * @param {Array} [data.words] - Word-level timestamps [{word, start, end, probability}]
   * @param {string} [data.source] - Transcription source: 'web_speech' | 'whisper'
   */
  async add(pageId, data) {
    const segment = {
      id: generateUUID(),
      pageId,
      text: data.text,
      timestamp: data.timestamp,
      endTime: data.endTime || null,           // 新增: 结束时间
      confidence: data.confidence || 0,
      isFinal: data.isFinal || false,
      speaker: data.speaker || null,
      speakerLabel: data.speakerLabel || null,
      speakerColor: data.speakerColor || null,
      words: data.words || null,               // 新增: 单词级时间戳
      source: data.source || 'web_speech',     // 新增: 转录来源
      createdAt: new Date()
    };
    await db.segments.add(segment);
    return segment;
  },

  /**
   * Add multiple segments from backend ASR transcription result
   * @param {string} pageId - The page ID
   * @param {Array} segments - ASR segments with start/end/text/words
   * @param {string} [source] - Source name: 'whisper' | 'funasr' (default: 'backend')
   */
  async addFromWhisper(pageId, segments, source = 'backend') {
    const dbSegments = segments.map((seg, index) => ({
      id: generateUUID(),
      pageId,
      text: seg.text,
      timestamp: Math.round(seg.start * 1000),  // 秒转毫秒
      endTime: Math.round(seg.end * 1000),
      confidence: seg.words?.[0]?.probability || 0.9,
      isFinal: true,
      speaker: null,
      speakerLabel: null,
      speakerColor: null,
      words: seg.words || null,
      source: source,
      createdAt: new Date()
    }));

    await db.segments.bulkAdd(dbSegments);
    return dbSegments;
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
   * Get only final segments for a page (default source or specified)
   * @param {string} pageId - The page ID
   * @param {string} [source] - Optional source filter: 'web_speech' | 'whisper' | 'funasr'
   */
  async getFinalByPageId(pageId, source = null) {
    // First check local IndexedDB
    let segments = await db.segments
      .where('pageId')
      .equals(pageId)
      .filter(seg => seg.isFinal)
      .toArray();

    // If no local segments, try to fetch from backend
    if (segments.length === 0) {
      const backendSegments = await SegmentSync.fetchByPageId(pageId);
      if (backendSegments && backendSegments.length > 0) {
        // Cache in local IndexedDB for future access
        for (const seg of backendSegments) {
          try {
            await db.segments.put({
              ...seg,
              createdAt: new Date(seg.createdAt || Date.now())
            });
          } catch (e) {
            // Ignore duplicate key errors
          }
        }
        segments = backendSegments;
      }
    }

    // Apply source filter
    if (source) {
      segments = segments.filter(seg => seg.source === source);
    }

    // Sort by timestamp
    return segments.sort((a, b) => a.timestamp - b.timestamp);
  },

  /**
   * Find pages whose final segments contain the query text
   */
  async searchPageIdsByText(query) {
    const trimmed = (query || '').trim().toLowerCase();
    if (!trimmed) return [];

    const remoteIds = await SegmentSync.searchPageIdsByText(trimmed);
    if (Array.isArray(remoteIds)) {
      return remoteIds;
    }

    const segments = await db.segments
      .where('isFinal')
      .equals(true)
      .filter(seg => {
        if (!seg?.text) return false;
        return seg.text.toLowerCase().includes(trimmed);
      })
      .toArray();

    return Array.from(new Set(segments.map(seg => seg.pageId)));
  },

  /**
   * Get available sources for a page (e.g., ['web_speech', 'whisper'])
   */
  async getSourcesByPageId(pageId) {
    const segments = await db.segments
      .where('pageId')
      .equals(pageId)
      .filter(seg => seg.isFinal)
      .toArray();

    const sources = [...new Set(segments.map(s => s.source).filter(Boolean))];
    return sources;
  },

  /**
   * Delete segments by page and source
   */
  async deleteBySource(pageId, source) {
    await db.segments
      .where('pageId')
      .equals(pageId)
      .filter(seg => seg.source === source)
      .delete();
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
  },

  /**
   * Sync all final segments for a page to backend
   */
  async syncToBackend(pageId) {
    const segments = await this.getFinalByPageId(pageId);
    if (segments.length > 0) {
      const count = await SegmentSync.saveAll(pageId, segments);
      console.log(`Synced ${count} segments to backend for page ${pageId}`);
      return count;
    }
    return 0;
  }
};

/**
 * Speaker data operations - 保存说话人分离状态
 */
export const SpeakerDataService = {
  /**
   * Save speaker diarization state for a page (syncs to backend)
   */
  async save(pageId, data) {
    // Save locally first
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

    // Sync to backend
    try {
      const backendAvailable = await isBackendAvailable();
      if (backendAvailable) {
        await fetch(`/api/pages/${pageId}/speakers`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data })
        });
      }
    } catch (error) {
      console.warn('Failed to sync speaker data to backend:', error);
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
  },

  /**
   * Sync speaker data from backend to local IndexedDB
   */
  async syncFromBackend(pageId) {
    try {
      const backendAvailable = await isBackendAvailable();
      if (!backendAvailable) return null;

      const response = await fetch(`/api/pages/${pageId}/speakers`);
      if (!response.ok) return null;

      const result = await response.json();
      if (result.success && result.speakerData?.data) {
        const backendData = result.speakerData;

        // Save to local DB
        const existing = await db.speakerData.get(pageId);
        if (existing) {
          await db.speakerData.update(pageId, {
            data: backendData.data,
            updatedAt: new Date(backendData.updatedAt)
          });
        } else {
          await db.speakerData.add({
            pageId,
            data: backendData.data,
            createdAt: new Date(backendData.createdAt),
            updatedAt: new Date(backendData.updatedAt)
          });
        }

        return backendData.data;
      }
    } catch (error) {
      console.warn('Failed to sync speaker data from backend:', error);
    }
    return null;
  }
};

/**
 * Hotword operations - Custom vocabulary management
 */
export const HotwordService = {
  // Category definitions (matching Feishu Minutes)
  CATEGORIES: {
    person: '人名',
    company: '公司',
    department: '部门',
    technology: '技术',
    noun: '名词',
    location: '地名',
    traffic: '交通',
    building: '建筑',
    occupation: '职业',
    other: '其他'
  },

  /**
   * Add a new hotword (syncs to backend)
   */
  async add(word, category = 'other') {
    // First sync to backend
    try {
      const api = getWhisperAPI();
      const result = await api.addHotword(word, category);
      if (result.success && result.hotword) {
        // Use backend's hotword data (includes server-generated ID)
        const backendHotword = result.hotword;
        const hotword = {
          id: backendHotword.id,
          word: backendHotword.word,
          category: backendHotword.category,
          createdAt: new Date(backendHotword.createdAt),
          updatedAt: new Date(backendHotword.updatedAt)
        };

        // Check for duplicates in local DB
        const existing = await db.hotwords.where('word').equals(word).first();
        if (existing) {
          await db.hotwords.update(existing.id, hotword);
        } else {
          await db.hotwords.put(hotword);
        }
        return hotword;
      }
    } catch (error) {
      console.warn('Failed to sync hotword to backend:', error);
    }

    // Fallback: save locally only if backend fails
    const existing = await db.hotwords.where('word').equals(word).first();
    if (existing) {
      await db.hotwords.update(existing.id, {
        category,
        updatedAt: new Date()
      });
      return { ...existing, category };
    }

    const hotword = {
      id: generateUUID(),
      word,
      category,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    await db.hotwords.add(hotword);
    return hotword;
  },

  /**
   * Get all hotwords
   */
  async getAll() {
    return await db.hotwords.orderBy('createdAt').reverse().toArray();
  },

  /**
   * Get hotwords by category
   */
  async getByCategory(category) {
    return await db.hotwords.where('category').equals(category).toArray();
  },

  /**
   * Delete a hotword (syncs to backend)
   */
  async delete(id) {
    // First sync to backend
    try {
      const api = getWhisperAPI();
      await api.deleteHotword(id);
    } catch (error) {
      console.warn('Failed to delete hotword from backend:', error);
    }
    // Always delete locally
    await db.hotwords.delete(id);
  },

  /**
   * Get all hotwords as space-separated string (for whisper API)
   */
  async getHotwordsString() {
    const hotwords = await this.getAll();
    return hotwords.map(hw => hw.word).join(' ');
  },

  /**
   * Generate initial prompt from categorized hotwords
   */
  async generatePrompt() {
    const hotwords = await this.getAll();
    const byCategory = {};

    hotwords.forEach(hw => {
      if (!byCategory[hw.category]) {
        byCategory[hw.category] = [];
      }
      byCategory[hw.category].push(hw.word);
    });

    const parts = [];
    if (byCategory.person?.length) {
      parts.push(`参与者：${byCategory.person.join('、')}`);
    }
    if (byCategory.company?.length) {
      parts.push(`公司：${byCategory.company.join('、')}`);
    }
    if (byCategory.technology?.length) {
      parts.push(`技术：${byCategory.technology.join('、')}`);
    }

    return parts.length ? parts.join('。') + '。' : '';
  },

  /**
   * Sync hotwords from backend to local IndexedDB
   * Call this when the page loads to get the latest hotwords from all devices
   */
  async syncFromBackend() {
    try {
      const api = getWhisperAPI();
      const result = await api.getHotwords();

      if (result.hotwords && Array.isArray(result.hotwords)) {
        // Clear local hotwords and replace with backend data
        await db.hotwords.clear();

        for (const hw of result.hotwords) {
          await db.hotwords.put({
            id: hw.id,
            word: hw.word,
            category: hw.category,
            createdAt: new Date(hw.createdAt),
            updatedAt: new Date(hw.updatedAt)
          });
        }

        console.log(`Synced ${result.hotwords.length} hotwords from backend`);
        return result.hotwords.length;
      }
    } catch (error) {
      console.warn('Failed to sync hotwords from backend:', error);
    }
    return 0;
  }
};

/**
 * Audio storage operations - 保存和获取录音音频
 */
export const AudioService = {
  /**
   * Save audio blob for a page
   */
  async save(pageId, blob, mimeType = 'audio/webm') {
    const audioData = {
      id: generateUUID(),
      pageId,
      blob,
      mimeType,
      size: blob.size,
      createdAt: new Date()
    };
    await db.audioChunks.add(audioData);
    return audioData;
  },

  /**
   * Get audio for a page
   */
  async getByPageId(pageId) {
    const chunks = await db.audioChunks.where('pageId').equals(pageId).toArray();
    if (chunks.length === 0) return null;

    chunks.sort((a, b) => {
      const timeA = new Date(a.createdAt || 0).getTime();
      const timeB = new Date(b.createdAt || 0).getTime();
      return timeA - timeB;
    });

    // If multiple chunks, combine them (though we typically save one blob)
    if (chunks.length === 1) {
      return chunks[0];
    }

    // Combine multiple chunks into one blob
    const blobs = chunks.map(c => c.blob);
    const combinedBlob = new Blob(blobs, { type: chunks[0].mimeType });
    return {
      ...chunks[0],
      blob: combinedBlob,
      size: combinedBlob.size
    };
  },

  /**
   * Delete audio for a page
   */
  async deleteByPageId(pageId) {
    await db.audioChunks.where('pageId').equals(pageId).delete();
  },

  /**
   * Get audio URL for playback
   */
  async getAudioUrl(pageId) {
    const audio = await this.getByPageId(pageId);
    if (!audio?.blob) return null;
    return URL.createObjectURL(audio.blob);
  },

  /**
   * Get audio blob (for DetailView)
   */
  async getAudio(pageId) {
    const audio = await this.getByPageId(pageId);
    return audio?.blob || null;
  }
};

/**
 * Todo operations
 */
export const TodoService = {
  /**
   * Add a todo from AI analysis
   */
  async add(pageId, todoData) {
    const todo = {
      id: generateUUID(),
      pageId,
      content: todoData.content,
      category: todoData.category || '任务',
      deadline: todoData.deadline || null,
      priority: todoData.priority || '中',
      assignee: todoData.assignee || null,
      completed: todoData.completed || false,
      needsReminder: todoData.needs_reminder || false,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    await db.todos.add(todo);
    return todo;
  },

  /**
   * Add multiple todos from AI analysis
   */
  async addBatch(pageId, todos) {
    const now = new Date();
    const dbTodos = todos.map(t => ({
      id: generateUUID(),
      pageId,
      content: t.content,
      category: t.category || '任务',
      deadline: t.deadline || null,
      priority: t.priority || '中',
      assignee: t.assignee || null,
      completed: t.completed || false,
      needsReminder: t.needs_reminder || false,
      createdAt: now,
      updatedAt: now
    }));
    await db.todos.bulkAdd(dbTodos);
    return dbTodos;
  },

  /**
   * Upsert todos with provided IDs (from backend sync)
   */
  async upsertBatch(pageId, todos) {
    const now = new Date();
    const dbTodos = todos.map(t => ({
      id: t.id || generateUUID(),
      pageId,
      content: t.content,
      category: t.category || '任务',
      deadline: t.deadline || null,
      priority: t.priority || '中',
      assignee: t.assignee || null,
      completed: t.completed || false,
      needsReminder: t.needsReminder ?? t.needs_reminder ?? false,
      createdAt: t.createdAt ? new Date(t.createdAt) : now,
      updatedAt: t.updatedAt ? new Date(t.updatedAt) : now
    }));
    await db.todos.bulkPut(dbTodos);
    return dbTodos;
  },

  /**
   * Get all todos for a page
   */
  async getByPageId(pageId) {
    return await db.todos
      .where('pageId')
      .equals(pageId)
      .sortBy('createdAt');
  },

  /**
   * Get all todos (newest first)
   */
  async getAll() {
    return await db.todos
      .orderBy('createdAt')
      .reverse()
      .toArray();
  },

  /**
   * Toggle todo completion (syncs to backend)
   */
  async toggle(id) {
    const todo = await db.todos.get(id);
    if (todo) {
      const newCompleted = !todo.completed;
      await db.todos.update(id, {
        completed: newCompleted,
        updatedAt: new Date()
      });

      // Sync to backend
      try {
        const backendAvailable = await isBackendAvailable();
        if (backendAvailable) {
          await fetch(`/api/todos/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ completed: newCompleted })
          });
        }
      } catch (error) {
        console.warn('Failed to sync todo toggle to backend:', error);
      }

      return newCompleted;
    }
    return null;
  },

  /**
   * Update a todo (syncs to backend)
   */
  async update(id, data) {
    await db.todos.update(id, {
      ...data,
      updatedAt: new Date()
    });

    // Sync to backend
    try {
      const backendAvailable = await isBackendAvailable();
      if (backendAvailable) {
        await fetch(`/api/todos/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
      }
    } catch (error) {
      console.warn('Failed to sync todo update to backend:', error);
    }
  },

  /**
   * Delete a todo (syncs to backend)
   */
  async delete(id) {
    await db.todos.delete(id);

    // Sync to backend
    try {
      const backendAvailable = await isBackendAvailable();
      if (backendAvailable) {
        await fetch(`/api/todos/${id}`, { method: 'DELETE' });
      }
    } catch (error) {
      console.warn('Failed to sync todo delete to backend:', error);
    }
  },

  /**
   * Delete all todos for a page
   */
  async deleteByPageId(pageId) {
    await db.todos.where('pageId').equals(pageId).delete();
  },

  /**
   * Get todo counts (completed/total) for a page
   */
  async getCounts(pageId) {
    const todos = await this.getByPageId(pageId);
    const total = todos.length;
    const completed = todos.filter(t => t.completed).length;
    return { completed, total };
  },

  /**
   * Sync all todos for a page to backend
   */
  async syncToBackend(pageId) {
    try {
      const backendAvailable = await isBackendAvailable();
      if (!backendAvailable) return 0;

      const todos = await this.getByPageId(pageId);
      const todosData = todos.map(t => ({
        id: t.id,
        pageId: t.pageId,
        content: t.content,
        category: t.category,
        deadline: t.deadline,
        priority: t.priority,
        assignee: t.assignee,
        completed: t.completed,
        needsReminder: t.needsReminder,
        createdAt: t.createdAt instanceof Date ? t.createdAt.toISOString() : t.createdAt,
        updatedAt: t.updatedAt instanceof Date ? t.updatedAt.toISOString() : t.updatedAt
      }));

      const response = await fetch(`/api/pages/${pageId}/todos/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ todos: todosData })
      });

      if (response.ok) {
        const result = await response.json();
        console.log(`Synced ${result.count} todos to backend`);
        return result.count;
      }
    } catch (error) {
      console.warn('Failed to sync todos to backend:', error);
    }
    return 0;
  },

  /**
   * Sync todos from backend to local IndexedDB
   */
  async syncFromBackend(pageId) {
    try {
      const backendAvailable = await isBackendAvailable();
      if (!backendAvailable) return 0;

      const response = await fetch(`/api/pages/${pageId}/todos`);
      if (!response.ok) return 0;

      const result = await response.json();
      if (result.success && result.todos && Array.isArray(result.todos)) {
        // Clear local todos for this page and replace with backend data
        await db.todos.where('pageId').equals(pageId).delete();

        for (const todo of result.todos) {
          await db.todos.put({
            id: todo.id,
            pageId: todo.pageId,
            content: todo.content,
            category: todo.category,
            deadline: todo.deadline,
            priority: todo.priority,
            assignee: todo.assignee,
            completed: todo.completed,
            needsReminder: todo.needsReminder,
            createdAt: new Date(todo.createdAt),
            updatedAt: new Date(todo.updatedAt)
          });
        }

        console.log(`Synced ${result.todos.length} todos from backend`);
        return result.todos.length;
      }
    } catch (error) {
      console.warn('Failed to sync todos from backend:', error);
    }
    return 0;
  }
};

/**
 * Utility functions
 */
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
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
