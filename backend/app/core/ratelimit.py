"""Limitador simples em memória para tentativas de login (processo único)."""
import threading
import time
from typing import Dict, List, Tuple


class LoginRateLimiter:
    def __init__(self, max_attempts: int, window_seconds: int):
        self.max_attempts = max_attempts
        self.window = window_seconds
        self._fails: Dict[str, List[float]] = {}
        self._lock = threading.Lock()

    def _prune(self, key: str, now: float) -> List[float]:
        items = [t for t in self._fails.get(key, []) if now - t < self.window]
        if items:
            self._fails[key] = items
        else:
            self._fails.pop(key, None)
        return items

    def check(self, *keys: str) -> Tuple[bool, int]:
        """Retorna (bloqueado, segundos restantes)."""
        now = time.monotonic()
        with self._lock:
            for key in keys:
                items = self._prune(key, now)
                if len(items) >= self.max_attempts:
                    return True, int(self.window - (now - items[0])) + 1
        return False, 0

    def fail(self, *keys: str) -> None:
        now = time.monotonic()
        with self._lock:
            for key in keys:
                self._fails.setdefault(key, []).append(now)

    def reset(self, *keys: str) -> None:
        with self._lock:
            for key in keys:
                self._fails.pop(key, None)

    def clear(self) -> None:
        with self._lock:
            self._fails.clear()
