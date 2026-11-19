# Configuração das TVs Android

O player é uma aplicação web (PWA) em `https://tv.updown.com.br/player`. Não é preciso instalar
um aplicativo próprio na primeira versão, mas a TV precisa de um navegador moderno que:

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

## Orientação, resolução e tamanho da tela

Cada TV tem a sua configuração de tela em **TVs → Editar → Tela**:

| Campo | O que faz |
|---|---|
| **Orientação** | *Paisagem* (padrão), *Retrato* (TV instalada em pé, conteúdo girado 90°), *Paisagem invertida* (180°) ou *Retrato invertido* (270°). Se o conteúdo ficar de cabeça para baixo, troque *Retrato* por *Retrato invertido*. |
| **Resolução de exibição** | *Automática* usa a resolução que o navegador da TV informa. Uma resolução fixa (HD, Full HD, 4K ou personalizada) monta o conteúdo sempre nesse tamanho e o ajusta à tela: o mesmo layout aparece igual em TVs de polegadas e resoluções diferentes. Resoluções menores deixam textos e dashboards maiores. Em retrato, largura e altura são invertidas automaticamente (1920×1080 vira 1080×1920). |
| **Tamanho (polegadas)** | Registro da TV e sugestão de resolução: até 32" → HD; 40" a 50" → Full HD; 55" ou mais → Full HD (dashboards) ou 4K (conteúdo em 4K). |
| **Margem de segurança** | Reduz a área útil em 0% a 10% de cada lado, para TVs que cortam as bordas (*overscan*). |

As mudanças chegam à TV sozinhas no próximo heartbeat (até 30 s), sem reinstalar nada.

**Antes da ativação**, para o código já aparecer na posição certa numa TV em pé, abra o player com o
parâmetro de orientação: `https://tv.updown.com.br/player/?orientacao=retrato` (também aceita
`retrato-invertido` e `paisagem-invertida`). Depois de ativada, vale a configuração do painel; a
última orientação usada fica guardada na TV.

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
