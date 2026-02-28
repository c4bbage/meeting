"""
Transcript Fusion Service - AI-powered merging of real-time and final transcripts
Uses Gemini to intelligently combine transcripts for best accuracy and completeness
"""

import logging
from typing import List, Dict, Any, Optional
from pydantic import BaseModel
from .gemini_service import get_gemini_service

logger = logging.getLogger(__name__)


class FusedSegment(BaseModel):
    """单个融合后的段落"""
    text: str
    timestamp: int
    endTime: Optional[int] = None
    speaker: Optional[str] = None
    confidence: float = 0.95
    source_info: str  # 来源说明: 'realtime', 'final', or 'merged'


class FusedTranscript(BaseModel):
    """融合后的完整转录"""
    segments: List[FusedSegment]
    total_segments: int
    fusion_notes: str  # AI的融合说明


class TranscriptFusionService:
    """转录融合服务"""
    
    def __init__(self):
        self.gemini = get_gemini_service()
    
    def fuse_transcripts(
        self,
        realtime_segments: List[Dict[str, Any]] = None,
        final_segments: List[Dict[str, Any]] = None,
        web_speech_segments: List[Dict[str, Any]] = None,
        streaming_segments: List[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        融合多份转录（支持2-3份转录源）

        Args:
            realtime_segments: 合并的实时转录段落 (兼容旧接口)
            final_segments: 最终高精度转录段落
            web_speech_segments: Web Speech API 实时转录
            streaming_segments: FunASR 流式转录

        Returns:
            融合后的段落列表
        """
        if not self.gemini.is_available():
            logger.warning("Gemini not available, returning best available")
            return {'segments': final_segments or realtime_segments or web_speech_segments or streaming_segments or [], 'method': 'fallback'}

        # 收集所有可用的转录源
        sources = {}
        if web_speech_segments:
            sources['web_speech'] = web_speech_segments
        if streaming_segments:
            sources['streaming'] = streaming_segments
        if final_segments:
            sources['final'] = final_segments
        # 如果没有分开的源，使用合并的 realtime
        if not sources and realtime_segments:
            sources['realtime'] = realtime_segments

        # 如果只有一个源，直接返回
        if len(sources) == 0:
            return {'segments': [], 'method': 'no_source'}
        if len(sources) == 1:
            source_name, segs = list(sources.items())[0]
            logger.info(f"Only one source available: {source_name}")
            return {'segments': segs, 'method': f'{source_name}_only'}
        
        try:
            # 构建融合提示（支持多源）
            prompt = self._build_multi_source_prompt(sources)

            # 调用Gemini融合
            source_info = ", ".join([f"{k}={len(v)}" for k, v in sources.items()])
            logger.info(f"Fusing transcripts: {source_info}")
            
            # Use Gemini SDK directly with schema
            from google import genai
            from google.genai import types
            
            response = self.gemini.client.models.generate_content(
                model=self.gemini.model,
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=FusedTranscript,
                    temperature=0.3,
                )
            )
            
            if not response.parsed:
                logger.warning("Gemini fusion failed to parse, using realtime version")
                return {'segments': realtime_segments, 'method': 'fallback_realtime'}
            
            result = response.parsed.model_dump()
            
            if not result or not result.get('segments'):
                logger.warning("Gemini fusion returned empty, using realtime version")
                return {'segments': realtime_segments, 'method': 'fallback_realtime'}
            
            logger.info(f"✅ Fusion complete: {len(result['segments'])} segments")
            logger.info(f"Fusion notes: {result.get('fusion_notes', 'N/A')}")
            
            # 转换为标准格式
            fused_segments = []
            for i, seg in enumerate(result['segments']):
                fused_segments.append({
                    'id': f"fused-{i}",
                    'text': seg['text'],
                    'timestamp': seg['timestamp'],
                    'endTime': seg.get('endTime') or seg.get('end_time'),
                    'speaker': seg.get('speaker'),
                    'confidence': seg.get('confidence', 0.95),
                    'isFinal': True,
                    'source': f"fused ({seg.get('source_info', 'merged')})"
                })
            
            return {
                'segments': fused_segments,
                'method': 'ai_fusion',
                'fusion_notes': result.get('fusion_notes')
            }
            
        except Exception as e:
            logger.error(f"Fusion error: {e}", exc_info=True)
            # 出错时返回最佳可用版本
            best_fallback = final_segments or realtime_segments or web_speech_segments or streaming_segments or []
            return {'segments': best_fallback, 'method': 'error_fallback'}
    
    def _build_multi_source_prompt(self, sources: Dict[str, List[Dict[str, Any]]]) -> str:
        """构建多源融合提示"""

        source_descriptions = {
            'web_speech': ('Web Speech API 实时转录', '浏览器端实时识别，完整但可能有错字'),
            'streaming': ('FunASR 流式转录', '服务端流式识别，较准确但可能有延迟断句'),
            'final': ('高精度最终转录', '录音结束后完整识别，最准确但可能丢失部分内容'),
            'realtime': ('合并实时转录', '实时识别结果，完整但可能不准确')
        }

        sections = []
        for source_name, segments in sources.items():
            desc, note = source_descriptions.get(source_name, (source_name, ''))
            text = self._format_segments_for_prompt(segments, desc)
            sections.append(f"## {desc} ({len(segments)} 段)\n{note}\n\n{text}")

        all_sections = "\n\n".join(sections)
        source_names = list(sources.keys())

        prompt = f"""你是一个专业的会议转录校对专家。我有同一场会议的 **{len(sources)} 份转录记录**，来自不同的识别引擎：

{all_sections}

## 任务要求

请像一个专业的会议记录整理员一样，将这 {len(sources)} 份转录整合成一份**最完整、最准确**的版本：

1. **完整性优先**: 不能丢失任何有意义的内容。如果某个版本有独特的内容，必须保留
2. **准确性判断**: 当多份转录覆盖同一时间段时，选择最准确的版本（通常 final > streaming > web_speech）
3. **智能填补**: 用其他版本填补缺失的片段
4. **时序正确**: 按时间戳排序，确保内容连贯
5. **去重合并**: 如果多份转录说的是同一句话，合并为一条，取最准确的文本
6. **标注来源**: 在 source_info 中标注该段落来源（{', '.join([f"'{s}'" for s in source_names])} 或 'merged'）

## 输出格式

返回 JSON 格式的 FusedTranscript，包含:
- segments: 融合后的段落列表（保持原始的说话人标注）
- total_segments: 总段落数
- fusion_notes: 简要说明融合决策（如：从哪个版本保留了多少内容，纠正了哪些错误）

开始整合吧！"""

        return prompt

    def _build_fusion_prompt(
        self,
        realtime_segments: List[Dict[str, Any]],
        final_segments: List[Dict[str, Any]]
    ) -> str:
        """构建Gemini融合提示（兼容旧接口）"""
        sources = {}
        if realtime_segments:
            sources['realtime'] = realtime_segments
        if final_segments:
            sources['final'] = final_segments
        return self._build_multi_source_prompt(sources)
    
    def _format_segments_for_prompt(
        self,
        segments: List[Dict[str, Any]],
        label: str
    ) -> str:
        """格式化段落用于提示"""
        if not segments:
            return f"{label}: (无内容)"
        
        lines = []
        for i, seg in enumerate(segments[:100]):  # 限制最多100条,避免prompt过长
            timestamp_sec = seg.get('timestamp', 0) / 1000
            text = seg.get('text', '').strip()
            speaker = seg.get('speaker') or seg.get('speakerLabel') or ''
            
            if speaker:
                lines.append(f"[{timestamp_sec:.1f}s] {speaker}: {text}")
            else:
                lines.append(f"[{timestamp_sec:.1f}s] {text}")
        
        if len(segments) > 100:
            lines.append(f"... (还有 {len(segments) - 100} 条段落)")
        
        return "\n".join(lines)


# Singleton instance
_fusion_service: Optional[TranscriptFusionService] = None


def get_fusion_service() -> TranscriptFusionService:
    """Get the global fusion service instance."""
    global _fusion_service
    if _fusion_service is None:
        _fusion_service = TranscriptFusionService()
    return _fusion_service
