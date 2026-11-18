# Plano de ação original — UpDown Digital Signage

> Cópia do plano mestre definido na conversa de planejamento (ChatGPT). É a especificação de referência do projeto.
> **Nota:** o produto foi renomeado para **UpDown Digital** (serviço `updown-digital`, diretório `/opt/updown-digital`, banco `updown_digital`). O texto abaixo mantém os nomes originais.
>
> A rastreabilidade do que foi implementado está em [RELATORIO.md](RELATORIO.md).

Plano mestre de desenvolvimento, implantação e operação

- Empresa: UpDown Telecom
- Projeto: Sistema centralizado de Digital Signage
- Domínio: https://tv.updown.com.br
- Ambiente: LXC Proxmox / Ubuntu Server
- Objetivo: Administrar remotamente TVs Android para reprodução de imagens, vídeos e dashboards corporativos.

## 1. VISÃO GERAL DO SISTEMA

Desenvolver uma aplicação web centralizada para controlar todas as TVs e telas utilizadas pela UpDown Telecom.

O sistema terá dois ambientes principais:

- Painel administrativo: utilizado pela equipe autorizada para cadastrar TVs, organizar grupos, enviar mídias, configurar reproduções e acompanhar os dispositivos.
- Player Android: aplicação executada nas TVs, responsável por receber as configurações do servidor e reproduzir o conteúdo determinado para aquele dispositivo.

O sistema deverá permitir que cada TV tenha uma finalidade fixa, definida no cadastro.

Não será necessário misturar diferentes tipos de conteúdo em uma mesma programação. Cada tela terá um perfil de funcionamento próprio.

### 1.1. Tipos de telas

Implementar os seguintes perfis:

| Perfil | Finalidade |
|---|---|
| MEDIA_PLAYER | Reprodução contínua de imagens e vídeos |
| GRAFANA_PLAYER | Exibição de dashboards Grafana |
| POWERBI_PLAYER | Exibição de relatórios Power BI |
| ZABBIX_PLAYER | Exibição de dashboards Zabbix |
| UPDOWN_BI_PLAYER | Exibição do BI próprio da UpDown |

A arquitetura deve permitir adicionar novos tipos de players futuramente.

## 2. ARQUITETURA TECNOLÓGICA

Adotar uma arquitetura simples, modular, segura e preparada para expansão.

### 2.1. Tecnologias recomendadas

- Backend
- Python 3.10 ou superior.
- FastAPI.
- API REST.
- Autenticação com JWT ou sessões seguras.
- SQLAlchemy.
- Alembic para migrações de banco.
- Frontend administrativo
- HTML5.
- CSS3.
- JavaScript.
- Interface responsiva.
- Layout administrativo moderno.
- Compatibilidade com computadores e tablets.
- Player
- PWA (Progressive Web App).
- HTML5 Video.
- Cache local para arquivos de mídia.
- Fullscreen.
- Reconexão automática.
- Comunicação periódica com o servidor.

A arquitetura deve permitir a criação posterior de um aplicativo Android nativo para inicialização automática, modo quiosque e gerenciamento avançado do dispositivo.

- Banco de dados
- PostgreSQL já existente no servidor.
- Criar banco exclusivo para o Digital Signage.
- Criar usuário exclusivo para a aplicação.
- Não utilizar o banco de dados de outros sistemas.
- Armazenamento
- Arquivos de imagens e vídeos armazenados em diretório exclusivo.
- Separar arquivos originais, arquivos processados e miniaturas.
- Preparar a arquitetura para armazenamento compatível com S3/MinIO no futuro.
- Proxy e publicação
- Utilizar o Caddy já instalado.
- Não instalar Nginx.
- Não substituir ou sobrescrever configurações existentes do Caddy.
- Publicar o sistema utilizando o domínio tv.updown.com.br.

## 3. ESTRUTURA DO PROJETO NO SERVIDOR

Diretório principal:

/opt/updown-digital-signage/

Estrutura sugerida:

```text
/opt/updown-digital-signage/
│
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   ├── core/
│   │   │   ├── config.py
│   │   │   ├── security.py
│   │   │   └── permissions.py
│   │   ├── api/
│   │   │   ├── auth.py
│   │   │   ├── users.py
│   │   │   ├── screens.py
│   │   │   ├── groups.py
│   │   │   ├── media.py
│   │   │   ├── playlists.py
│   │   │   ├── dashboards.py
│   │   │   └── heartbeat.py
│   │   ├── models/
│   │   ├── schemas/
│   │   ├── services/
│   │   └── integrations/
│   ├── migrations/
│   └── requirements.txt
│
├── frontend/
│   ├── admin/
│   └── player/
│
├── storage/
│   ├── media/
│   ├── thumbnails/
│   └── temporary/
│
├── scripts/
├── tests/
├── .env
├── .env.example
├── README.md
└── deploy/
    └── updown-digital-signage.service

```
O diretório de armazenamento deve poder ser separado do código, evitando que atualizações da aplicação removam mídias cadastradas.

## 4. FASE 1 — PAINEL ADMINISTRATIVO

Desenvolver inicialmente o painel administrativo.

### 4.1. Login

Criar tela de autenticação com:

- Usuário ou e-mail.
- Senha.
- Recuperação de acesso, quando implementada.
- Controle de sessão.
- Logout.
- Proteção das rotas administrativas.

Criar os seguintes níveis de acesso:

Administrador

- Acesso completo.
- Cadastro de usuários.
- Cadastro e exclusão de TVs.
- Gerenciamento de mídias.
- Configuração dos players.
- Configuração dos grupos.

Operador

- Visualização das TVs.
- Gerenciamento de mídias.
- Alteração de playlists.
- Consulta de status.

Visualizador

- Somente consulta.
- Sem permissão para alterar configurações.

As permissões devem ser validadas no backend, não apenas ocultadas na interface.

### 4.2. Dashboard principal

Criar uma tela inicial com indicadores:

- Total de TVs cadastradas.
- TVs online.
- TVs offline.
- TVs sem ativação.
- Quantidade de grupos.
- Quantidade de mídias cadastradas.

Criar uma listagem visual dos dispositivos com:

- Nome da TV.
- Grupo.
- Perfil de funcionamento.
- Status online/offline.
- Última comunicação.
- Conteúdo ou dashboard configurado.
- Botão para acessar detalhes.

O painel deve destacar visualmente dispositivos offline.

### 4.3. Cadastro de TVs

Permitir cadastrar telas com:

- Nome da TV.
- Identificação única.
- Localização física.
- Setor ou departamento.
- Grupo.
- Perfil de funcionamento.
- Descrição.
- Status.
- Data de cadastro.

Exemplos de nomes:

- TV RECEPÇÃO
- TV NOC
- TV COMERCIAL
- TV FINANCEIRO
- TV SUPORTE
- TV DIRETORIA

Cada TV deverá possuir um identificador único e uma chave própria de autenticação.

### 4.4. Grupos de TVs

Criar gerenciamento de grupos.

Exemplos:

- NOC
- Administrativo
- Comercial
- Recepção
- Financeiro
- Operações

Permitir:

- Criar grupos.
- Editar grupos.
- Excluir grupos vazios.
- Vincular TVs aos grupos.
- Filtrar dispositivos por grupo.
## 5. FASE 2 — ATIVAÇÃO E COMUNICAÇÃO COM AS TVs

Desenvolver o mecanismo de ativação dos dispositivos.

### 5.1. Fluxo de ativação

- A TV acessa o endereço do player.
- O player verifica se já possui uma identificação válida.
- Caso não esteja ativado, apresenta um código de ativação.
- O administrador acessa o painel.
- O administrador informa ou seleciona o código apresentado.
- O administrador escolhe o nome, grupo e perfil da TV.
- O servidor autoriza a ativação.
- O player recebe suas configurações e inicia sua operação.

O código deverá possuir validade e uso único.

### 5.2. Heartbeat

Cada TV deverá enviar comunicação periódica ao servidor.

Informações mínimas:

- ID da TV.
- Data e hora.
- Estado de funcionamento.
- Perfil atual.
- Versão do player.
- Estado da conexão.
- Último conteúdo carregado.
- Informações de erro, quando existirem.

Frequência inicial sugerida: 30 segundos.

O painel deverá considerar uma TV offline após um intervalo configurável sem comunicação, por exemplo, 90 segundos.

O servidor deverá armazenar o histórico de comunicação sem gerar volume desnecessário de registros.

### 5.3. Gerenciamento remoto

Preparar funcionalidades para:

- Atualizar configurações.
- Solicitar atualização de conteúdo.
- Reiniciar a reprodução.
- Identificar falhas.
- Verificar a versão do player.

Comandos remotos devem possuir confirmação de execução e registro de auditoria.

## 6. FASE 3 — PLAYER DE IMAGENS E VÍDEOS

Este é um dos módulos principais do projeto.

Criar player próprio para TVs Android.

### 6.1. Reprodução de imagens

Suportar:

- JPG.
- JPEG.
- PNG.
- WebP.

Configurações:

- Tempo de exibição por imagem.
- Transição entre imagens.
- Ajuste de proporção.
- Preenchimento da tela.
- Modo de exibição sem bordas.
- Reprodução em tela cheia.

Permitir definir a duração padrão das imagens e sobrescrevê-la individualmente.

### 6.2. Reprodução de vídeos

Suportar, preferencialmente:

- MP4.
- H.264.
- AAC.

O player deverá utilizar HTML5 Video.

Funcionalidades:

- Reprodução automática.
- Reprodução contínua.
- Sem controles visíveis.
- Sem barras ou menus.
- Ajuste para tela cheia.
- Próximo vídeo automático.
- Tratamento de falhas.
- Retomada da reprodução quando possível.

Validar os formatos de mídia conforme a capacidade real dos dispositivos Android utilizados.

### 6.3. Playlist

Criar módulo para organização de conteúdos.

Cada playlist terá:

- Nome.
- Descrição.
- Lista de arquivos.
- Ordem de reprodução.
- Duração individual das imagens.
- Status ativo/inativo.

Permitir:

- Adicionar mídias.
- Remover mídias.
- Reordenar conteúdos.
- Visualizar prévia.
- Associar playlist a uma TV.
- Associar playlist a um grupo de TVs.

A reprodução deverá seguir continuamente:

Imagem 1 → Vídeo 1 → Imagem 2 → Vídeo 2 → Início da playlist.

A playlist deverá permanecer funcionando mesmo que a conexão com o servidor seja temporariamente perdida.

### 6.4. Upload de mídias

Criar uma biblioteca de arquivos.

Funcionalidades:

- Upload de imagens.
- Upload de vídeos.
- Visualização de miniaturas.
- Nome do arquivo.
- Tamanho.
- Formato.
- Data de envio.
- Exclusão.
- Pesquisa.
- Filtro por tipo.

Validar tamanho, extensão e conteúdo dos arquivos.

Não permitir execução de arquivos enviados.

### 6.5. Cache local

O player deverá baixar os conteúdos e armazená-los localmente.

Objetivo:

Se a internet ou a conexão com o servidor cair, a TV continuará reproduzindo a última playlist válida.

Implementar:

- Download em segundo plano.
- Verificação de integridade.
- Identificação por hash.
- Atualização incremental.
- Remoção de arquivos não utilizados, respeitando a playlist atual.
- Controle de espaço disponível.

Não interromper uma reprodução válida para baixar uma playlist incompleta.

## 7. FASE 4 — PLAYERS DE DASHBOARDS

Criar um módulo específico para telas que exibem sistemas externos.

Cada TV terá seu perfil definido no cadastro.

### 7.1. Grafana Player

Permitir configurar:

- Nome do dashboard.
- URL.
- Parâmetros de exibição.
- Tempo de atualização.
- Modo fullscreen.

### 7.2. Power BI Player

Permitir cadastrar:

- Nome do relatório.
- URL autorizada.
- Tipo de autenticação.
- Configurações de atualização.

A implementação deverá respeitar os mecanismos oficiais de autenticação e licenciamento do Power BI.

Não armazenar credenciais pessoais em URLs ou no código JavaScript.

### 7.3. Zabbix Player

Permitir configurar:

- URL do dashboard.
- Identificação da tela.
- Atualização periódica.
- Exibição em fullscreen.

Quando necessário, utilizar uma conta específica com privilégios mínimos.

### 7.4. UpDown BI Player

Criar uma estrutura para exibir dashboards próprios desenvolvidos pela UpDown.

Esse módulo deverá ser preparado para integração com a API do IXC Soft.

Cada TV poderá ser associada a um dashboard específico.

## 8. FASE 5 — BI PRÓPRIO UPDOWN

Criar posteriormente um módulo de Business Intelligence.

A fonte de dados será a API do IXC Soft.

Não consultar diretamente bancos de produção do IXC sem autorização e análise de impacto.

Criar uma camada de integração responsável por:

- Consumir a API.
- Validar respostas.
- Normalizar informações.
- Atualizar uma base analítica própria.
- Controlar falhas e tentativas.
- Registrar horário da última sincronização.

Preferir sincronização agendada e consultas incrementais.

### 8.1. Dashboards planejados

- Comercial
- Vendas.
- Novos contratos.
- Instalações pendentes.
- Ativações.
- Metas comerciais.
- Conversão de vendas.
- Operações
- Ordens de serviço.
- Instalações.
- Manutenções.
- Produtividade.
- Serviços pendentes.
- Financeiro
- Faturamento.
- Recebimentos.
- Inadimplência.
- Contas a receber.
- Indicadores financeiros.
- Suporte
- Chamados.
- Atendimentos.
- Tempo médio de resposta.
- Produtividade.
- Chamados pendentes.

Esses indicadores deverão ser confirmados com a disponibilidade dos dados na API do IXC antes de serem desenvolvidos.

## 9. FASE 6 — SEGURANÇA

Implementar desde o início:

- Senhas armazenadas com hash seguro.
- Controle de acesso por função.
- Autenticação individual das TVs.
- Tokens individuais por dispositivo.
- Expiração e renovação de tokens.
- Proteção contra tentativas excessivas de login.
- Validação de arquivos enviados.
- Proteção contra acesso indevido a arquivos.
- HTTPS.
- Logs de auditoria.
- Variáveis sensíveis no arquivo .env.
- Permissões restritas nos diretórios.
- Backup do banco e das mídias.

As TVs não devem possuir acesso administrativo ao sistema.

Credenciais de Grafana, Power BI, Zabbix e IXC não devem ser expostas publicamente no player.

## 10. FASE 7 — IMPLANTAÇÃO NO SERVIDOR

### 10.1. Ambiente existente

O servidor de implantação já possui:

- Ubuntu Server 22.04.5.
- LXC no Proxmox.
- 4 vCPUs.
- 8 GB de RAM.
- Caddy ativo.
- PostgreSQL 16 na porta 5433.
- PostgreSQL 18 na porta 5432.
- Outros serviços em funcionamento.

Há aproximadamente 17 GB disponíveis no disco no diagnóstico inicial.

### 10.2. Regras obrigatórias

O agente de desenvolvimento deverá:

- Inspecionar o ambiente antes de instalar qualquer dependência.
- Não atualizar o sistema operacional.
- Não reiniciar o servidor sem autorização.
- Não instalar outro PostgreSQL.
- Não instalar Nginx.
- Não modificar serviços existentes.
- Não sobrescrever o Caddyfile.
- Não alterar bancos existentes.
- Não utilizar portas já ocupadas.
- Criar backups antes de qualquer alteração de configuração.

A configuração do Caddy ainda precisa ser inspecionada integralmente. A busca inicial não encontrou referência a tv.updown.com.br nos arquivos de configuração.

### 10.3. Banco de dados

Criar banco exclusivo, com usuário exclusivo e privilégios mínimos.

Antes de escolher o cluster PostgreSQL, inspecionar os dois clusters e identificar qual é apropriado para a aplicação.

Não utilizar automaticamente o banco evolution_db nem qualquer banco pertencente a outro sistema.

### 10.4. Serviço da aplicação

Criar serviço systemd:

updown-digital-signage.service

O serviço deverá:

- Iniciar automaticamente.
- Reiniciar em caso de falha.
- Executar com usuário sem privilégios administrativos.
- Utilizar ambiente virtual Python.
- Gravar logs.
- Escutar somente em localhost.

Porta inicialmente proposta para a API:

127.0.0.1:8095

Confirmar disponibilidade antes de utilizar.

### 10.5. Caddy

Configurar o domínio:

https://tv.updown.com.br

Rotas propostas:

- / — painel administrativo.
- /player — player Android.
- /api — API.
- /docs — documentação da API, protegida ou desabilitada em produção conforme política de segurança.

A alteração deverá ser feita de forma incremental, preservando os demais domínios e serviços do servidor.

## 11. FASE 8 — INTERFACE E EXPERIÊNCIA DO USUÁRIO

O painel administrativo deve ter aparência profissional, moderna e intuitiva.

Identidade visual:

- Marca UpDown Telecom.
- Interface escura ou clara com alternância de tema.
- Layout responsivo.
- Navegação lateral.
- Cards de indicadores.
- Tabelas organizadas.
- Ícones consistentes.
- Feedback visual de ações.

Menu sugerido:

- Dashboard
- TVs
- Grupos
- Mídias
- Playlists
- Dashboards BI
- Usuários
- Logs
- Configurações

A interface deve priorizar facilidade de uso e rapidez na administração de muitas TVs.

## 12. FASE 9 — TESTES E HOMOLOGAÇÃO

Criar testes automatizados para backend, autenticação, permissões, APIs e principais fluxos.

Executar homologação prática em pelo menos uma TV Android antes de liberar para os demais dispositivos.

- Testes obrigatórios
- Administração
- Login.
- Logout.
- Cadastro de usuários.
- Controle de permissões.
- Cadastro de TV.
- Cadastro de grupo.
- Associação de TV ao grupo.
- Ativação
- Geração de código.
- Ativação.
- Código expirado.
- Código reutilizado.
- Token inválido.
- Player
- Reprodução de imagem.
- Reprodução de vídeo.
- Playlist contínua.
- Reprodução em fullscreen.
- Recuperação após falha.
- Reinicialização do navegador.
- Reconexão com servidor.
- Cache
- Download de mídias.
- Reprodução offline.
- Atualização de playlist.
- Integridade dos arquivos.
- Dashboards
- Carregamento de URLs.
- Autenticação.
- Atualização.
- Recuperação após falha.
- Servidor
- Reinicialização do serviço.
- Logs.
- Backup.
- Restauração.
- Uso de CPU, RAM e disco.

## 13. FASE 10 — MONITORAMENTO E MANUTENÇÃO

Implementar:

- Monitoramento de disponibilidade das TVs.
- Histórico de comunicação.
- Logs de erros.
- Versão do player.
- Última sincronização.
- Estado do armazenamento local, quando disponível.
- Alertas de falha de reprodução, quando detectáveis.

Preparar integração futura com Zabbix e notificações via WhatsApp.

## 14. CRONOGRAMA DE DESENVOLVIMENTO

Executar o projeto em entregas incrementais.

| Etapa | Entrega |
|---|---|
| 1 | Auditoria e preparação do ambiente |
| 2 | Arquitetura e banco de dados |
| 3 | Login e painel administrativo |
| 4 | Cadastro de TVs e grupos |
| 5 | Ativação e heartbeat |
| 6 | Player Android |
| 7 | Biblioteca de mídias |
| 8 | Playlists e cache offline |
| 9 | Players Grafana, Power BI e Zabbix |
| 10 | BI próprio com IXC |
| 11 | Segurança e auditoria |
| 12 | Homologação e produção |

A primeira versão utilizável deverá contemplar:

- Login.
- Cadastro de TVs.
- Cadastro de grupos.
- Ativação por código.
- Status online/offline.
- Player de imagens e vídeos.
- Upload de mídias.
- Playlists.
- Reprodução contínua.
- Cache offline.

Os módulos de dashboards externos e BI próprio podem ser entregues em versões posteriores.

## 15. VERSIONAMENTO E GITHUB

Todo o projeto deverá ser desenvolvido em repositório GitHub privado.

Nome sugerido:

updown-digital-signage

Regras:

- Commits por funcionalidade.
- Branch main para produção.
- Branch develop para desenvolvimento.
- Não enviar .env ao GitHub.
- Manter .env.example.
- Documentar alterações.
- Criar tags para versões estáveis.
- Manter instruções de instalação e atualização.

O processo de atualização no servidor deverá utilizar Git Pull, com backup e validação antes de reiniciar o serviço.

## 16. ENTREGÁVEIS OBRIGATÓRIOS

Ao final de cada etapa, o agente deverá entregar:

- Código-fonte.
- Estrutura dos arquivos.
- Migrações do banco.
- Testes executados.
- Documentação de instalação.
- Documentação das APIs.
- Arquivo .env.example.
- Instruções de atualização.
- Instruções de backup e restauração.
- Relatório do que foi implementado.
- Pendências conhecidas.
- Evidências de homologação.

Nenhuma etapa deverá ser considerada concluída apenas porque o código foi criado. É necessário testar o funcionamento.

## 17. DIRETRIZ FINAL PARA O AGENTE DE IA

Você será responsável por atuar como arquiteto de software, desenvolvedor backend, desenvolvedor frontend e responsável pela implantação do UpDown Digital Signage.

Siga rigorosamente as etapas deste documento.

Não desenvolva todo o sistema de uma só vez.

Trabalhe de maneira incremental:

- Analise a infraestrutura existente.
- Apresente a arquitetura definitiva.
- Proponha o modelo de dados.
- Apresente o plano técnico da primeira etapa.
- Aguarde autorização para alterações no servidor.
- Desenvolva uma funcionalidade por vez.
- Teste cada funcionalidade.
- Documente tudo.
- Só avance após validar a etapa anterior.

Não faça alterações destrutivas no servidor.

Não substitua serviços existentes.

Não exponha credenciais.

Não invente resultados de testes.

Sempre apresente os comandos que serão executados, explique o impacto e solicite autorização antes de realizar mudanças em serviços, banco de dados, proxy ou firewall.

Objetivo final: entregar uma plataforma interna estável, segura, escalável e centralizada para administrar todas as TVs Android da UpDown Telecom, permitindo controlar remotamente a reprodução de mídias e a exibição dos indicadores operacionais da empresa.
