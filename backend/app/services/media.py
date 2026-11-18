"""Validação, armazenamento e miniaturas de mídias enviadas."""
import hashlib
import json
import os
import shutil
import subprocess
import uuid
import warnings
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Tuple

from fastapi import HTTPException, UploadFile, status
from PIL import Image

from app.core.config import get_settings
from app.models.enums import MediaKind

Image.MAX_IMAGE_PIXELS = 80_000_000  # ~ 10k x 8k; acima disso é tratado como bomba

ALLOWED = {
    # extensão: (tipo, mime)
    "jpg": (MediaKind.IMAGE, "image/jpeg"),
    "jpeg": (MediaKind.IMAGE, "image/jpeg"),
    "png": (MediaKind.IMAGE, "image/png"),
    "webp": (MediaKind.IMAGE, "image/webp"),
    "mp4": (MediaKind.VIDEO, "video/mp4"),
}
PILLOW_FORMATS = {"image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WEBP"}
MP4_BRANDS = {
    b"isom", b"iso2", b"iso3", b"iso4", b"iso5", b"iso6", b"mp41", b"mp42",
    b"avc1", b"M4V ", b"M4VP", b"dash", b"MSNV", b"NDAS", b"f4v ", b"mmp4",
}
CHUNK = 1024 * 1024


@dataclass
class StoredMedia:
    kind: MediaKind
    mime: str
    extension: str
    stored_name: str
    size: int
    sha256: str
    width: Optional[int] = None
    height: Optional[int] = None
    duration: Optional[float] = None
    thumbnail_name: Optional[str] = None
    warning: Optional[str] = None


def sniff_mime(head: bytes) -> Optional[str]:
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    if head[4:8] == b"ftyp" and head[8:12] in MP4_BRANDS:
        return "video/mp4"
    return None


def _bad(msg: str, code: int = status.HTTP_400_BAD_REQUEST) -> HTTPException:
    return HTTPException(code, msg)


def ensure_storage_dirs() -> None:
    s = get_settings()
    for d in (s.media_dir, s.thumbnails_dir, s.temporary_dir):
        d.mkdir(parents=True, exist_ok=True)


async def save_upload(upload: UploadFile) -> StoredMedia:
    s = get_settings()
    ensure_storage_dirs()
    original = upload.filename or "arquivo"
    ext = original.rsplit(".", 1)[-1].lower() if "." in original else ""
    if ext not in ALLOWED:
        raise _bad("Formato não permitido. Envie JPG, JPEG, PNG, WEBP ou MP4.")
    kind, expected_mime = ALLOWED[ext]
    limit = (s.max_image_mb if kind == MediaKind.IMAGE else s.max_video_mb) * 1024 * 1024

    tmp = s.temporary_dir / f"upload-{uuid.uuid4().hex}.part"
    sha = hashlib.sha256()
    size = 0
    head = b""
    try:
        with open(tmp, "wb") as out:
            while True:
                chunk = await upload.read(CHUNK)
                if not chunk:
                    break
                if len(head) < 32:
                    head += chunk[: 32 - len(head)]
                size += len(chunk)
                if size > limit:
                    raise _bad(
                        f"Arquivo excede o limite de {limit // (1024 * 1024)} MB",
                        413,
                    )
                sha.update(chunk)
                out.write(chunk)
        if size == 0:
            raise _bad("Arquivo vazio")
        mime = sniff_mime(head)
        if mime != expected_mime:
            raise _bad("O conteúdo do arquivo não corresponde à extensão informada")

        stored = StoredMedia(
            kind=kind,
            mime=mime,
            extension="jpg" if ext == "jpeg" else ext,
            stored_name="",
            size=size,
            sha256=sha.hexdigest(),
        )
        if kind == MediaKind.IMAGE:
            _inspect_image(tmp, mime, stored)
        else:
            _inspect_video(tmp, stored)

        stored.stored_name = f"{uuid.uuid4().hex}.{stored.extension}"
        dest = s.media_dir / stored.stored_name
        shutil.move(str(tmp), dest)
        os.chmod(dest, 0o640)
        stored.thumbnail_name = make_thumbnail(dest, kind)
        return stored
    finally:
        if tmp.exists():
            tmp.unlink()


def _inspect_image(path: Path, mime: str, stored: StoredMedia) -> None:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(path) as im:
                if im.format != PILLOW_FORMATS[mime]:
                    raise _bad("Imagem inválida")
                im.verify()
            with Image.open(path) as im:
                stored.width, stored.height = im.size
    except HTTPException:
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise _bad("Imagem com resolução excessiva")
    except Exception:
        raise _bad("Imagem corrompida ou inválida")


def _ffprobe(path: Path) -> Optional[dict]:
    if not shutil.which("ffprobe"):
        return None
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-print_format", "json", "-show_streams", "-show_format", str(path)],
            capture_output=True, timeout=60, check=True,
        )
        return json.loads(out.stdout or b"{}")
    except Exception:
        return {}


def _inspect_video(path: Path, stored: StoredMedia) -> None:
    info = _ffprobe(path)
    if info is None:
        stored.warning = "ffprobe não instalado: codecs e duração não verificados"
        return
    streams = info.get("streams") or []
    if not streams:
        raise _bad("Vídeo corrompido ou inválido")
    video = next((st for st in streams if st.get("codec_type") == "video"), None)
    if video is None:
        raise _bad("O arquivo não possui faixa de vídeo")
    stored.width = video.get("width")
    stored.height = video.get("height")
    try:
        stored.duration = round(float((info.get("format") or {}).get("duration")), 2)
    except (TypeError, ValueError):
        stored.duration = None
    audio = next((st for st in streams if st.get("codec_type") == "audio"), None)
    notes = []
    if video.get("codec_name") != "h264":
        notes.append(f"vídeo em {video.get('codec_name')} (recomendado H.264)")
    if audio is not None and audio.get("codec_name") != "aac":
        notes.append(f"áudio em {audio.get('codec_name')} (recomendado AAC)")
    if notes:
        stored.warning = "Compatibilidade: " + "; ".join(notes)


def make_thumbnail(path: Path, kind: MediaKind) -> Optional[str]:
    s = get_settings()
    name = f"{path.stem}.webp"
    dest = s.thumbnails_dir / name
    try:
        if kind == MediaKind.IMAGE:
            with Image.open(path) as im:
                im = im.convert("RGB")
                im.thumbnail((480, 270))
                im.save(dest, "WEBP", quality=80)
        else:
            if not shutil.which("ffmpeg"):
                return None
            subprocess.run(
                ["ffmpeg", "-y", "-v", "error", "-ss", "1", "-i", str(path), "-frames:v", "1",
                 "-vf", "scale=480:-2", str(dest)],
                capture_output=True, timeout=60, check=True,
            )
            if not dest.exists():
                # vídeo com menos de 1s: tenta o primeiro quadro
                subprocess.run(
                    ["ffmpeg", "-y", "-v", "error", "-i", str(path), "-frames:v", "1",
                     "-vf", "scale=480:-2", str(dest)],
                    capture_output=True, timeout=60, check=True,
                )
        if dest.exists():
            os.chmod(dest, 0o640)
            return name
    except Exception:
        if dest.exists():
            dest.unlink()
    return None


def delete_files(stored_name: str, thumbnail_name: Optional[str]) -> None:
    s = get_settings()
    for p in (s.media_dir / stored_name, s.thumbnails_dir / thumbnail_name if thumbnail_name else None):
        if p is not None and p.exists():
            p.unlink()


def media_path(stored_name: str) -> Path:
    return get_settings().media_dir / stored_name


def storage_usage() -> Tuple[int, int, int]:
    """(bytes usados pelas mídias, bytes livres no disco, total do disco)."""
    s = get_settings()
    used = 0
    if s.media_dir.exists():
        used = sum(f.stat().st_size for f in s.media_dir.iterdir() if f.is_file())
    target = s.storage_dir if s.storage_dir.exists() else s.storage_dir.parent
    du = shutil.disk_usage(target)
    return used, du.free, du.total
