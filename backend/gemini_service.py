"""
Gemini Service - 使用 Gemini API 进行会议分析
支持结构化输出 (response_schema) 提取 TODO、摘要、标题等
"""

import os
import json
from typing import Optional
from pydantic import BaseModel, Field
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.0-flash")
GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"


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
    """Gemini AI 服务，支持结构化输出"""
    
    def __init__(self):
        self.api_key = GEMINI_API_KEY
        self.model = GEMINI_MODEL
        self.base_url = GEMINI_BASE_URL
    
    def is_available(self) -> bool:
        """检查 Gemini API 是否已配置"""
        return bool(self.api_key and self.api_key != "your_api_key_here")
    
    async def analyze_meeting(self, transcript: str) -> dict:
        """
        分析会议转录，返回结构化结果
        
        Args:
            transcript: 会议转录文本
            
        Returns:
            MeetingSummary 的 dict 形式
        """
        import aiohttp
        
        if not self.is_available():
            raise ValueError("Gemini API Key 未配置")
        
        url = f"{self.base_url}/models/{self.model}:generateContent?key={self.api_key}"
        
        prompt = f"""请分析以下会议转录内容，提取结构化信息。

## 会议转录：
{transcript}

## 要求：
1. 生成简洁的会议标题（不超过20字）
2. 写一个2-3句话的摘要
3. 列出3-5个关键要点
4. 提取所有待办事项（TODO），包括：
   - 具体任务内容
   - 分类（任务/决策/讨论/跟进）
   - 截止日期（如果提到了时间线索，如"明天"、"下周一"等，转换为 YYYY-MM-DD 格式）
   - 优先级（根据语气判断：高/中/低）
   - 负责人（如果提到）
   - 是否需要提醒（如果提到"别忘了"、"记得"、"一定要"等强调词，设为 true）
5. 列出会议中做出的决定

请严格按照 JSON schema 输出。"""

        body = {
            "contents": [{
                "parts": [{"text": prompt}]
            }],
            "generationConfig": {
                "responseMimeType": "application/json",
                "responseSchema": MeetingSummary.model_json_schema(),
                "temperature": 0.3,
                "maxOutputTokens": 2048
            }
        }
        
        async with aiohttp.ClientSession() as session:
            async with session.post(url, json=body) as response:
                if response.status != 200:
                    error_text = await response.text()
                    raise Exception(f"Gemini API 错误: {response.status} - {error_text}")
                
                data = await response.json()
                
                # Extract text from response
                text = data.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")
                
                if not text:
                    raise Exception("Gemini 返回空响应")
                
                # Parse JSON response
                result = json.loads(text)
                
                # Validate with Pydantic
                summary = MeetingSummary.model_validate(result)
                return summary.model_dump()


# Singleton instance
_gemini_service: Optional[GeminiService] = None


def get_gemini_service() -> GeminiService:
    """获取 Gemini 服务单例"""
    global _gemini_service
    if _gemini_service is None:
        _gemini_service = GeminiService()
    return _gemini_service
