"""
Hotword Manager - Manage custom vocabulary for better transcription accuracy
"""

import json
import os
from typing import Dict, List, Optional
from datetime import datetime

# Hotword categories (based on Feishu Minutes)
CATEGORIES = {
    "person": "人名",
    "company": "公司",
    "department": "部门", 
    "technology": "技术",
    "noun": "名词",
    "location": "地名",
    "traffic": "交通",
    "building": "建筑",
    "occupation": "职业",
    "other": "其他"
}


class HotwordManager:
    """Manage hotwords with categories for transcription."""
    
    def __init__(self, data_path: str = None):
        """
        Initialize hotword manager.
        
        Args:
            data_path: Path to hotwords JSON file
        """
        if data_path is None:
            data_path = os.path.join(os.path.dirname(__file__), "data", "hotwords.json")
        
        self.data_path = data_path
        self.hotwords: List[Dict] = []
        self._load()
    
    def _load(self):
        """Load hotwords from file."""
        if os.path.exists(self.data_path):
            try:
                with open(self.data_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    self.hotwords = data.get("hotwords", [])
            except Exception as e:
                print(f"Error loading hotwords: {e}")
                self.hotwords = []
        else:
            self.hotwords = []
    
    def _save(self):
        """Save hotwords to file."""
        os.makedirs(os.path.dirname(self.data_path), exist_ok=True)
        with open(self.data_path, "w", encoding="utf-8") as f:
            json.dump({"hotwords": self.hotwords}, f, ensure_ascii=False, indent=2)
    
    def add(self, word: str, category: str = "other") -> Dict:
        """
        Add a new hotword.
        
        Args:
            word: The hotword text
            category: Category key (person, company, technology, etc.)
            
        Returns:
            The created hotword dict
        """
        # Validate category
        if category not in CATEGORIES:
            category = "other"
        
        # Check for duplicates
        for hw in self.hotwords:
            if hw["word"] == word:
                # Update category if exists
                hw["category"] = category
                hw["updatedAt"] = datetime.now().isoformat()
                self._save()
                return hw
        
        # Create new hotword
        hotword = {
            "id": f"hw_{len(self.hotwords)}_{int(datetime.now().timestamp())}",
            "word": word,
            "category": category,
            "createdAt": datetime.now().isoformat(),
            "updatedAt": datetime.now().isoformat()
        }
        
        self.hotwords.append(hotword)
        self._save()
        return hotword
    
    def remove(self, hotword_id: str) -> bool:
        """
        Remove a hotword by ID.
        
        Args:
            hotword_id: The hotword ID to remove
            
        Returns:
            True if removed, False if not found
        """
        for i, hw in enumerate(self.hotwords):
            if hw["id"] == hotword_id:
                self.hotwords.pop(i)
                self._save()
                return True
        return False
    
    def get_all(self) -> List[Dict]:
        """Get all hotwords."""
        return self.hotwords
    
    def get_by_category(self, category: str) -> List[Dict]:
        """Get hotwords by category."""
        return [hw for hw in self.hotwords if hw["category"] == category]
    
    def get_hotwords_string(self) -> str:
        """
        Get all hotwords as a space-separated string for faster-whisper.
        
        Returns:
            Space-separated hotwords string
        """
        return " ".join(hw["word"] for hw in self.hotwords)
    
    def generate_initial_prompt(self) -> str:
        """
        Generate an initial prompt based on categorized hotwords.
        This helps guide the transcription model.
        
        Returns:
            Context prompt string
        """
        prompt_parts = []
        
        # Group by category
        by_category: Dict[str, List[str]] = {}
        for hw in self.hotwords:
            cat = hw["category"]
            if cat not in by_category:
                by_category[cat] = []
            by_category[cat].append(hw["word"])
        
        # Generate prompt parts
        if "person" in by_category:
            names = "、".join(by_category["person"])
            prompt_parts.append(f"参与者包括{names}")
        
        if "company" in by_category:
            companies = "、".join(by_category["company"])
            prompt_parts.append(f"涉及公司：{companies}")
        
        if "technology" in by_category:
            techs = "、".join(by_category["technology"])
            prompt_parts.append(f"技术术语：{techs}")
        
        if "location" in by_category:
            locs = "、".join(by_category["location"])
            prompt_parts.append(f"地点：{locs}")
        
        return "。".join(prompt_parts) + "。" if prompt_parts else ""
    
    @staticmethod
    def get_categories() -> Dict[str, str]:
        """Get available categories."""
        return CATEGORIES


# Singleton instance
_manager: Optional[HotwordManager] = None


def get_hotword_manager() -> HotwordManager:
    """Get or create the singleton hotword manager."""
    global _manager
    if _manager is None:
        _manager = HotwordManager()
    return _manager
