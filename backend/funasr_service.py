"""
FunASR Transcription Service - 阿里达摩院语音识别
支持 SenseVoice 模型，中文识别效果更好
"""

from funasr import AutoModel
from typing import Optional, Dict, Any
import os
import tempfile
import time
from pathlib import Path


# Model cache directory
MODEL_CACHE_DIR = os.environ.get(
    "FUNASR_MODEL_CACHE",
    str(Path.home() / ".cache" / "funasr-models")
)


class FunASRService:
    """FunASR transcription service with SenseVoice model"""
    
    def __init__(
        self, 
        model_name: str = None,
        device: str = None
    ):
        """
        Initialize the FunASR service.
        
        Args:
            model_name: Model to use (default: SenseVoiceSmall)
            device: Device to use (auto, cpu, cuda)
            
        Environment variables:
            FUNASR_MODEL: Override model name
            FUNASR_DEVICE: Override device
            FUNASR_MODEL_CACHE: Override cache directory
        """
        # Get config from environment or use defaults
        model_name = model_name or os.environ.get("FUNASR_MODEL", "iic/SenseVoiceSmall")
        device = device or os.environ.get("FUNASR_DEVICE", "auto")
        
        # Auto-detect device
        if device == "auto":
            try:
                import torch
                device = "cuda" if torch.cuda.is_available() else "cpu"
            except ImportError:
                device = "cpu"
        
        # Ensure cache directory exists
        os.makedirs(MODEL_CACHE_DIR, exist_ok=True)
        
        print("=" * 50)
        print(f"🎤 FunASR Transcription Service")
        print(f"   Model: {model_name}")
        print(f"   Device: {device}")
        print(f"   Cache: {MODEL_CACHE_DIR}")
        print("=" * 50)
        
        start_time = time.time()
        print(f"Loading model...")
        
        # Load SenseVoice model from local cache
        # Downloaded via hf-mirror.com to ~/.cache/funasr-models/SenseVoiceSmall
        local_model_path = os.path.join(MODEL_CACHE_DIR, "SenseVoiceSmall")
        
        print(f"Loading from local path: {local_model_path}")
        
        self.model = AutoModel(
            model=local_model_path,
            trust_remote_code=True,
            device=device,
            disable_update=True,
        )
        
        elapsed = time.time() - start_time
        print(f"✅ Model loaded in {elapsed:.1f}s")
    
    def transcribe(
        self,
        audio_path: str,
        language: str = "zh",
        **kwargs
    ) -> Dict[str, Any]:
        """
        Transcribe an audio file.
        
        Args:
            audio_path: Path to audio file
            language: Language code (zh, en, ja, etc.)
            
        Returns:
            Dict with transcription result
        """
        start_time = time.time()
        
        # Transcribe with FunASR
        result = self.model.generate(
            input=audio_path,
            language=language,
            use_itn=True,  # Inverse text normalization
            batch_size_s=60,
        )
        
        elapsed = time.time() - start_time
        
        # Parse result
        if result and len(result) > 0:
            text = result[0].get("text", "")
            # SenseVoice returns emotion tags like <|HAPPY|>, clean them up
            import re
            # Keep the text, optionally extract emotion
            emotion_match = re.search(r'<\|(\w+)\|>', text)
            emotion = emotion_match.group(1) if emotion_match else None
            clean_text = re.sub(r'<\|[^|]+\|>', '', text).strip()
            
            return {
                "success": True,
                "text": clean_text,
                "emotion": emotion,
                "language": language,
                "duration": elapsed,
                "segments": [
                    {
                        "id": 0,
                        "start": 0,
                        "end": elapsed,
                        "text": clean_text
                    }
                ]
            }
        else:
            return {
                "success": True,
                "text": "",
                "segments": [],
                "duration": elapsed
            }
    
    def transcribe_bytes(
        self,
        audio_bytes: bytes,
        filename: str,
        **kwargs
    ) -> Dict[str, Any]:
        """
        Transcribe audio from bytes.
        
        Args:
            audio_bytes: Audio file content as bytes
            filename: Original filename (for extension detection)
            **kwargs: Additional arguments passed to transcribe()
            
        Returns:
            Transcription result dict
        """
        # Get file extension
        ext = os.path.splitext(filename)[1] or ".webm"
        
        # Write to temp file
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as f:
            f.write(audio_bytes)
            temp_path = f.name
        
        try:
            result = self.transcribe(temp_path, **kwargs)
            return result
        finally:
            # Cleanup temp file
            os.unlink(temp_path)


# Singleton instance
_funasr_service: Optional[FunASRService] = None


def get_funasr_service() -> FunASRService:
    """Get or create the singleton FunASR service."""
    global _funasr_service
    if _funasr_service is None:
        _funasr_service = FunASRService()
    return _funasr_service
