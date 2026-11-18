"""Senhas, sessões administrativas, tokens de dispositivo e URLs assinadas."""
import hashlib
import hmac
import secrets
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from app.core.config import get_settings

_hasher = PasswordHasher()
JWT_ALG = "HS256"

# Alfabeto sem caracteres ambíguos (0/O, 1/I/L) para leitura na TV
ACTIVATION_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


# Hash fixo para igualar o tempo de resposta quando o usuário não existe
DUMMY_PASSWORD_HASH = hash_password(secrets.token_urlsafe(16))


def create_session_token(user_id: int, session_version: int) -> str:
    s = get_settings()
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "sv": session_version,
        "typ": "admin",
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=s.access_token_minutes)).timestamp()),
    }
    return jwt.encode(payload, s.secret_key, algorithm=JWT_ALG)


def decode_session_token(token: str) -> Optional[dict]:
    try:
        payload = jwt.decode(token, get_settings().secret_key, algorithms=[JWT_ALG])
    except jwt.PyJWTError:
        return None
    if payload.get("typ") != "admin":
        return None
    return payload


def sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def new_device_token() -> str:
    return "uds_" + secrets.token_urlsafe(32)


def new_pairing_secret() -> str:
    return secrets.token_urlsafe(32)


def new_activation_code(length: int = 6) -> str:
    return "".join(secrets.choice(ACTIVATION_ALPHABET) for _ in range(length))


def normalize_activation_code(code: str) -> str:
    return "".join(ch for ch in code.upper() if ch.isalnum())


def _media_sig(media_id: int, sha: str, exp: int) -> str:
    msg = f"media:{media_id}:{sha}:{exp}".encode()
    return hmac.new(get_settings().secret_key.encode(), msg, hashlib.sha256).hexdigest()[:40]


def sign_media_url(media_id: int, sha: str, ttl: Optional[int] = None) -> str:
    ttl = ttl or get_settings().media_url_ttl_seconds
    exp = int(time.time()) + ttl
    return f"/api/player/media/{media_id}?exp={exp}&sig={_media_sig(media_id, sha, exp)}"


def verify_media_signature(media_id: int, sha: str, exp: int, sig: str) -> bool:
    if exp < int(time.time()):
        return False
    return hmac.compare_digest(_media_sig(media_id, sha, exp), sig)
