/**
 * Speaker Diarizer Service - 说话人分离服务
 * 基于启发式方法实现简单的说话人识别
 */

export class SpeakerDiarizerService {
  constructor(options = {}) {
    // 静音阈值（毫秒）- 超过此时间认为是不同说话人
    this.silenceThreshold = options.silenceThreshold || 2000;
    // 最大说话人数量
    this.maxSpeakers = options.maxSpeakers || 10;
    // 说话人颜色
    this.speakerColors = [
      '#4CAF50', // 绿色
      '#2196F3', // 蓝色
      '#FF9800', // 橙色
      '#9C27B0', // 紫色
      '#E91E63', // 粉色
      '#00BCD4', // 青色
      '#FF5722', // 深橙
      '#607D8B', // 蓝灰
      '#795548', // 棕色
      '#3F51B5', // 靛蓝
    ];

    this.reset();
  }

  /**
   * 重置状态
   */
  reset() {
    this.speakers = new Map();
    this.currentSpeaker = null;
    this.lastSegmentEnd = 0;
    this.segmentCount = 0;
  }

  /**
   * 处理新的转录片段，分配说话人
   * @param {Object} segment - 转录片段 { text, timestamp, duration }
   * @returns {Object} - 带说话人标识的片段
   */
  processSegment(segment) {
    const { timestamp, text } = segment;

    // 估算片段时长（基于字数，假设每个字约300ms）
    const estimatedDuration = segment.duration || (text.length * 300);
    const timeSinceLast = timestamp - this.lastSegmentEnd;

    let speaker;

    if (this.currentSpeaker === null) {
      // 第一个片段，创建第一个说话人
      speaker = this._createSpeaker();
    } else if (timeSinceLast > this.silenceThreshold) {
      // 静音时间超过阈值，可能是新说话人
      speaker = this._getNextSpeaker();
    } else {
      // 继续当前说话人
      speaker = this.currentSpeaker;
    }

    // 更新说话人统计
    this._updateSpeakerStats(speaker, segment);

    // 更新状态
    this.currentSpeaker = speaker;
    this.lastSegmentEnd = timestamp + estimatedDuration;
    this.segmentCount++;

    return {
      ...segment,
      speaker: speaker.id,
      speakerLabel: speaker.label,
      speakerColor: speaker.color
    };
  }

  /**
   * 创建新说话人
   */
  _createSpeaker() {
    const index = this.speakers.size;
    const id = `speaker_${index + 1}`;
    const speaker = {
      id,
      label: `说话人 ${index + 1}`,
      color: this.speakerColors[index % this.speakerColors.length],
      segmentCount: 0,
      totalDuration: 0,
      firstSeen: Date.now(),
      lastSeen: Date.now()
    };

    this.speakers.set(id, speaker);
    return speaker;
  }

  /**
   * 获取下一个说话人（可能是新的或轮换）
   */
  _getNextSpeaker() {
    // 如果只有一个说话人，创建第二个
    if (this.speakers.size === 1) {
      return this._createSpeaker();
    }

    // 如果有多个说话人，尝试轮换到上一个
    // 这是简单的启发式：假设对话是两人交替
    const speakerIds = Array.from(this.speakers.keys());
    const currentIndex = speakerIds.indexOf(this.currentSpeaker.id);
    const nextIndex = (currentIndex + 1) % speakerIds.length;

    // 如果轮换后还是同一个人，且未达到最大数量，创建新说话人
    if (nextIndex === currentIndex && this.speakers.size < this.maxSpeakers) {
      return this._createSpeaker();
    }

    return this.speakers.get(speakerIds[nextIndex]);
  }

  /**
   * 更新说话人统计信息
   */
  _updateSpeakerStats(speaker, segment) {
    const estimatedDuration = segment.duration || (segment.text.length * 300);
    speaker.segmentCount++;
    speaker.totalDuration += estimatedDuration;
    speaker.lastSeen = Date.now();
  }

  /**
   * 手动设置当前说话人
   * @param {string} speakerId - 说话人ID
   */
  setCurrentSpeaker(speakerId) {
    if (this.speakers.has(speakerId)) {
      this.currentSpeaker = this.speakers.get(speakerId);
    }
  }

  /**
   * 手动合并两个说话人
   * @param {string} sourceId - 源说话人ID（将被合并）
   * @param {string} targetId - 目标说话人ID（保留）
   */
  mergeSpeakers(sourceId, targetId) {
    const source = this.speakers.get(sourceId);
    const target = this.speakers.get(targetId);

    if (!source || !target) return false;

    // 合并统计信息
    target.segmentCount += source.segmentCount;
    target.totalDuration += source.totalDuration;
    target.firstSeen = Math.min(target.firstSeen, source.firstSeen);
    target.lastSeen = Math.max(target.lastSeen, source.lastSeen);

    // 删除源说话人
    this.speakers.delete(sourceId);

    // 如果当前说话人是源，切换到目标
    if (this.currentSpeaker?.id === sourceId) {
      this.currentSpeaker = target;
    }

    return { sourceId, targetId };
  }

  /**
   * 重命名说话人
   * @param {string} speakerId - 说话人ID
   * @param {string} newLabel - 新标签
   */
  renameSpeaker(speakerId, newLabel) {
    const speaker = this.speakers.get(speakerId);
    if (speaker) {
      speaker.label = newLabel;
      return true;
    }
    return false;
  }

  /**
   * 获取所有说话人列表
   */
  getSpeakers() {
    return Array.from(this.speakers.values());
  }

  /**
   * 获取说话人统计摘要
   */
  getSummary() {
    const speakers = this.getSpeakers();
    const totalDuration = speakers.reduce((sum, s) => sum + s.totalDuration, 0);

    return {
      totalSpeakers: speakers.length,
      totalSegments: this.segmentCount,
      totalDuration,
      speakers: speakers.map(s => ({
        ...s,
        percentage: totalDuration > 0
          ? ((s.totalDuration / totalDuration) * 100).toFixed(1)
          : 0
      }))
    };
  }

  /**
   * 调整静音阈值
   * @param {number} threshold - 新阈值（毫秒）
   */
  setSilenceThreshold(threshold) {
    this.silenceThreshold = threshold;
  }

  /**
   * 导出说话人数据（用于保存）
   */
  exportData() {
    return {
      speakers: Array.from(this.speakers.entries()),
      currentSpeakerId: this.currentSpeaker?.id,
      lastSegmentEnd: this.lastSegmentEnd,
      segmentCount: this.segmentCount,
      silenceThreshold: this.silenceThreshold
    };
  }

  /**
   * 导入说话人数据（用于恢复）
   */
  importData(data) {
    if (!data) return;

    this.speakers = new Map(data.speakers);
    this.currentSpeaker = data.currentSpeakerId
      ? this.speakers.get(data.currentSpeakerId)
      : null;
    this.lastSegmentEnd = data.lastSegmentEnd || 0;
    this.segmentCount = data.segmentCount || 0;
    this.silenceThreshold = data.silenceThreshold || 2000;
  }
}
