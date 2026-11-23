# Arquitetura

## Componentes

| Camada | Tecnologia | Observações |
|---|---|---|
| Painel administrativo | HTML, CSS e JavaScript (módulos ES, sem build) | `frontend/admin`, servido em `/` |
| Player das TVs | PWA em JavaScript compatível com navegadores antigos | `frontend/player`, servido em `/player/` |
| API | Python 3.10 + FastAPI + SQLAlchemy 2 + Alembic | `backend/app`, rotas em `/api` |
| Banco | PostgreSQL (cluster existente, banco exclusivo) | SQLite apenas em desenvolvimento e testes |
| Arquivos | Disco local em `storage/` (fora do código) | `media/`, `thumbnails/`, `temporary/` |
| Proxy/HTTPS | Caddy existente | reverse proxy para `127.0.0.1:8095` |
| Processo | systemd, 1 worker uvicorn, usuário sem privilégios | |

A própria aplicação FastAPI serve o painel, o player e a API. Assim o Caddy precisa de um único
`reverse_proxy` e o deploy é um único serviço.

## Modelo de dados

```
users ──┐ (autor)                    playlists ──< playlist_items >── media
        │                               ▲  ▲
audit_logs                              │  └──────────── screen_groups.playlist_id (padrão do grupo)
                                        │                       ▲
dashboards ◄── screens.dashboard_id     └── screens.playlist_id │
                screens ────────────────────────────────────────┘ screens.group_id
                  ├──< screen_heartbeats   (histórico resumido)
                  ├──< screen_commands     (comandos remotos)
                  └──< screen_activation_codes
```

| Tabela | Conteúdo principal |
|---|---|
| `users` | usuário, e-mail, hash Argon2 da senha, perfil (`admin`/`operator`/`viewer`), `session_version` |
| `screens` | identificação única (`TV-01`), nome, local, setor, grupo, **perfil fixo**, playlist ou dashboard, orientação, resolução, polegadas, margem de segurança, hash do token do dispositivo, último estado e tela detectada |
| `screen_groups` | grupos por setor e playlist padrão |
| `screen_activation_codes` | código de 6 caracteres, hash do segredo de pareamento, validade, uso |
| `screen_heartbeats` | histórico: volta de offline, mudança de estado, erro novo e um registro periódico a cada 10 min |
| `screen_commands` | comando, status (`pending` → `delivered` → `done`/`failed`/`expired`), resultado |
| `media` | nome, tipo, MIME, tamanho, SHA-256, resolução, duração, miniatura, pasta |
| `playlists` / `playlist_items` | ordem, duração por imagem, limite por vídeo, ajuste à tela, transição, versão |
| `dashboards` | plataforma, URL, intervalo de atualização, autenticação, modo de exibição, opções |
| `audit_logs` | autor (usuário, TV ou sistema), ação, entidade, detalhes, IP |

Os perfis de TV e as plataformas de dashboard são `str` validados por enums em
`app/models/enums.py`: adicionar um novo tipo de player não exige migração.

## Comunicação com as TVs

Modelo *pull*: as TVs iniciam todas as conexões (HTTPS para `tv.updown.com.br`), o servidor nunca
se conecta a elas. Funciona com TVs em outras redes, atrás de NAT/firewall, sem SSH nem VPN.
Comandos, programação, tela, energia e volume chegam na resposta do heartbeat (30 s); em espera,
o app Android consulta `GET /api/player/power` a cada minuto.

## Proxy de dashboards

`/dash/{id}/…` (`api/dash_proxy.py`) repassa as requisições para a origem cadastrada no dashboard
(httpx), remove `X-Frame-Options`/CSP, reescreve `Location`, cookies (`Path=/dash/{id}/`, sem
`Domain`) e links absolutos em HTML/CSS, e injeta um service worker (escopo `/dash/{id}/`) que
redireciona as requisições montadas em JavaScript. Requisições absolutas que escapem (404 com
`Referer` de uma página do proxy) são redirecionadas para `/dash/{id}/…`. Acesso por cookie
assinado (24 h) emitido em `POST /api/player/dashboards/{id}/session` para a TV vinculada, ou pela
sessão do painel. Como a página fica na mesma origem do player, o login automático é feito pelo
próprio player dentro do iframe.

## CFTV

Câmeras/canais (`cameras`) guardam a senha criptografada (Fernet, chave derivada de
`UDS_SECRET_KEY`; trocar a chave exige recadastrar as senhas). Para TVs `CAMERA_PLAYER`, a
configuração leva as URLs RTSP; o app Android (Media3/ExoPlayer, RTP sobre TCP, buffer curto)
desenha o mosaico nativo sobre o WebView, gira conforme a orientação, reconecta câmeras com falha e
informa o status no heartbeat. O vídeo vai da câmera direto para a TV na rede local.

## Energia

`services/power.py` calcula o estado desejado de cada TV: horário de funcionamento (faixas por dia
da semana no fuso `UDS_TIMEZONE`, inclusive atravessando a meia-noite) e comando manual, que vale
enquanto o horário estiver no mesmo estado de quando foi dado. O heartbeat devolve `power`
(`state`, `reason`, `next_change`, `next_on_ms`). No app, a espera usa o administrador do
dispositivo (`lockNow`, apenas a política *force-lock*); um alarme local acorda a TV no próximo
horário de ligar mesmo sem rede.

## Fluxo de ativação

```
TV (player)                          Servidor                         Administrador
    │ POST /api/player/activation-codes │                                    │
    │──────────────────────────────────►│ gera código + segredo de pareamento│
    │◄── {code, pairing_secret} ────────│ (só o hash do segredo é gravado)   │
    │  exibe "ABC 123"                  │                                    │
    │                                   │◄── POST /api/screens/activate ─────│ código + dados da TV
    │ POST .../poll (code + segredo)    │   marca código como usado          │
    │──────────────────────────────────►│ gera token do dispositivo          │
    │◄── {token} (uma única vez) ───────│ (grava só o hash SHA-256)          │
```

- O código vale 15 minutos e só pode ser usado uma vez. Um código vazado não serve sem o segredo
  de pareamento, que só o player conhece.
- O token vale 90 dias. Faltando menos de 30, o heartbeat devolve um novo token; o antigo continua
  válido até o novo ser usado pela primeira vez (renovação em duas fases, sem risco de a TV ficar
  sem acesso se a resposta se perder).
- **Revogar** apaga o hash: a TV volta sozinha para a tela de ativação.
- Tokens de TV não dão acesso a nenhuma rota administrativa.

## Sincronização da TV

1. A TV envia heartbeat a cada 30 s com estado, item em exibição, versão, erro, uso de
   armazenamento e o **hash da configuração aplicada**.
2. O servidor responde com o hash da configuração atual e os comandos pendentes.
3. Se o hash mudou, o player busca `/api/player/config`. Para TVs de mídia:
   - remove do cache o que não pertence nem à playlist atual nem à nova;
   - baixa em sequência os arquivos que faltam e confere tamanho e SHA-256 (até 150 MB por
     arquivo; acima disso só o tamanho, para não estourar a memória da TV);
   - só troca a playlist **depois** que todos os arquivos estiverem no cache e **ao final do item
     em exibição**. Se algum download falhar, continua a playlist anterior e reporta o erro.
4. A última configuração válida fica no `localStorage`; o service worker guarda o player e as
   mídias. Assim a TV religa e volta a reproduzir mesmo sem internet.

O hash é calculado sobre a configuração efetiva (playlist do grupo ou da TV, itens, durações,
dashboard, status), então qualquer alteração relevante no painel chega às TVs afetadas sem
precisar de contadores de versão espalhados pelo código.

**Decisão:** em vez de WebSocket, a primeira versão usa o heartbeat (até 30 s de atraso). Isso
funciona melhor com quedas de conexão e navegadores de TV, e não exige manter conexões abertas
no Caddy. Um canal WebSocket pode ser somado depois para comandos instantâneos.

## Disposição da tela

Todo o conteúdo do player fica num "palco lógico" (`#display`). A partir da configuração da TV
(`orientation`, `resolution`, `safe_margin_percent`) e da área real do navegador, o player calcula:

- **rotação** 0/90/180/270°; em 90/270 o palco fica em pé e a largura útil passa a ser a altura física;
- **tamanho do palco**: a resolução fixa configurada (em retrato, invertida) ou, em *automática*,
  a área disponível;
- **escala** `min(área útil ÷ palco)`, para caber inteiro na tela descontando a margem de segurança.

As unidades de tela do CSS do player usam variáveis (`--vmin`, `--vw`) definidas sobre o palco, não
sobre a janela; assim textos e o código de ativação ficam proporcionais também em retrato. O
recálculo acontece ao aplicar uma configuração e em `resize`/`orientationchange`. O player envia no
heartbeat a resolução detectada (`display_info`) e o comando `identify` exibe um padrão de teste
para conferir orientação e *overscan* no local.

## Mídias

- Download para as TVs por **URL assinada** (HMAC, validade de 24 h) em `/api/player/media/{id}`;
  o token do dispositivo nunca aparece em URLs.
- No player, o service worker atende `/player/cache/<sha256>` direto do Cache Storage, com suporte
  a `Range` (necessário para `<video>`), sem carregar o vídeo inteiro na memória.
- Upload: extensão permitida **e** assinatura binária correspondente, imagem decodificada pelo
  Pillow (proteção contra "bombas" de descompressão), vídeo inspecionado pelo `ffprobe` quando
  disponível (aviso se não for H.264/AAC). Arquivos gravados com nomes aleatórios, permissão
  `0640` e nunca executáveis. Duplicados (mesmo SHA-256) são recusados.

## Dashboards

- Exibidos em `iframe` de tela cheia. A atualização carrega um iframe novo por trás e só troca
  quando ele termina de carregar.
- Watchdog: se a página não carregar no tempo limite, tenta de novo com espera progressiva
  (10 s até 5 min). Sem conexão, mantém a última página em vez de recarregar uma página de erro.
- Recarga completa do player a cada 12 h (configurável) para evitar vazamento de memória.
- Modo `redirect` para sistemas que bloqueiam iframe (`X-Frame-Options`); nesse modo o player
  deixa de controlar a TV até ela voltar para `/player`.
- Grafana e Zabbix recebem `kiosk` automaticamente; Power BI recebe os parâmetros de embed que
  ocultam os painéis de filtro e navegação.
- O cadastro recusa URLs com `password=`, `api_key=`, `access_token=` etc. e URLs com
  `usuário:senha@`.

## Segurança

- Senhas com Argon2; bloqueio após 5 falhas por IP e por usuário (5 min); tempo de resposta
  constante para usuário inexistente.
- Sessão em cookie `HttpOnly`, `SameSite=Strict` e `Secure` em produção; mudanças de senha, perfil
  ou desativação invalidam sessões abertas (`session_version`).
- Requisições que alteram dados exigem o cabeçalho `X-Requested-With` (defesa adicional contra CSRF).
- Permissões verificadas no backend em cada rota (`require_viewer`/`operator`/`admin`).
- CSP restritiva (`script-src 'self'`), `X-Frame-Options: DENY` no painel, `nosniff`,
  `Cache-Control: no-store` na API.
- O IP do cliente só é lido de `X-Forwarded-For` quando a conexão vem do Caddy local.
- A aplicação se recusa a iniciar em produção com `UDS_SECRET_KEY` fraca ou com SQLite.
- `/docs` desabilitado em produção por padrão.

## Permissões

| Ação | Visualizador | Operador | Administrador |
|---|:-:|:-:|:-:|
| Ver dashboard, TVs, grupos, mídias, playlists, dashboards | ✓ | ✓ | ✓ |
| Enviar/editar/excluir mídias, criar/editar playlists | | ✓ | ✓ |
| Definir playlist de TV e de grupo, enviar comandos remotos | | ✓ | ✓ |
| Ver logs de auditoria | | ✓ | ✓ |
| Cadastrar/editar/excluir/ativar/revogar TVs | | | ✓ |
| Grupos, dashboards BI, usuários, informações do sistema | | | ✓ |

## Pontos de extensão

- **UpDown BI / IXC Soft (Fase 5):** criar `app/integrations/ixc.py` (cliente da API, somente
  leitura), uma rotina agendada que grava indicadores agregados em um banco analítico separado e
  páginas de dashboard próprias servidas pela aplicação (ex.: `/bi/comercial`). Essas páginas são
  cadastradas como dashboards do tipo `updown_bi` com URL interna (`/bi/...`).
- **Armazenamento S3/MinIO:** concentrado em `app/services/media.py` (`save_upload`,
  `media_path`, `delete_files`).
- **App Android nativo:** pode reaproveitar a mesma API do player (`/api/player/*`).
