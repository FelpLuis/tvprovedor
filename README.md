# UpDown Digital

Plataforma interna da **UpDown Telecom** para administrar remotamente as TVs Android da empresa:
reprodução contínua de imagens e vídeos, exibição de dashboards (Grafana, Power BI, Zabbix e
UpDown BI) e monitoramento de cada tela a partir de um painel web.

```
            Painel administrativo (navegador)          TVs Android (player PWA)
            https://tv.updown.com.br                    https://tv.updown.com.br/player
                         │                                          │
                         └──────────────► Caddy (HTTPS) ◄───────────┘
                                             │
                                  FastAPI 127.0.0.1:8095
                                    │                 │
                              PostgreSQL        storage/ (mídias)
```

Cada TV tem **um perfil fixo**:

| Perfil | Exibe |
|---|---|
| `MEDIA_PLAYER` | Playlist de imagens e vídeos em loop, com cache offline |
| `GRAFANA_PLAYER` | Dashboard Grafana em tela cheia (modo kiosk) |
| `POWERBI_PLAYER` | Relatório Power BI (link de incorporação oficial) |
| `ZABBIX_PLAYER` | Dashboard Zabbix em tela cheia |
| `UPDOWN_BI_PLAYER` | Dashboards próprios (base para a integração IXC Soft) |

## O que já funciona

- **Login** com perfis Administrador / Operador / Visualizador (validados no backend), bloqueio
  por tentativas excessivas, troca de senha que encerra outras sessões.
- **Dashboard** com TVs online/offline/sem ativação/com erro, o que cada TV está exibindo agora e
  espaço em disco. TVs offline são destacadas.
- **Cadastro de TVs e grupos**; playlist padrão por grupo com sobrescrita por TV.
- **Ativação por código** exibido na TV (validade de 15 min, uso único) e token individual por
  dispositivo, com renovação automática e revogação.
- **Heartbeat** a cada 30 s (offline após 90 s), histórico enxuto e **comandos remotos** com
  confirmação de execução e auditoria.
- **Biblioteca de mídias** (JPG, PNG, WEBP, MP4) com validação de extensão **e** conteúdo,
  miniaturas, pastas, busca e bloqueio de exclusão de mídia em uso.
- **Playlists** com ordem por arrastar-e-soltar, duração por imagem, limite opcional por vídeo,
  ajuste à tela, transição, prévia e vínculo com TVs/grupos.
- **Player PWA** para Android TV: tela cheia, imagens e vídeos em loop, download antecipado com
  verificação por SHA-256, reprodução **sem internet** (service worker), troca de playlist sem
  interromper o item atual, watchdog de vídeo travado, indicador discreto de falta de conexão.
- **Players de dashboard** com recarga sem tela preta, watchdog de carregamento e recarga completa
  periódica.
- **Auditoria** de todas as alterações, logins e comandos.
- **Tela por TV**: paisagem/retrato, resolução de exibição, polegadas, margem de segurança e tela
  cheia, tudo definido no gerenciador.
- **Energia e som**: ligar/desligar agora (por TV ou grupo), horário de funcionamento e volume.
  As TVs sempre chamam o servidor (HTTPS), então funcionam em qualquer rede, sem SSH ou VPN.
- **CFTV Intelbras**: mosaico de câmeras ao vivo (RTSP direto da rede local, sem passar pelo
  servidor), cadastro de NVR/DVR por canais, rodízio e status por câmera.
- **App Android TV** com a URL única embutida: abre sozinho ao ligar a TV, em tela cheia, e é
  instalado pela rede com `scripts/instalar_tv.sh`, sem abrir o navegador da TV.

## Desenvolvimento local

Requisitos: Python 3.10+ (o servidor usa 3.10), opcionalmente `ffmpeg` para miniaturas de vídeo.

```bash
python3 -m venv .venv
```

```bash
.venv/bin/pip install -r backend/requirements.txt pytest httpx
```

```bash
cd backend && ../.venv/bin/alembic upgrade head
```

```bash
cd backend && ../.venv/bin/python -m app.cli create-admin --username admin
```

```bash
cd backend && ../.venv/bin/uvicorn app.main:app --reload --port 8095
```

Abra `http://127.0.0.1:8095` (painel) e `http://127.0.0.1:8095/player/` (player). Sem `.env`, o
sistema usa SQLite em `storage/dev.sqlite3`.

Testes (SQLite por padrão; para PostgreSQL defina `UDS_TEST_DATABASE_URL` com um banco descartável):

```bash
.venv/bin/python -m pytest
```

## Estrutura

```
backend/
  app/
    main.py            aplicação FastAPI, cabeçalhos de segurança, arquivos estáticos
    cli.py             create-admin, seed-groups
    core/              config (.env), segurança (senhas, tokens, URLs assinadas), permissões
    api/               rotas: auth, users, groups, screens, media, playlists, dashboards, player, system
    models/            SQLAlchemy (users, screens, screen_groups, screen_activation_codes,
                       screen_heartbeats, screen_commands, media, playlists, dashboards, audit_logs)
    schemas/           validação de entrada/saída (Pydantic)
    services/          regras de negócio: auditoria, mídias, configuração do player
  migrations/          Alembic
  requirements.txt     dependências travadas para Python 3.10
frontend/
  admin/               painel (HTML/CSS/JS, sem build)
  player/              PWA: player.js, media-cache.js, dashboard.js, sw.js
  player/brand/        logotipos e favicon oficiais da UpDown Internet (usados também pelo painel)
  app/                 APK do app Android TV servido em /app/updown-digital.apk
android/               app Android TV (Kotlin): URL única, tela cheia, início automático, quiosque
deploy/                serviço systemd e bloco do Caddy
scripts/               diagnóstico, backup, restauração e atualização
tests/                 testes automatizados (pytest)
docs/                  instalação, arquitetura, API, TVs Android, relatório e plano original
```

## Documentação

- [docs/INSTALACAO.md](docs/INSTALACAO.md): implantação passo a passo no LXC existente (Caddy e
  PostgreSQL já instalados), sem afetar os outros serviços.
- [docs/ARQUITETURA.md](docs/ARQUITETURA.md): componentes, modelo de dados, fluxos e decisões.
- [docs/API.md](docs/API.md): endpoints.
- [docs/TVS_ANDROID.md](docs/TVS_ANDROID.md): como configurar cada TV.
- [docs/RELATORIO.md](docs/RELATORIO.md): o que foi entregue, testes, pendências e riscos.
- [docs/PLANO_DE_ACAO.md](docs/PLANO_DE_ACAO.md): especificação original do projeto.
