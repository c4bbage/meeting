import asyncio
import os
import sys

# Add project root to path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from backend.gemini_service import get_gemini_service
from dotenv import load_dotenv

load_dotenv()

async def test_gemini():
    print("Initializing Gemini Service...")
    service = get_gemini_service()
    
    if not service.is_available():
        print("❌ Gemini Service not available (Check API Key or google-genai install)")
        return

    print("✅ Service initialized.")
    
    # Test 1: Analyze Meeting (Text)
    print("\n--- Testing Analyze Meeting ---")
    transcript = "Alice: We need to finish the meeting transciption project by Friday. Bob: I'll handle the backend. Alice: Great, I'll do the UI."
    try:
        result = await service.analyze_meeting(transcript)
        print("✅ Analysis Result:", result)
        if "todos" in result and len(result["todos"]) > 0:
            print("  - Found TODOs:", len(result["todos"]))
    except Exception as e:
        print(f"❌ Analyze Error: {e}")

    # Test 2: Chat (Tools/Thinking mock)
    print("\n--- Testing Chat (Mock) ---")
    try:
        # Simple chat without tools for basic connectivity
        response = await service.chat_with_tools("Hello, who are you?")
        print(f"✅ Chat Response: {response}")
    except Exception as e:
         print(f"❌ Chat Error: {e}")

if __name__ == "__main__":
    if not os.environ.get("GEMINI_API_KEY"):
         print("Please set GEMINI_API_KEY env var")
    else:
        asyncio.run(test_gemini())
