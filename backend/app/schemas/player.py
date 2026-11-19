from typing import Any, Dict, Optional

from pydantic import BaseModel, Field


class ActivationCodeRequest(BaseModel):
    player_version: Optional[str] = Field(default=None, max_length=32)


class ActivationCodeOut(BaseModel):
    code: str
    pairing_secret: str
    expires_in: int
    poll_interval: int = 5


class ActivationPoll(BaseModel):
    code: str = Field(max_length=16)
    pairing_secret: str = Field(max_length=128)


class HeartbeatIn(BaseModel):
    player_version: Optional[str] = Field(default=None, max_length=32)
    playback_state: Optional[str] = Field(default=None, max_length=32)  # playing|idle|error|loading|offline_cache
    connection_state: Optional[str] = Field(default=None, max_length=32)  # online|degraded
    current_content: Optional[str] = Field(default=None, max_length=255)
    config_hash: Optional[str] = Field(default=None, max_length=64)
    error: Optional[str] = Field(default=None, max_length=2000)
    storage: Optional[Dict[str, Any]] = None
    display: Optional[Dict[str, Any]] = None  # resolução/orientação detectadas no aparelho


class CommandAck(BaseModel):
    success: bool = True
    result: Optional[str] = Field(default=None, max_length=2000)
