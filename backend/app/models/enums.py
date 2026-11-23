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
    CAMERA_PLAYER = "CAMERA_PLAYER"  # CFTV: mosaico de câmeras (requer o app Android)

    @property
    def is_dashboard(self) -> bool:
        return self not in (ScreenProfile.MEDIA_PLAYER, ScreenProfile.CAMERA_PLAYER)

    @property
    def dashboard_kind(self):
        return PROFILE_DASHBOARD_KIND.get(self)


class Orientation(str, Enum):
    LANDSCAPE = "landscape"                  # paisagem (padrão)
    PORTRAIT = "portrait"                    # retrato: conteúdo girado 90° (TV instalada em pé)
    LANDSCAPE_FLIPPED = "landscape_flipped"  # paisagem invertida (180°)
    PORTRAIT_FLIPPED = "portrait_flipped"    # retrato invertido (270°)


ORIENTATION_ROTATION = {
    Orientation.LANDSCAPE: 0,
    Orientation.PORTRAIT: 90,
    Orientation.LANDSCAPE_FLIPPED: 180,
    Orientation.PORTRAIT_FLIPPED: 270,
}


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
    LOGIN_FORM = "login_form"        # o app preenche usuário/senha na tela de login e entra sozinho
    HTTP_BASIC = "http_basic"        # autenticação HTTP (janela de usuário/senha do navegador)


class DashboardDisplayMode(str, Enum):
    IFRAME = "iframe"      # player mantém controle (heartbeat, watchdog)
    REDIRECT = "redirect"  # para sites que bloqueiam iframe (X-Frame-Options)
    PROXY = "proxy"        # dentro do player, via servidor (remove bloqueio de iframe; login automático)


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
    IDENTIFY = "identify"  # padrão de teste com nome, resolução e orientação
    UPDATE_APP = "update_app"  # app Android: buscar e instalar a versão do servidor
    APP_SETUP = "app_setup"    # app Android: refazer o assistente de permissões na TV
    REBOOT = "reboot"          # reiniciar o aparelho (modo proprietário do dispositivo)
    RELEASE_OWNER = "release_owner"  # desfazer o modo proprietário (permite desinstalar o app)


class CommandStatus(str, Enum):
    PENDING = "pending"
    DELIVERED = "delivered"
    DONE = "done"
    FAILED = "failed"
    EXPIRED = "expired"
