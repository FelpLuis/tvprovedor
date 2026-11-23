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

A instalação é feita uma única vez na própria TV (app Downloader ou pen drive), sem ADB e sem
depender do IP. Depois disso, tudo — programação, tela, energia, volume e até a atualização do
app — é feito pelo gerenciador.

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

### Instalação (uma única vez, sem ADB)

O IP da TV **não importa**: depois de instalado, o app é que se conecta ao servidor pela internet.
IP dinâmico, outra rede ou outra filial funcionam normalmente.

1. **Instalar o APK** na TV, de um destes jeitos:
   - **App Downloader** (gratuito, na Play Store da TV): abra e digite o endereço curto
     `tv.updown.com.br/apk`; ao terminar o download, toque em **Instalar** (permita "fontes
     desconhecidas" para o Downloader, se pedido);
   - **Pen drive**: baixe o APK em **TVs → App Android TV → Baixar APK**, copie para o pen drive e
     abra na TV com um gerenciador de arquivos.
2. **Abrir o app UpDown Digital.** Um assistente pede, pelo controle remoto, as permissões para:
   abrir sozinho ao ligar a TV, ligar/desligar pelo gerenciador (espera), religar no horário exato,
   instalar as próprias atualizações e virar a tela inicial (modo quiosque). Confirme cada uma com
   **OK**. Se alguma for recusada, envie o comando **Configurar app na TV** nos detalhes da TV; o
   painel mostra as permissões pendentes em *Tela detectada*.
3. **Ativar no gerenciador:** a TV mostra o código; use **TVs → Ativar TV**.

### Modo quiosque e queda de energia

Com **Tela cheia (modo quiosque)** ligada no gerenciador (padrão), o app:

- abre sozinho ao ligar a TV e tenta de novo após 15 s, 45 s e 90 s (o launcher e o roteador costumam
  demorar a voltar depois de uma queda de energia);
- a cada minuto, se outra tela estiver na frente (ex.: a tela inicial da TV), traz o player de volta;
- ao detectar que a rede voltou, reconecta na hora; sem esse aviso, tenta a cada 5, 10, 20 e no
  máximo 30 segundos.

Para funcionar em Android 10 ou superior, a permissão **Sobrepor a outros apps** precisa estar
liberada (primeira pergunta do assistente). Se o painel mostrar "⚠ permissões pendentes: abrir
sozinho/quiosque", envie **Configurar app na TV**. Definir o app como **tela inicial** reforça o
quiosque.

Na TV, confira também a opção de energia do próprio aparelho: **Ligar após queda de energia /
Comportamento ao ligar = Ligado (ou Último estado)**. Algumas TVs voltam em espera depois de uma
queda; nesse caso nenhum app consegue abrir até alguém ligar a TV pelo controle.

Manutenção: VOLTAR 5 vezes sai do app por 10 minutos sem que ele volte sozinho.

### Atualização do app (automática)

O app consulta `https://tv.updown.com.br/app/version.json` ao abrir e a cada 6 horas. Havendo
versão nova, baixa o APK, confere o SHA-256 e instala por cima (algumas TVs pedem um **OK** na
tela). Para forçar, envie o comando **Atualizar app**. O resultado aparece nos detalhes da TV.

Para publicar uma versão nova: aumente `versionCode`/`versionName` em `android/app/build.gradle.kts`
e, em `android/`, rode:

```bash
./gradlew publishApk
```

Isso compila, copia o APK para `frontend/app/updown-digital.apk` e gera `frontend/app/version.json`.
Depois do commit e da atualização do servidor, as TVs se atualizam sozinhas. Todas as versões são
assinadas com a chave do projeto (`android/keystore/`), por isso instalam por cima sem desinstalar.

### Atualização sem confirmação (silenciosa)

O Android só instala atualizações sem pedir OK em dois casos:

| Situação | Comportamento |
|---|---|
| **Modo proprietário do dispositivo** (qualquer Android) | Sempre silenciosa. Também fixa o app como tela inicial e libera o comando **Reiniciar TV**. |
| Android 12 ou superior, sem o modo proprietário | A 1ª atualização pede OK (o app foi instalado pelo Downloader/pen drive); as seguintes, instaladas pelo próprio app, são silenciosas. |
| Android 11 ou anterior, sem o modo proprietário | Toda atualização pede OK na TV. |

O painel mostra em **TVs → detalhes → Atualização do app** qual é o caso de cada TV.

**Ativar o modo proprietário** (uma única vez por TV, de um notebook na rede da TV com ADB):

1. Na TV, remova temporariamente as contas (Configurações → Contas e login → remover a conta
   Google). O Android só aceita o modo proprietário em aparelho sem contas.
2. Ative as opções do desenvolvedor e a depuração pela rede (ver "Instalação em lote por ADB").
3. Rode:

   ```bash
   scripts/instalar_tv.sh IP_DA_TV --proprietario
   ```

   ou, manualmente: `adb connect IP_DA_TV:5555` e
   `adb shell dpm set-device-owner br.com.updown.digital/.PowerAdminReceiver`.
4. Depois disso, a conta Google pode ser adicionada de novo, se necessário. O IP da TV pode mudar
   à vontade: o ADB não é mais usado.

Para **desinstalar o app** ou devolver a TV, envie antes o comando **Liberar controle do aparelho**:
sem isso, o Android não deixa desinstalar um app proprietário (só com restauração de fábrica).

### Instalação em lote por ADB (opcional)

Só para preparar muitas TVs de uma vez, num notebook **na mesma rede das TVs**, durante a
instalação (depois o ADB não é mais necessário):

```bash
scripts/instalar_tv.sh 192.168.0.50 192.168.0.51 --quiosque
```

Requer, na TV, as opções do desenvolvedor com "Depuração USB" e "Depuração pela rede". O script
instala o app, libera as mesmas permissões do assistente e desativa protetor de tela/suspensão.

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

## CFTV (câmeras Intelbras)

TVs com o perfil **Câmeras (CFTV)** mostram um mosaico de câmeras ao vivo. O **app UpDown Digital**
reproduz as câmeras por **RTSP direto da rede local**: o vídeo vai da câmera/NVR para a TV, sem passar
pelo servidor nem pela internet. (O navegador não reproduz RTSP; essas TVs precisam do app.)

**Requisito:** a TV precisa alcançar a câmera ou o NVR/DVR na rede (mesma rede ou rotas entre elas).
O gerenciador não precisa acessar as câmeras.

1. Em **Câmeras**, cadastre cada câmera, ou use **Cadastrar NVR/DVR** para criar todos os canais
   de uma vez (IP do NVR, usuário, senha, canais). Depois renomeie os canais (ex.: "Portaria").
   - Endereço gerado (padrão Intelbras/Dahua):
     `rtsp://usuário:senha@IP:554/cam/realmonitor?channel=N&subtype=1`
   - **Fluxo extra (substream)** é o recomendado para mosaicos: leve e estável. Use o
     **principal** para uma câmera em tela cheia.
   - Outras marcas: escolha "Outra marca (RTSP genérico)" e informe o caminho RTSP.
   - Crie no NVR um **usuário só de visualização** para as TVs. A senha fica criptografada no
     servidor, nunca é exibida no painel e só é entregue às TVs ativadas.
2. Em **TVs**, crie ou edite a TV com o perfil **Câmeras (CFTV)**, marque as câmeras (na ordem
   desejada), escolha o **mosaico** (1, 2×2, 3×3, 4×4 ou automático) e, se houver mais câmeras que
   espaços, o **rodízio** de páginas em segundos. Orientação retrato, margem de segurança, energia e
   horário de funcionamento valem também para as TVs de CFTV.
3. Em **TVs → detalhes**, a linha **CFTV** mostra o que a TV informa, ex.: `3/4 ao vivo ·
   Portaria: falha (usuário/senha)`. Câmeras com falha reconectam sozinhas a cada 5 segundos.

Dicas para a qualidade: no NVR, configure o substream em H.264, 704×480 ou 1280×720, 10–15 fps e
512–1024 kbps. Em um mosaico 3×3 com substream, a rede local precisa de ~5–10 Mbps por TV; prefira
cabo. Se a TV mostrar "codec não suportado", mude a câmera de H.265 para H.264.

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

## Dashboards com login (UpDown BI, Grafana, Zabbix…)

No **app UpDown Digital**, os dashboards abrem num navegador próprio em tela cheia (não em iframe):
páginas que bloqueiam incorporação abrem normalmente e endereços internos em `http://` funcionam.

Em **Dashboards BI → Editar → Autenticação**:

- **Login e senha:** informe usuário e senha. O app encontra a tela de login, preenche e entra
  sozinho (funciona também com telas montadas por JavaScript). A sessão fica salva; se expirar, ele
  entra de novo. Se o login ficar em outro endereço, informe a **Página de login**. Se a detecção
  automática não achar os campos, use os seletores avançados (ex.: `#email`, `button[type=submit]`).
- **Autenticação HTTP:** para sistemas que abrem a janela de usuário/senha do navegador.

Use um usuário **só de leitura**, dedicado às TVs. A senha fica criptografada no servidor, não
aparece no painel e só é entregue às TVs ativadas. O estado aparece em **TVs → detalhes →
Dashboard (informado pela TV)**: `carregando`, `entrando…`, `conectado`, `falha no login…` ou `erro…`.

Tela preta com o símbolo do Android significa que a página não pôde ser exibida (bloqueio de
iframe, `http://` ou erro do site). Com o app 1.6.0 os dois primeiros casos deixam de ocorrer; o
painel mostra o motivo dos demais.

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
