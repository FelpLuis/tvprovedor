# Configuração das TVs Android

## Como a TV se comunica com o gerenciador

**É sempre a TV que chama o servidor**, nunca o contrário. O player (no app ou no navegador) faz
requisições HTTPS para `https://tv.updown.com.br`:

- a cada 30 s (heartbeat): informa o estado e recebe comandos, mudanças de programação, tela,
  energia e volume;
- em espera, o app consulta a cada 1 min se deve religar.

Por isso as TVs podem estar em **qualquer rede** (outra rede da empresa, outra filial, 4G): basta
terem acesso à internet e conseguirem abrir `tv.updown.com.br` na porta 443. O servidor não precisa
de SSH, VPN, IP das TVs nem porta aberta para elas, e um firewall/NAT na rede das TVs não atrapalha.

A única etapa que precisa estar **na mesma rede da TV** é a instalação do app pela rede
(`scripts/instalar_tv.sh`, via ADB), feita uma única vez de um notebook conectado à rede das TVs.
Sem notebook, instale por pen drive. Depois de instalado, tudo é feito pelo gerenciador.

## App UpDown Digital (recomendado)

O app Android TV (`br.com.updown.digital`) abre sozinho **sempre a mesma URL** do player
(`https://tv.updown.com.br/player/`), em tela cheia, sem barra de endereço e sem precisar abrir o
navegador ou digitar nada na TV. Ele:

- aparece na tela inicial da Android TV e **abre automaticamente ao ligar a TV**;
- em **modo quiosque**, vira a própria tela inicial (a TV sempre volta para a programação);
- mantém a tela ligada, reproduz vídeos com som sem precisar de clique;
- aplica a **tela cheia definida no gerenciador** para cada TV;
- recarrega sozinho se a página falhar, se o navegador interno travar ou se o player ficar 5 minutos
  sem dar sinal de vida;
- informa ao painel o modelo do aparelho, a versão do Android e a do app (TVs → detalhes → Tela detectada);
- ignora a tecla VOLTAR (para sair na manutenção: VOLTAR 5 vezes seguidas).

Requisitos: Android 5.0 ou superior (TVs, TV boxes e monitores Android).

### Instalação pela rede, sem mexer na TV (recomendada)

1. Na TV: **Configurações → Preferências do dispositivo → Sobre** e clique 7 vezes em **Build**
   para liberar as opções do desenvolvedor. Em **Opções do desenvolvedor**, ative **Depuração USB**
   e **Depuração pela rede/ADB pela rede**. Anote o IP da TV (Configurações → Rede).
2. Em um computador com `adb` **conectado à mesma rede das TVs** (um notebook, por exemplo):

   ```bash
   scripts/instalar_tv.sh 192.168.0.50 --quiosque
   ```

   Vários IPs de uma vez também funcionam. Na primeira conexão a TV pede para autorizar a
   depuração: confirme com **Sempre permitir**.
3. O script baixa o app de `https://tv.updown.com.br/app/updown-digital.apk`, instala, libera a
   abertura automática ao ligar, desativa protetor de tela e suspensão, ativa o modo quiosque
   (`--quiosque`) e abre o player. A TV mostra o código de ativação.
4. No painel: **TVs → Ativar TV**, informe o código e defina orientação, resolução e tela cheia.

Opções do script: `--apk arquivo.apk` (usar um APK local), `--servidor https://...` (outro
servidor, ex.: homologação) e `--sem-ajustes` (não mexer em protetor de tela/suspensão).

### Instalação por pen drive

Baixe o APK em **TVs → App Android TV → Baixar APK**, copie para um pen drive e abra-o na TV com
um gerenciador de arquivos (permita "fontes desconhecidas"). Abra o app uma vez. Para abrir
sozinho ao ligar em Android 10 ou superior, use a instalação pela rede (que libera essa permissão)
ou defina o app como tela inicial.

### Atualização do app

Instale o APK novo por cima (`scripts/instalar_tv.sh IP` de novo ou pen drive). Todas as versões
são assinadas com a mesma chave do projeto (`android/keystore/`), então não é preciso desinstalar.

Para compilar o app (Android SDK e JDK 17+), em `android/`:

```bash
./gradlew assembleRelease
```

O APK gerado fica em `android/app/build/outputs/apk/release/app-release.apk`; copie-o para
`frontend/app/updown-digital.apk` para o servidor oferecê-lo para download.

## Navegador (alternativa)

O player também funciona direto no navegador, em `https://tv.updown.com.br/player`. A TV precisa
de um navegador moderno que:

- rode em **HTTPS** (o cache offline e o service worker só funcionam em conexão segura);
- permita reprodução automática de vídeo;
- abra sozinho ao ligar a TV e mantenha a tela acesa.

## Navegador recomendado para homologação

Em Android TV, o Chrome normalmente não está disponível. Para a primeira TV, sugerimos testar um
**navegador de quiosque** (por exemplo, *Fully Kiosk Browser*), que costuma oferecer:

- iniciar automaticamente ao ligar a TV;
- modo quiosque em tela cheia, sem barra de endereço;
- manter a tela ligada e desativar o protetor de tela;
- recarregar a página ao reconectar a rede;
- permitir reprodução automática de vídeos com som.

Confirme cada um desses itens no modelo de TV real durante a homologação. Alternativas: um
navegador baseado em Chromium para TV, ou futuramente um app Android próprio (WebView em modo
quiosque) usando a mesma API.

Configurações sugeridas no navegador:

| Opção | Valor |
|---|---|
| URL inicial | `https://tv.updown.com.br/player` |
| Iniciar no boot | ativado |
| Tela cheia / quiosque | ativado |
| Manter tela ligada | ativado |
| Reprodução automática de mídia | ativado |
| Recarregar ao reconectar | ativado |
| Limpar cache ao iniciar | **desativado** (o cache é o que permite tocar offline) |

Na própria TV:

- **Protetor de tela/suspensão:** desativar ou "nunca".
- **Atualizações automáticas de apps:** preferir janela noturna.
- **Endereço IP:** de preferência fixo (ou reserva DHCP) para facilitar o suporte.

## Primeira ativação

1. Abra o player. A TV exibe um código como `ABC 123` (válido por 15 minutos; renova sozinho).
2. No painel, vá em **TVs → Ativar TV**. O código aparece em "Códigos aguardando"; clique nele
   ou digite-o.
3. Escolha **Cadastrar nova TV** (nome, grupo, perfil, playlist ou dashboard) ou **Vincular a uma
   TV já cadastrada** (útil para trocar o aparelho mantendo a configuração).
4. Em até 5 segundos a TV recebe o token e começa a baixar e reproduzir o conteúdo.

## Ligar, desligar e volume

Em **TVs → detalhes → Energia e som**:

- **Ligar agora / Desligar agora**: aplicado em até 1 minuto. Vale até a próxima mudança do
  horário de funcionamento (ou até **Voltar ao automático**, se a TV não tiver horário).
- **Horário de funcionamento**: faixas por dia da semana (ex.: seg–sex 07:00–19:00, sáb
  08:00–12:00). Fora das faixas a TV fica em espera. Faixas como 18:00 → 02:00 atravessam a
  meia-noite. Fuso: `America/Sao_Paulo` (`UDS_TIMEZONE`).
- **Volume**: define o volume do aparelho (0–100%).
- Em **Grupos**, os botões **Ligar/Desligar** aplicam a todas as TVs do grupo.

O que "desligar" faz em cada caso:

| Situação | Resultado |
|---|---|
| App com controle de energia liberado (script de instalação) | Aparelho em **espera** (tela apagada). Em TV box ligada por HDMI com **CEC** ativo, a TV também entra em espera. |
| App sem o controle liberado, ou navegador | **Tela preta**, sem reproduzir (a tela continua acesa). |

Religar: o app guarda o próximo horário de ligar e **acorda sozinho** nesse horário, mesmo se a
rede cair durante a espera; "Ligar agora" chega pela consulta de 1 minuto.

Limites: uma TV **desligada da tomada** (ou desligada totalmente pelo botão, sem modo de espera)
não pode ser ligada por software, porque fica sem rede. Algumas TVs desligam o Wi-Fi em espera;
nesse caso "Ligar agora" só funciona com cabo de rede, mas o horário programado continua
funcionando. Confira em **Energia e som → Controle de energia** o que cada TV suporta.

## Orientação, resolução e tamanho da tela

Cada TV tem a sua configuração de tela em **TVs → Editar → Tela**:

| Campo | O que faz |
|---|---|
| **Orientação** | *Paisagem* (padrão), *Retrato* (TV instalada em pé, conteúdo girado 90°), *Paisagem invertida* (180°) ou *Retrato invertido* (270°). Se o conteúdo ficar de cabeça para baixo, troque *Retrato* por *Retrato invertido*. |
| **Resolução de exibição** | *Automática* usa a resolução que o navegador da TV informa. Uma resolução fixa (HD, Full HD, 4K ou personalizada) monta o conteúdo sempre nesse tamanho e o ajusta à tela: o mesmo layout aparece igual em TVs de polegadas e resoluções diferentes. Resoluções menores deixam textos e dashboards maiores. Em retrato, largura e altura são invertidas automaticamente (1920×1080 vira 1080×1920). |
| **Tamanho (polegadas)** | Registro da TV e sugestão de resolução: até 32" → HD; 40" a 50" → Full HD; 55" ou mais → Full HD (dashboards) ou 4K (conteúdo em 4K). |
| **Margem de segurança** | Reduz a área útil em 0% a 10% de cada lado, para TVs que cortam as bordas (*overscan*). |
| **Tela cheia (modo quiosque)** | Ligada por padrão. No app UpDown Digital é aplicada automaticamente; no navegador depende de pressionar OK uma vez. |

As mudanças chegam à TV sozinhas no próximo heartbeat (até 30 s), sem reinstalar nada.

**Antes da ativação** a TV usa a última orientação aplicada nela (numa TV nova, paisagem). Todas
as TVs usam **a mesma URL**; orientação, resolução e tela cheia vêm sempre do gerenciador e são
aplicadas assim que a TV é ativada.

**Identificar tela:** em TVs → detalhes → Comandos remotos, o comando *Identificar tela* mostra
na TV, por 30 segundos, um padrão de teste com o nome da TV, a orientação, a resolução do palco,
a resolução real do navegador (pixels CSS e físicos), as polegadas e a margem. Os **cantos
amarelos** devem aparecer inteiros; se estiverem cortados, aumente a margem de segurança. O painel
também mostra a resolução detectada em TVs → detalhes → *Tela detectada*.

Para as mídias de TVs em retrato, prepare imagens e vídeos em pé (1080×1920). Conteúdo em
paisagem é exibido conforme o *ajuste à tela* da playlist (com bordas, cortado ou esticado).
Girar vídeos por software exige mais da TV; em aparelhos muito modestos, prefira configurar a
rotação no próprio Android TV, se disponível, e deixar *Paisagem* no painel.

## Teclas do controle

| Tecla | Ação |
|---|---|
| OK / Enter | entra em tela cheia (quando o navegador não abre em tela cheia) |
| `i` / Info / Menu | mostra/oculta informações técnicas (TV, versão, estado, último heartbeat, erro) |

Um pequeno **ponto vermelho** no canto inferior direito indica que a TV está sem comunicação com o
servidor. A reprodução continua com o conteúdo em cache.

## Preparação das mídias

- **Imagens:** 1920×1080 (16:9), JPG/PNG/WEBP. Até 25 MB por padrão.
- **Vídeos:** MP4 com vídeo **H.264** e áudio **AAC**, 1080p, até 1 GB por padrão. Outros codecs
  podem não tocar em todas as TVs; o painel avisa quando o vídeo enviado não é H.264/AAC
  (requer `ffmpeg` no servidor).

Conversão sugerida com ffmpeg (no computador de quem produz o conteúdo):

```bash
ffmpeg -i entrada.mov -c:v libx264 -profile:v high -level 4.1 -pix_fmt yuv420p -vf "scale=1920:-2" -c:a aac -b:a 128k -movflags +faststart saida.mp4
```

## Dashboards (Grafana, Power BI, Zabbix)

- O dashboard precisa permitir exibição em `iframe`. No Grafana, isso pode exigir
  `allow_embedding = true`; o Zabbix e outros sistemas podem enviar `X-Frame-Options` bloqueando.
  Se não for possível liberar, cadastre o dashboard com o modo **Abrir página diretamente**.
- Para páginas que exigem login, prefira links de incorporação oficiais ou um usuário somente
  leitura dedicado. Com **Sessão já autenticada no navegador da TV**, faça o login uma vez no
  navegador da TV. Nunca coloque usuário/senha na URL (o painel recusa).
- O player recarrega o dashboard no intervalo configurado, tenta de novo quando a página não
  carrega e recarrega o player por completo a cada 12 h.

## Solução de problemas

| Sintoma | Verificação |
|---|---|
| TV mostra código o tempo todo | O código expira em 15 min e é renovado; confira se foi digitado no painel dentro do prazo |
| TV "Offline" no painel | Rede da TV; abra as informações (`i`) e veja o último heartbeat |
| "Sincronização pendente" | A TV ainda está baixando os arquivos ou aguardando o fim do item atual; veja o progresso em TVs → detalhes → Armazenamento local |
| Vídeo pulado | Formato não suportado pela TV ou arquivo corrompido; o erro aparece em TVs → detalhes e no histórico |
| Dashboard em branco | O site bloqueia iframe ou exige login: veja a seção acima |
| Conteúdo antigo após revogar/reativar | Envie o comando **Limpar cache local** |
| Bordas cortadas | Comando **Identificar tela** e ajuste a margem de segurança |
| Imagem de cabeça para baixo em retrato | Troque *Retrato* por *Retrato invertido* |
| Textos pequenos demais | Use uma resolução de exibição menor (ex.: HD 1280×720) |

Comandos remotos (TVs → detalhes → Comandos remotos) são entregues no próximo heartbeat, em até
30 segundos, e expiram em 10 minutos se a TV estiver desligada.
