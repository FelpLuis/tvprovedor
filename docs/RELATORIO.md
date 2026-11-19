# Relatório de entrega: versão 0.1.0

Escopo: a "primeira versão utilizável" do [plano de ação](PLANO_DE_ACAO.md) (seção 14), mais os
players de dashboards (Fase 4) e a base de segurança, auditoria e monitoramento.

**Não foi feita nenhuma alteração no servidor de produção.** A implantação está descrita passo a
passo em [INSTALACAO.md](INSTALACAO.md) e deve ser executada com autorização, etapa por etapa.

## Rastreabilidade com o plano

| Plano | Situação | Onde |
|---|---|---|
| 1.1 Perfis de TV fixos (5 tipos, extensível) | ✅ | `models/enums.py`, `services/screens.py` |
| 4.1 Login, sessão, logout, rotas protegidas | ✅ | `api/auth.py`, `core/permissions.py` |
| 4.1 Níveis Administrador/Operador/Visualizador validados no backend | ✅ | `require_*` em todas as rotas |
| 4.1 Recuperação de acesso | ⚠️ parcial | redefinição pelo administrador; sem e-mail (não há SMTP definido) |
| 4.2 Dashboard com indicadores e destaque de offline | ✅ | `pages/overview.js`, `/api/overview` |
| 4.3 Cadastro de TVs (identificação única, local, setor, grupo, perfil, descrição, status) | ✅ | `api/screens.py` |
| 4.3 Chave própria de autenticação por TV | ✅ | token individual, só o hash é gravado |
| 4.4 Grupos (criar, editar, excluir vazios, vincular, filtrar) | ✅ | `api/groups.py` |
| 5.1 Ativação por código com validade e uso único | ✅ | `api/player.py`, `api/screens.py` |
| 5.2 Heartbeat 30 s, offline após 90 s, histórico sem volume desnecessário | ✅ | `api/player.py::heartbeat` |
| 5.3 Comandos remotos com confirmação e auditoria | ✅ | `screen_commands` + ack |
| 6.1 Imagens: duração padrão/individual, transição, proporção, tela cheia | ✅ | `player.js`, `playlists.js` |
| 6.2 Vídeos: autoplay, sem controles, próximo automático, tratamento de falha | ✅ | `player.js` (watchdog de travamento, fallback sem som) |
| 6.3 Playlists: ordem, reordenação, prévia, vínculo a TV e grupo, loop | ✅ | `api/playlists.py`, `pages/playlists.js` |
| 6.4 Biblioteca: upload, miniaturas, busca, filtro, validação de conteúdo | ✅ | `services/media.py` |
| 6.5 Cache local: hash, incremental, limpeza, espaço, troca sem interromper | ✅ | `media-cache.js`, `sw.js` |
| 7.1–7.3 Grafana, Power BI, Zabbix | ✅ | `dashboard.js`, `api/dashboards.py` |
| 7.4 UpDown BI Player | ✅ estrutura | perfil e tipo de dashboard prontos; dashboards próprios na Fase 5 |
| 8 BI próprio com IXC Soft | ⏳ próxima fase | ver "Pendências" |
| 9 Segurança | ✅ | ver [ARQUITETURA.md](ARQUITETURA.md#segurança) |
| 10 Implantação (systemd, Caddy, banco exclusivo, porta 8095) | 📄 documentado | `deploy/`, `docs/INSTALACAO.md` |
| 11 Interface (escura/clara, responsiva, menu lateral, cards) | ✅ | `frontend/admin` |
| 12 Testes automatizados | ✅ | `tests/` (45 testes) |
| 13 Monitoramento (disponibilidade, histórico, erros, versão, armazenamento) | ✅ | painel → TVs → detalhes |
| 15 Versionamento (.env fora do Git, .env.example) | ✅ | `.gitignore`, `.env.example` |
| Extra: orientação retrato/paisagem, resolução por TV, polegadas, margem de segurança, identificação de tela | ✅ | `player.js::applyDisplay`, migração `0002` |

## Testes executados

### Automatizados (pytest): 45 testes, todos passando

Executados em **SQLite** e em **PostgreSQL 16** (`UDS_TEST_DATABASE_URL`), com Python 3.10
(mesma versão do servidor):

- **Administração:** login por usuário e e-mail, logout, bloqueio após 5 falhas (429), auditoria
  de falhas, exigência do cabeçalho anti-CSRF, troca de senha invalidando a sessão antiga, senha
  fraca recusada, CRUD de usuários, proteção do último administrador, mudança de perfil
  invalidando sessão.
- **Permissões:** visualizador somente leitura; operador gerencia mídias, playlists e programação,
  mas não TVs, grupos, dashboards ou usuários; token de TV não acessa rotas administrativas.
- **TVs e grupos:** cadastro, identificação duplicada, filtros, grupo com TVs não pode ser
  excluído, compatibilidade perfil × dashboard.
- **Ativação:** fluxo completo, código em minúsculas, segredo de pareamento errado, código
  reutilizado, código expirado, código inexistente, token inválido, TV desativada (403),
  revogação, limite de geração de códigos.
- **Heartbeat:** atualização de estado, detecção de offline após 90 s, histórico sem repetição,
  registro de erro, comandos entregues uma única vez com confirmação, renovação de token em duas
  fases.
- **Mídias e playlists:** validação de extensão e de conteúdo (`.sh`, `.svg`, PNG disfarçado de
  MP4…), duplicados, limite de tamanho, upload de MP4 real com duração/resolução, download por
  URL assinada com `Range` (206), assinatura adulterada/expirada, playlist herdada do grupo, hash
  de configuração mudando com a reordenação, bloqueio de exclusão em uso, playlist inativa,
  duplicação.
- **Dashboards:** URL final com kiosk/tema no Grafana, kiosk no Zabbix, intervalo por TV,
  recusa de `javascript:`, `password=` e `usuário:senha@` na URL.
- **Configuração:** produção exige chave forte e PostgreSQL; cookies `Secure` e `/docs`
  desabilitado por padrão em produção; cabeçalhos de segurança.

### Migrações

`alembic upgrade head` → `downgrade base` → `upgrade head` no PostgreSQL 16 e `alembic check`
sem diferenças entre os modelos e a migração.

### Ponta a ponta em navegador (Chromium/Playwright, servidor local)

- Painel: login, upload de 2 imagens e 1 vídeo pela interface, criação de playlist e adição de
  mídias, cadastro de dashboard Grafana, cadastro de TV com perfil Grafana, todas as páginas nos
  temas escuro e claro e em largura de celular, sem erros de JavaScript.
- Player:
  1. exibiu o código de ativação; após ativação pelo painel, começou a reproduzir em segundos;
  2. alternou vídeo → imagem → imagem → vídeo continuamente, vídeo com som;
  3. service worker ativo e as 3 mídias no Cache Storage, servidas por `/player/cache/<sha256>`;
  4. painel mostrou a TV online, "Reproduzindo · video1.mp4", versão 1.0.0, sincronizada;
  5. comando remoto "Reiniciar reprodução" executado e confirmado (`done`);
  6. playlist alterada no painel → TV baixou e aplicou a nova sequência sozinha;
  7. **TV reiniciada sem rede:** voltou a reproduzir do cache, com o indicador de sem conexão;
  8. TV de dashboard carregou o iframe; após revogação voltou sozinha para a tela de ativação.

### Disposição da tela (Chromium, TV simulada de 1280×720)

- `?orientacao=retrato` antes da ativação: código exibido em pé (palco 720×1280 girado 90°).
- TV em retrato com resolução Full HD e margem de 2%: palco 1080×1920, rotação 90°, escala 0,64
  (cabe inteiro em 691×1229 px úteis); playlist reproduzindo em pé.
- Comando *Identificar tela* exibido e confirmado; o painel recebeu a tela detectada.
- Alteração para paisagem 1280×720 no painel aplicada sozinha pela TV (escala 0,96 com a margem).
- Formulário do painel com resolução personalizada 1080×1920 salva como 1920×1080 + retrato.
- Migração `0002` aplicada em PostgreSQL com TVs existentes (todas ficaram em paisagem/automática)
  e revertida com sucesso.

### Ainda não testado

- **TV Android real** (navegador, autoplay, codecs, inicialização no boot): homologação prevista
  no plano antes de liberar para as demais TVs.
- Instalação no servidor UPT-UBUNTU01 (Caddy real, cluster PostgreSQL escolhido).
- Grafana, Power BI e Zabbix reais (política de iframe e autenticação de cada um).
- Restauração completa de backup em servidor (o `backup.sh` foi testado localmente).

## Decisões técnicas

- **Python 3.10 com dependências travadas** (`backend/requirements.txt`): as versões mais novas de
  FastAPI, SQLAlchemy 2.1 e Pillow 13 exigem 3.11+, e o servidor não deve ter o Python atualizado.
- **Heartbeat em vez de WebSocket** na primeira versão (ver arquitetura). Mudanças chegam às TVs
  em até ~30 s.
- **Um único processo** uvicorn: os limitadores de login e a manutenção periódica ficam em
  memória. Para dezenas de TVs um worker é suficiente.
- **A aplicação serve painel, player e API:** o Caddy precisa de um único bloco `reverse_proxy`.
- **Downloads das TVs por URL assinada**, para que o `<video>` e o service worker funcionem sem
  expor o token do dispositivo.
- **Configuração identificada por hash** do conteúdo efetivo, em vez de contadores de versão.
- **Nome do produto:** "UpDown Digital" (antes "UpDown Digital Signage", como no plano). Os
  identificadores técnicos seguem o nome novo: serviço `updown-digital`, diretório
  `/opt/updown-digital`, usuário de sistema `updown-digital` e banco `updown_digital`.
- **Identidade visual:** logotipo, favicon e cores oficiais da UpDown Internet (site
  updowntelecom.com.br): azul-marinho `#140058`/`#110170`, ciano `#00CEFF`, roxo `#9B00FF` e
  amarelo `#FBBC04`. O logotipo em alta resolução (`frontend/player/brand/logo-updown.png`) foi
  recortado do favicon oficial; a versão escura (`logo-updown-dark.png`) é usada no tema claro.
  Todas as combinações de texto/fundo atendem ao contraste WCAG AA (≥ 4,5:1). Substitua pelos
  arquivos originais do manual de marca, se houver, mantendo os mesmos nomes.
- **Repositório:** o plano sugeria `updown-digital-signage`; o código está em `FelpLuis/tvprovedor`.

## Pendências e próximos passos

1. **Homologação em uma TV Android real** e escolha do navegador de quiosque.
2. **Implantação** seguindo `docs/INSTALACAO.md` (com autorização a cada etapa), incluindo a
   escolha do cluster PostgreSQL (5432 ou 5433).
3. **Fase 5: UpDown BI / IXC Soft:** levantar os endpoints e campos disponíveis na API do IXC,
   criar o cliente somente leitura, a sincronização agendada, o banco analítico e os dashboards
   Comercial, Operações, Financeiro e Suporte.
4. **Agendamento de programação** (horários, dias, campanhas com início e fim): citado nas
   conversas iniciais como evolução posterior; o modelo atual de playlist por TV/grupo já permite
   acrescentar uma tabela de agendamentos.
5. Recuperação de senha por e-mail (requer SMTP), alertas de TV offline via Zabbix/WhatsApp.
6. Armazenamento S3/MinIO (o servidor já tem MinIO em `127.0.0.1:9100`), se o disco ficar curto.

## Riscos conhecidos

- **Disco:** ~17 GB livres no servidor. Vídeos de 1080p ocupam ~100–500 MB cada. O painel mostra o
  uso; considere um volume dedicado para `storage/`.
- **Memória/swap:** a swap do servidor estava quase cheia no diagnóstico. O serviço é leve, mas
  vale monitorar.
- **Compatibilidade das TVs:** navegadores de Android TV variam bastante (autoplay, codecs,
  service worker). Por isso a homologação em uma TV real vem antes da liberação geral.
- **Power BI:** a exibição sem login depende do licenciamento e da política de incorporação da
  organização ("Publicar na Web" torna o relatório público).
- **Dashboards em iframe:** sistemas com `X-Frame-Options` exigem o modo de abertura direta, no
  qual o player perde o heartbeat até a TV voltar para `/player`.
