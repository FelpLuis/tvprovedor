# API

Base: `https://tv.updown.com.br/api`. Em desenvolvimento a documentação interativa fica em `/docs`
(OpenAPI); em produção ela é desabilitada por padrão (`UDS_ENABLE_DOCS`).

**Autenticação administrativa:** cookie `uds_session` (definido em `/auth/login`). Requisições
`POST/PATCH/PUT/DELETE` precisam do cabeçalho `X-Requested-With` (qualquer valor).

**Autenticação das TVs:** `Authorization: Bearer uds_...` (token obtido na ativação).

Perfis mínimos: **V** visualizador, **O** operador, **A** administrador.

## Autenticação

| Método | Rota | Perfil | Descrição |
|---|---|---|---|
| POST | `/auth/login` | — | `{username, password}` (usuário ou e-mail). 429 após tentativas excessivas |
| POST | `/auth/logout` | — | encerra a sessão |
| GET | `/auth/me` | V | usuário atual |
| POST | `/auth/change-password` | V | `{current_password, new_password}`; encerra outras sessões |

## Usuários

| Método | Rota | Perfil | Descrição |
|---|---|---|---|
| GET | `/users` | A | lista |
| POST | `/users` | A | `{username, email?, full_name?, role, password}` |
| PATCH | `/users/{id}` | A | campos parciais; `password` redefine a senha |
| DELETE | `/users/{id}` | A | não permite excluir a si mesmo nem o último administrador |

## TVs

| Método | Rota | Perfil | Descrição |
|---|---|---|---|
| GET | `/screens?group_id&profile&online&activated&q` | V | lista com status calculado |
| POST | `/screens` | A | cadastra TV (sem ativar) |
| GET | `/screens/{id}` | V | detalhes, estado atual, sincronização |
| PATCH | `/screens/{id}` | A | edita (perfil, grupo, playlist/dashboard, status…) |
| DELETE | `/screens/{id}` | A | exclui |
| PUT | `/screens/{id}/playlist` | O | `{playlist_id}` (null = usar a do grupo) |
| POST | `/screens/assign-playlist` | O | `{playlist_id, screen_ids: []}` em lote |
| GET | `/screens/activations/pending` | A | códigos exibidos em TVs, ainda não usados |
| POST | `/screens/activate` | A | `{code, screen_id}` ou `{code, screen: {...nova TV}}` |
| POST | `/screens/{id}/revoke` | A | revoga o token do dispositivo |
| GET | `/screens/{id}/heartbeats?limit` | V | histórico de comunicação |
| GET | `/screens/{id}/commands` | V | últimos comandos |
| POST | `/screens/{id}/commands` | O | `{command}`: `reload_config`, `refresh_content`, `restart_playback`, `reload_page`, `clear_cache`, `identify` |

Campos de tela da TV (em `POST`/`PATCH /screens`):

| Campo | Valores |
|---|---|
| `orientation` | `landscape` (padrão), `portrait` (90°), `landscape_flipped` (180°), `portrait_flipped` (270°) |
| `resolution` | `auto` ou `LARGURAxALTURA` (ex.: `1920x1080`); sempre salva em paisagem |
| `screen_inches` | 7 a 150 (opcional) |
| `safe_margin_percent` | 0 a 10 |

`display_info` (somente leitura) traz o que o player detectou: `viewport`, `screen`, `dpr`,
`device_orientation`, `logical` (palco aplicado), `rotation` e `scale`.

## Grupos

| Método | Rota | Perfil | Descrição |
|---|---|---|---|
| GET | `/groups` | V | lista com quantidade de TVs |
| POST | `/groups` | A | `{name, description?, playlist_id?}` |
| PATCH | `/groups/{id}` | A | edita |
| PUT | `/groups/{id}/playlist` | O | define a playlist padrão do grupo |
| DELETE | `/groups/{id}` | A | somente grupos vazios (409 caso contrário) |

## Mídias

| Método | Rota | Perfil | Descrição |
|---|---|---|---|
| GET | `/media?kind&folder&q&limit&offset` | V | lista |
| GET | `/media/folders` | V | pastas existentes |
| POST | `/media` | O | multipart: `files` (vários) e `folder`; retorna `created`, `errors`, `warnings` |
| GET | `/media/{id}` | V | metadados |
| PATCH | `/media/{id}` | O | `{original_name?, folder?}` |
| DELETE | `/media/{id}` | O | 409 se estiver em alguma playlist |
| GET | `/media/{id}/file` | V | arquivo (pré-visualização no painel) |
| GET | `/media/{id}/thumbnail` | V | miniatura WEBP |

## Playlists

| Método | Rota | Perfil | Descrição |
|---|---|---|---|
| GET | `/playlists` | V | lista com itens, duração do ciclo e TVs |
| POST | `/playlists` | O | `{name, description, is_active, default_image_seconds, fit_mode, transition, items: [{media_id, duration_seconds?}]}` |
| GET | `/playlists/{id}` | V | detalhes |
| PATCH | `/playlists/{id}` | O | parcial; `items` substitui a lista inteira na ordem enviada |
| POST | `/playlists/{id}/duplicate` | O | cópia inativa |
| DELETE | `/playlists/{id}` | O | 409 se vinculada a TVs ou grupos |

`fit_mode`: `contain` · `cover` · `fill`. `transition`: `fade` · `none`.
Para imagens, `duration_seconds` é o tempo de exibição; para vídeos, um limite opcional.

## Dashboards

| Método | Rota | Perfil | Descrição |
|---|---|---|---|
| GET | `/dashboards` | V | lista |
| POST | `/dashboards` | A | `{name, kind, url, refresh_seconds, auth_type, display_mode, options, notes, is_active}` |
| PATCH | `/dashboards/{id}` | A | parcial |
| DELETE | `/dashboards/{id}` | A | 409 se estiver em uso |

`kind`: `grafana` · `powerbi` · `zabbix` · `updown_bi` · `other`.
`options`: `kiosk` (bool ou `"tv"`), `theme`, `query` (parâmetros extras), `load_timeout_seconds`,
`full_reload_hours`, `hide_panes` (Power BI).

## Sistema

| Método | Rota | Perfil | Descrição |
|---|---|---|---|
| GET | `/overview` | V | indicadores e lista de TVs para o dashboard |
| GET | `/audit-logs?action&entity_type&entity_id&limit&offset` | O | auditoria |
| GET | `/system/info` | A | parâmetros e armazenamento |
| GET | `/health` | — | verificação do serviço e do banco |

## Player (TVs)

| Método | Rota | Autenticação | Descrição |
|---|---|---|---|
| POST | `/player/activation-codes` | — | gera código (máx. 10 por IP a cada 10 min) |
| POST | `/player/activation-codes/poll` | segredo de pareamento | `pending` ou `activated` + token (uma vez) |
| GET | `/player/config` | token | configuração com URLs assinadas e `config_hash` |
| POST | `/player/heartbeat` | token | estado e tela detectada (`display`) → `{config_hash, commands, heartbeat_interval, new_token?}` |
| POST | `/player/commands/{id}/ack` | token | `{success, result}` |
| GET | `/player/media/{id}?exp&sig` | URL assinada | download com suporte a `Range` |

Exemplo de configuração de uma TV de mídia:

```json
{
  "schema": 1,
  "screen": {"uid": "…", "identifier": "TV-01", "name": "TV RECEPÇÃO", "profile": "MEDIA_PLAYER", "status": "active"},
  "heartbeat_interval": 30,
  "display": {"orientation": "portrait", "rotation": 90, "width": 1080, "height": 1920,
              "safe_margin_percent": 2, "inches": 55},
  "mode": "media",
  "playlist": {
    "id": 1, "name": "Institucional", "version": 3, "fit_mode": "cover", "transition": "fade",
    "default_image_seconds": 10,
    "items": [
      {"media_id": 4, "kind": "image", "name": "banner.png", "sha256": "…", "size": 51234,
       "mime": "image/png", "duration": 15, "max_duration": null, "url": "/api/player/media/4?exp=…&sig=…"},
      {"media_id": 7, "kind": "video", "name": "institucional.mp4", "sha256": "…", "size": 30481234,
       "mime": "video/mp4", "duration": null, "max_duration": null, "url": "/api/player/media/7?exp=…&sig=…"}
    ]
  },
  "dashboard": null,
  "config_hash": "5f0c…"
}
```

`mode` pode ser `media`, `dashboard`, `idle` (nada programado) ou `disabled`.
