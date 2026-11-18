from enum import Enum


class Role(str, Enum):
    ADMIN = "admin"
    OPERATOR = "operator"
    VIEWER = "viewer"


class ScreenProfile(str, Enum):
    MEDIA_PLAYER = "MEDIA_PLAYER"
    GRAFANA_PLAYER = "GRAFANA_PLAYER"
    POWERBI_PLAYER = "POWERBI_PLAYER"
    ZABBIX_PLAYER = "ZABBIX_PLAYER"
    UPDOWN_BI_PLAYER = "UPDOWN_BI_PLAYER"

    @property
    def is_dashboard(self) -> bool:
        return self is not ScreenProfile.MEDIA_PLAYER

    @property
    def dashboard_kind(self):
        return PROFILE_DASHBOARD_KIND.get(self)


class ScreenStatus(str, Enum):
    ACTIVE = "active"
    DISABLED = "disabled"


class DashboardKind(str, Enum):
    GRAFANA = "grafana"
    POWERBI = "powerbi"
    ZABBIX = "zabbix"
    UPDOWN_BI = "updown_bi"
    OTHER = "other"


PROFILE_DASHBOARD_KIND = {
    ScreenProfile.GRAFANA_PLAYER: {DashboardKind.GRAFANA, DashboardKind.OTHER},
    ScreenProfile.POWERBI_PLAYER: {DashboardKind.POWERBI, DashboardKind.OTHER},
    ScreenProfile.ZABBIX_PLAYER: {DashboardKind.ZABBIX, DashboardKind.OTHER},
    ScreenProfile.UPDOWN_BI_PLAYER: {DashboardKind.UPDOWN_BI, DashboardKind.OTHER},
}


class DashboardAuthType(str, Enum):
    NONE = "none"                    # URL pública / rede interna
    PUBLIC_EMBED = "public_embed"    # link de incorporação oficial (ex.: Power BI "Publish to web")
    BROWSER_SESSION = "browser_session"  # sessão já autenticada no navegador da TV


class DashboardDisplayMode(str, Enum):
    IFRAME = "iframe"      # player mantém controle (heartbeat, watchdog)
    REDIRECT = "redirect"  # para sites que bloqueiam iframe (X-Frame-Options)


class MediaKind(str, Enum):
    IMAGE = "image"
    VIDEO = "video"


class FitMode(str, Enum):
    CONTAIN = "contain"  # mantém proporção, com bordas
    COVER = "cover"      # preenche a tela, cortando excesso
    FILL = "fill"        # estica para a tela inteira


class Transition(str, Enum):
    NONE = "none"
    FADE = "fade"


class CommandType(str, Enum):
    RELOAD_CONFIG = "reload_config"
    REFRESH_CONTENT = "refresh_content"
    RESTART_PLAYBACK = "restart_playback"
    RELOAD_PAGE = "reload_page"
    CLEAR_CACHE = "clear_cache"


class CommandStatus(str, Enum):
    PENDING = "pending"
    DELIVERED = "delivered"
    DONE = "done"
    FAILED = "failed"
    EXPIRED = "expired"
