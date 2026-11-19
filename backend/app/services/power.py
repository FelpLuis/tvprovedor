"""Energia das TVs: horário de funcionamento + comando manual (ligar/desligar agora).

Regras:
- Sem horário ativo, a TV fica ligada.
- Com horário ativo, a TV fica ligada dentro das faixas e em espera fora delas.
  Uma faixa com desligamento antes do ligamento atravessa a meia-noite (ex.: 18:00 → 02:00).
- "Ligar/Desligar agora" vale até a próxima mudança do horário (ex.: desligar às 15h uma TV
  programada até 19h a mantém desligada até ela voltar a ligar pelo horário no dia seguinte).
  Sem horário ativo, o comando manual vale até "Voltar ao automático".
"""
from dataclasses import dataclass
from datetime import datetime, time, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from app.core.config import get_settings
from app.models import Screen

try:  # Python 3.9+
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover
    ZoneInfo = None  # type: ignore

DAY_NAMES = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"]


@dataclass
class PowerState:
    state: str                       # "on" | "off"
    reason: str                      # texto para o painel
    source: str                      # "always" | "schedule" | "manual"
    next_change: Optional[datetime]  # próxima mudança prevista (UTC)
    next_on: Optional[datetime]      # próximo horário em que a TV deve ligar (UTC), se estiver desligada

    def as_dict(self) -> Dict[str, Any]:
        return {
            "state": self.state,
            "reason": self.reason,
            "source": self.source,
            "next_change": self.next_change.isoformat() if self.next_change else None,
            "next_on": self.next_on.isoformat() if self.next_on else None,
            "next_on_ms": int(self.next_on.timestamp() * 1000) if self.next_on else None,
        }


def tz():
    name = get_settings().timezone
    if ZoneInfo is None:
        return timezone(timedelta(hours=-3))
    return ZoneInfo(name)


def _parse(hhmm: str) -> time:
    h, m = hhmm.split(":")
    return time(int(h), int(m))


def _slots(screen: Screen) -> List[Dict[str, Any]]:
    sched = screen.power_schedule or {}
    if not sched.get("enabled"):
        return []
    return [s for s in sched.get("slots") or [] if s.get("days")]


def schedule_state(slots: List[Dict[str, Any]], when: datetime) -> Optional[str]:
    """Estado pelo horário em `when` (None = sem horário ativo)."""
    if not slots:
        return None
    local = when.astimezone(tz())
    today, now_t = local.weekday(), local.time()
    yesterday = (today - 1) % 7
    for s in slots:
        on_t, off_t = _parse(s["on"]), _parse(s["off"])
        days = set(s["days"])
        if on_t < off_t:
            if today in days and on_t <= now_t < off_t:
                return "on"
        else:  # atravessa a meia-noite
            if today in days and now_t >= on_t:
                return "on"
            if yesterday in days and now_t < off_t:
                return "on"
    return "off"


def _boundaries(slots: List[Dict[str, Any]], start: datetime, days: int = 8) -> List[datetime]:
    """Horários (UTC) de liga/desliga nos próximos dias, em ordem."""
    zone = tz()
    local_start = start.astimezone(zone)
    out = []
    for d in range(-1, days + 1):
        day = (local_start + timedelta(days=d)).date()
        for s in slots:
            if day.weekday() not in s["days"]:
                continue
            for key in ("on", "off"):
                t = _parse(s[key])
                dt = datetime.combine(day, t)
                if key == "off" and _parse(s["off"]) <= _parse(s["on"]):
                    dt += timedelta(days=1)
                dt = dt.replace(tzinfo=zone)
                out.append(dt.astimezone(timezone.utc))
    return sorted(set(t for t in out if t > start))


def desired_at(screen: Screen, when: datetime) -> Tuple[str, str]:
    """(estado, origem) em `when`, considerando o comando manual."""
    slots = _slots(screen)
    sched = schedule_state(slots, when)
    override = screen.power_override
    if override in ("on", "off"):
        if sched is None:
            return override, "manual"
        # o comando manual vale enquanto o horário estiver no mesmo estado de quando foi dado
        base = screen.power_override_base
        set_at = screen.power_override_at
        if base == sched and (set_at is None or not _changed_since(slots, set_at, when)):
            return override, "manual"
    if sched is None:
        return "on", "always"
    return sched, "schedule"


def _changed_since(slots, since: datetime, until: datetime) -> bool:
    return any(since < b <= until for b in _boundaries(slots, since, days=8))


def evaluate(screen: Screen, now: Optional[datetime] = None) -> PowerState:
    now = now or datetime.now(timezone.utc)
    state, source = desired_at(screen, now)
    slots = _slots(screen)
    next_change = next_on = None
    if slots:
        for b in _boundaries(slots, now):
            st, _ = desired_at(screen, b)
            if st != state:
                next_change = b
                break
        if state == "off":
            for b in _boundaries(slots, now):
                if desired_at(screen, b)[0] == "on":
                    next_on = b
                    break
    local = lambda d: d.astimezone(tz())  # noqa: E731
    if source == "manual":
        reason = "Ligada manualmente" if state == "on" else "Desligada manualmente"
        if next_change:
            reason += f" até {DAY_NAMES[local(next_change).weekday()]} {local(next_change):%H:%M}"
        elif not slots:
            reason += " (até voltar ao automático)"
    elif source == "schedule":
        reason = "Ligada pelo horário" if state == "on" else "Em espera pelo horário"
        if next_change:
            verb = "desliga" if state == "on" else "liga"
            reason += f"; {verb} {DAY_NAMES[local(next_change).weekday()]} {local(next_change):%H:%M}"
    else:
        reason = "Sempre ligada"
    return PowerState(state, reason, source, next_change, next_on)


def set_override(screen: Screen, action: str, now: Optional[datetime] = None) -> None:
    """action: "on" | "off" | "auto"."""
    now = now or datetime.now(timezone.utc)
    if action == "auto":
        screen.power_override = None
        screen.power_override_base = None
        screen.power_override_at = None
        return
    screen.power_override = action
    screen.power_override_base = schedule_state(_slots(screen), now)
    screen.power_override_at = now
