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


class MeetingSummary(BaseModel):
    """会议转录的 AI 分析结果"""
    title: str = Field(description="简洁的会议标题，不超过20字")
    summary: str = Field(description="会议内容摘要，2-3句话")
    key_points: list[str] = Field(description="3-5个关键要点")
    todos: list[TodoItem] = Field(description="提取的待办事项列表")
    decisions: list[str] = Field(description="会议中做出的决定")


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
            
        prompt = f"""请分析以下会议转录内容，提取结构化信息。

## 会议转录：
{transcript}

## 要求：
1. 生成简洁的会议标题（不超过20字）
2. 写一个2-3句话的摘要
3. 列出3-5个关键要点
4. 提取所有待办事项（TODO）
5. 列出会议中做出的决定

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
