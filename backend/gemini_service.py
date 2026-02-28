"""
Gemini Service - Uses Google GenAI SDK for advanced multi-modal capabilities.
Supports:
- Text & Image Understanding
- structured outputs (Pydantic)
- Thinking / Reasoning Models
- Function Calling
"""

import os
import io
import json
from typing import Optional, Any, List, Dict, Union, Callable
from pydantic import BaseModel, Field
from dotenv import load_dotenv

try:
    from google import genai
    from google.genai import types
except ImportError:
    print("Warning: google-genai not installed. Please run `uv sync` or `pip install google-genai`")
    genai = None

# Load environment variables
load_dotenv()

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-3-flash-preview") # Updated default

# ============================================
# Pydantic Schemas for Structured Output
# ============================================

class TodoItem(BaseModel):
    """从会议中提取的待办事项"""
    content: str = Field(description="待办事项内容")
    category: str = Field(description="分类: 任务/决策/讨论/跟进")
    deadline: Optional[str] = Field(default=None, description="截止日期，格式 YYYY-MM-DD，如无则为 null")
    priority: str = Field(default="中", description="优先级: 高/中/低")
    assignee: Optional[str] = Field(default=None, description="负责人，如无明确指定则为 null")
    completed: bool = Field(default=False, description="是否已完成")
    needs_reminder: bool = Field(default=False, description="是否需要提醒")
    subtasks: Optional[list[str]] = Field(default=None, description="子任务内容列表，每个元素是一个子任务的文字描述")


class MeetingSummary(BaseModel):
    """会议转录的 AI 分析结果"""
    title: str = Field(description="简洁的会议标题，不超过20字")
    summary: str = Field(description="会议内容的完整详细摘要，按讨论顺序逐一覆盖每个话题，保留所有具体数据、人名、项目名、时间节点，篇幅与原文长度成正比，不要省略任何讨论内容")
    key_points: list[str] = Field(description="关键要点，每个要点必须包含具体细节（谁、什么、何时、具体数字），一句话说清楚一个要点")
    todos: list[TodoItem] = Field(description="提取的所有待办事项，包括明确提到的和隐含的行动项")
    decisions: list[str] = Field(description="会议中做出的所有决定，包含决定的具体内容、原因和影响范围")


# ============================================
# Gemini Service
# ============================================

class GeminiService:
    """Gemini AI 服务 (Google GenAI SDK)"""
    
    def __init__(self):
        self.api_key = GEMINI_API_KEY
        self.model = GEMINI_MODEL
        self.client = None
        
        if self.api_key and self.api_key != "your_api_key_here" and genai:
            self.client = genai.Client(api_key=self.api_key)
    
    def is_available(self) -> bool:
        """检查 Gemini SDK 是否可用且已配置"""
        return self.client is not None
    
    async def analyze_meeting(self, transcript: str) -> dict:
        """
        分析会议转录，返回结构化结果 (Legacy compatibility wrapper)
        """
        if not self.is_available():
            raise ValueError("Gemini API Client not initialized")

        # Scale summary requirements based on transcript length
        word_count = len(transcript)
        if word_count > 10000:
            min_summary = 2000
            min_points = 15
            max_points = 30
        elif word_count > 5000:
            min_summary = 1200
            min_points = 12
            max_points = 25
        elif word_count > 2000:
            min_summary = 800
            min_points = 8
            max_points = 18
        else:
            min_summary = 400
            min_points = 5
            max_points = 12

        prompt = f"""请详细分析以下会议转录内容，提取完整的结构化信息。

转录总字数约 {word_count} 字，请确保摘要与原文篇幅成正比，不要过度压缩。

## 会议转录：
{transcript}

## 要求：
1. 生成简洁的会议标题（不超过20字）
2. 写一个完整详细的摘要（至少{min_summary}字），要求：
   - 按讨论顺序逐一覆盖每个话题，不要跳过任何讨论内容
   - 保留所有具体的数字、金额、百分比、日期、时间节点
   - 保留所有人名、公司名、项目名、产品名等专有名词
   - 如果有人引用了具体数据或案例，必须在摘要中体现
   - 记录讨论中的不同观点和争议点
   - 宁可写长一些也不要遗漏内容
   - 对于每个讨论话题，用一段话完整描述讨论过程和结论
3. 列出{min_points}-{max_points}个关键要点，每个要点要求：
   - 一句话说清楚一个具体的信息点
   - 必须包含"谁说了什么"或"关于什么的什么结论"
   - 包含具体数据（数字、日期、金额等）
   - 不要写笼统的概括，要写具体的事实
4. 提取所有待办事项（TODO），包括：
   - 明确提到的任务分配（"XX负责..."、"需要XX做..."）
   - 隐含的行动项（讨论中暗示需要跟进的事项）
   - 每个待办要尽量标注负责人和截止日期
5. 列出会议中做出的所有决定，包含决定的具体内容、原因和影响

重要原则：
- 转录可能有语音识别错误，请根据上下文理解真实含义
- 不要省略任何讨论过的话题，即使看起来不太重要
- 如果有笔记部分，笔记中的内容是人工记录的重点，优先级更高
- 摘要的详细程度应与原文长度成正比：原文越长，摘要也应越详细
- 宁可输出过多细节，也不要遗漏任何讨论要点。如果不确定是否重要，就保留
- 每个话题至少用2-3句话描述讨论过程、不同观点和最终结论
- 所有提到的具体金额、百分比、日期、人名、项目名必须原样保留在摘要中
- 关键要点不要使用"讨论了XX"这种笼统描述，要写"XX提出/决定/同意了具体内容"
请直接输出符合 Schema 的 JSON。"""

        # Using SDK's async generate_content if available, or wrapping sync
        # The new SDK is primarily sync for now? Let's check docs style.
        # Actually v1beta SDK has async, new google-genai is unified.
        # Assuming sync for simplicity unless we specifically need async.
        # We can run in threadpool for async compatibility.
        
        import asyncio
        
        def _run():
             response = self.client.models.generate_content(
                model=self.model,
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=MeetingSummary,
                    temperature=0.3,
                )
            )
             if not response.parsed:
                 # Fallback manual parse if needed, but SDK usually handles it
                 return json.loads(response.text)
             return response.parsed.model_dump()

        return await asyncio.to_thread(_run)

    async def analyze_image(self, image_data: bytes, prompt: str = "Describe this image") -> str:
        """
        多模态分析：分析图片内容
        """
        if not self.is_available():
            raise ValueError("Gemini API not available")

        import asyncio
        from PIL import Image
        
        def _run():
            # Convert bytes to PIL Image for SDK convenience, or pass bytes directly if SDK allows
            # google-genai SDK usually takes PIL Image object for convenience
            image = Image.open(io.BytesIO(image_data))
            
            response = self.client.models.generate_content(
                model=self.model,
                contents=[prompt, image]
            )
            return response.text

        return await asyncio.to_thread(_run)
    
    async def chat_with_tools(self, 
                              message: str, 
                              tools: List[Callable] = None, 
                              history: List[Any] = None,
                              thinking: bool = False) -> str:
        """
        带工具调用和思考能力的对话
        Args:
            message: 用户消息
            tools: 工具函数列表 (Python functions)
            history: 历史记录 (SDK Content objects)
            thinking: 是否启用思考模型 (Logic for switching model or config)
        """
        if not self.is_available():
            raise ValueError("Gemini API not available")
            
        import asyncio
        
        # Thinking config (if using 2.0-flash-thinking-exp or configuring thinking config)
        model_name = self.model
        config = types.GenerateContentConfig()
        
        if thinking:
            # Switch to a thinking model or enable config if supported
            if "thinking" not in model_name and "gemini-2.0" in model_name:
                # Naive switch, or just rely on config
                # For now, let's assume we might need to use a specific model or config
                # config.thinking_config = ... (Future SDK support)
                pass

        if tools:
            config.tools = tools
            config.automatic_function_calling = types.AutomaticFunctionCallingConfig(
                 disable=False,
                 maximum_remote_calls=None,
            )

        def _run():
            chat = self.client.chats.create(
                model=model_name,
                history=history or [],
                config=config
            )
            response = chat.send_message(message)
            return response.text

        return await asyncio.to_thread(_run)


# Singleton instance
_gemini_service: Optional[GeminiService] = None


def get_gemini_service() -> GeminiService:
    """获取 Gemini 服务单例"""
    global _gemini_service
    if _gemini_service is None:
        _gemini_service = GeminiService()
    return _gemini_service
