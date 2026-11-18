from typing import Any, Dict, Optional

from fastapi import Request
from sqlalchemy.orm import Session

from app.core.permissions import client_ip
from app.models import AuditLog, Screen, User


def record(
    db: Session,
    action: str,
    *,
    request: Optional[Request] = None,
    user: Optional[User] = None,
    screen: Optional[Screen] = None,
    entity_type: str = "",
    entity_id: Any = None,
    details: Optional[Dict[str, Any]] = None,
) -> AuditLog:
    """Registra um evento de auditoria (o commit fica a cargo de quem chamou)."""
    if user is not None:
        actor_type, actor_name = "user", user.username
    elif screen is not None:
        actor_type, actor_name = "device", f"{screen.identifier} ({screen.name})"
    else:
        actor_type, actor_name = "system", "system"
    log = AuditLog(
        actor_type=actor_type,
        user_id=user.id if user is not None else None,
        actor_name=actor_name,
        action=action,
        entity_type=entity_type,
        entity_id=str(entity_id) if entity_id is not None else None,
        details=details or None,
        ip=client_ip(request) if request is not None else None,
    )
    db.add(log)
    return log
