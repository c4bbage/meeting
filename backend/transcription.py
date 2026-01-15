"""
Transcription Service - faster-whisper wrapper
"""

from faster_whisper import WhisperModel
from typing import Optional, List, Dict, Any
import os
import tempfile


class TranscriptionService:
    """faster-whisper transcription service with hotwords support"""
    
    def __init__(self, model_size: str = "small", device: str = "auto", compute_type: str = "auto"):
        """
        Initialize the transcription service.
        
        Args:
            model_size: Whisper model size (tiny, base, small, medium, large-v3)
            device: Device to use (auto, cpu, cuda)
            compute_type: Compute type (auto, int8, float16, float32)
        """
        # Auto-detect device
        if device == "auto":
            try:
                import torch
                device = "cuda" if torch.cuda.is_available() else "cpu"
            except ImportError:
                device = "cpu"
        
        # Auto-select compute type
        if compute_type == "auto":
            compute_type = "int8" if device == "cpu" else "float16"
        
        print(f"Loading Whisper model: {model_size} on {device} ({compute_type})")
        self.model = WhisperModel(model_size, device=device, compute_type=compute_type)
        print("Model loaded successfully")
    
    def transcribe(
        self,
        audio_path: str,
        language: str = "zh",
        hotwords: Optional[str] = None,
        initial_prompt: Optional[str] = None,
        word_timestamps: bool = True
    ) -> Dict[str, Any]:
        """
        Transcribe an audio file.
        
        Args:
            audio_path: Path to audio file
            language: Language code (zh, en, ja, etc.)
            hotwords: Space-separated hotwords for better accuracy
            initial_prompt: Context prompt to guide transcription
            word_timestamps: Whether to include word-level timestamps
            
        Returns:
            Dict with segments, duration, and language info
        """
        # Transcribe with faster-whisper
        segments_gen, info = self.model.transcribe(
            audio_path,
            language=language,
            word_timestamps=word_timestamps,
            hotwords=hotwords,
            initial_prompt=initial_prompt,
            vad_filter=True,  # Voice activity detection
            vad_parameters=dict(min_silence_duration_ms=500)
        )
        
        # Convert generator to list and extract data
        segments = []
        for seg in segments_gen:
            segment_data = {
                "id": seg.id,
                "start": round(seg.start, 3),
                "end": round(seg.end, 3),
                "text": seg.text.strip(),
            }
            
            # Add word-level timestamps if available
            if word_timestamps and seg.words:
                segment_data["words"] = [
                    {
                        "word": word.word.strip(),
                        "start": round(word.start, 3),
                        "end": round(word.end, 3),
                        "probability": round(word.probability, 3)
                    }
                    for word in seg.words
                ]
            
            segments.append(segment_data)
        
        return {
            "success": True,
            "language": info.language,
            "language_probability": round(info.language_probability, 3),
            "duration": round(info.duration, 3),
            "segments": segments
        }
    
    def transcribe_bytes(
        self,
        audio_bytes: bytes,
        filename: str,
        **kwargs
    ) -> Dict[str, Any]:
        """
        Transcribe audio from bytes (for API uploads).
        
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
_service: Optional[TranscriptionService] = None


def get_transcription_service() -> TranscriptionService:
    """Get or create the singleton transcription service."""
    global _service
    if _service is None:
        _service = TranscriptionService()
    return _service
