# miepp — Mídia Interna e Externa Peg Pese

Gerenciamento e monitoramento remoto de mídia indoor digital: cadastro de telas,
biblioteca de mídia, playlists, agendamento e comandos remotos.

A suite vive dentro do módulo `global` (mesma decisão do GCPP e do GTPP), com
tabelas `miepp_*` no MySQL `global`. Não é um serviço separado nem um container
novo — sobe junto do `api-gipp-enterprises`.

**Prefixo em produção:** `https://vagas.gpprh.com.br/api/v1/global/miepp/`

---

## Três zonas de autenticação

Esta é a parte que mais importa entender antes de mexer no módulo. São três
mecanismos disjuntos, e nenhum se converte no outro.

| Zona | Quem entra | Como | Middleware |
|---|---|---|---|
| Painel (`/miepp/...`) | usuário do painel | cookie de sessão do global | `auth.middleware` + `canAny` (permissões `MIEPP_*`) |
| Dispositivo (`/miepp/device/...`) | o player Android | `Authorization: Bearer <token>` | `authenticateDevice` |
| Entrega de mídia (`/miepp/media/:uuid/file`) | o player, baixando o binário | assinatura HMAC na query (`?t=`) | nenhum — a assinatura é a autorização |

**O `auth.middleware` do global não foi tocado.** O `CLAUDE.md` proíbe
acrescentar Bearer àquele caminho, e com razão: ele é a sessão por cookie dos
usuários, com refresh e troca de senha. O player não é usuário — não renova
nada, e o token dele vale até ser revogado. `req.device` nunca vira `req.user`,
então um token de player não alcança nenhuma rota administrativa.

### Não existe `POST /auth/login` nem cadastro de usuário no miepp

O requisito original previa login próprio e uma tabela `miepp_users` com papel
(`admin`/`editor`/`viewer`). Nada disso existe.

Quem autentica é a sessão por cookie do módulo global, e **quem autoriza é o
sistema de permissões central** (`_permissions` → `_roles` →
`_role_permissions` → `_user_roles`), avaliado por `canAny`, igual a EPP,
BPPP, GAPP e GTPP.

| Requisito | Permissão | Alcance |
|---|---|---|
| viewer | `MIEPP_USE` | leitura de tudo |
| editor | `MIEPP_EDIT` | CRUD de locais, players, grupos, mídia, playlists, agendamentos, comandos |
| admin | `MIEPP_MANAGE` | desativar player, gerar/revogar token, auditoria |

`SYSTEM_OWNER` mantém o bypass total do `permission.middleware`.

**Por que `miepp_users` foi removida (15/09/2026):** era um segundo cadastro de
pessoas convivendo com `_user`, o que colocava a concessão de acesso em dois
lugares que discordam. Aconteceu de fato: 13 pessoas com a aplicação 5 liberada
em `_application_access` viam o menu e tomavam 403 em tudo, porque a tabela do
módulo estava vazia. Migração em `GIPP-SQL/miepp-centraliza-acesso.sql`.

A autoria (`uploaded_by`, `created_by`, `audit_log.user_id`) passou a ser FK
para `_user(id)`.

**Visibilidade no menu** continua sendo `_application_access` com a aplicação 5
(`MIEPP - Web`) — é o que alimenta `application_ids` no payload de login. São
eixos distintos de propósito, como já acontece no resto do sistema: a aplicação
diz o que aparece, a permissão diz o que pode. Ao liberar alguém, conceda os
dois.

---

## A regra central: qual playlist toca agora

`GET /miepp/device/playlist` é o coração do módulo. A decisão está isolada e é
pura — `domain/miepp/schedule/schedule-resolver.rules.js` — e roda assim:

1. Só agendamentos `active = 1`.
2. O alvo precisa alcançar o player: `all`, ou `player` com o id dele, ou
   `group` com algum grupo em que ele esteja.
3. Vigência: `start_date <= hoje <= end_date` (NULL = sem limite).
4. Janela: `start_time <= agora <= end_time` (NULL = sem limite).
5. Bit do dia atual ligado em `days_of_week` (bit0 = domingo … bit6 = sábado).
6. Vence a maior `priority`; empate vai para o `updated_at` mais recente;
   empate total, para o maior `id`.
7. Nada casou → playlist de fallback (`MIEPP_FALLBACK_PLAYLIST_ID`), ou
   `keep_cache: true` com lista vazia, e o player mantém o que já tem.

O critério de desempate por `id` não está no requisito original. Foi
acrescentado porque o `updated_at` do MySQL tem resolução de 1 segundo: dois
agendamentos salvos no mesmo segundo empatariam de verdade, e a tela alternaria
entre dois conteúdos de forma imprevisível a cada chamada.

### Limitação conhecida: janela que cruza a meia-noite

O critério 4 é literal, como especificado. Um agendamento 22:00→02:00 **nunca
casa**: às 23:00 falha o `end_time`, à 01:00 falha o `start_time`. Para cobrir
madrugada, cadastre dois agendamentos (22:00→23:59:59 e 00:00→02:00). O
`MieppScheduleUseCases` recusa `start_time > end_time` no cadastro com uma
mensagem dizendo isso, em vez de aceitar um agendamento que nunca tocaria.

Inverter o teste quando `end_time < start_time` mudaria o significado de dados
já cadastrados — é decisão do requerente, não efeito colateral de implementação.

### Validade do conteúdo e mídia de reserva

O passo 7 resolve *qual playlist* toca. Isto é outra pergunta: **por quanto
tempo o arquivo que está na tela continua valendo?**

A distinção existe porque grade de produto não é conteúdo como os outros — é
**preço anunciado**, e preço exposto obriga a empresa no caixa. A regra "tela
preta é pior que conteúdo de ontem" continua valendo para institucional e
campanha; para preço ela precisa de exceção.

Três campos na resposta de `/device/playlist` dão conta disso:

| Campo | Quando aparece | O que diz |
|---|---|---|
| `media.origin` | sempre | `generated` (grade renderizada) ou `upload` (enviada pelo painel) |
| `items[].max_age_seconds` | só em item com prazo | segundos que **ainda restam** de validade |
| `fallback.media` | sempre (pode ser `null`) | conteúdo perene que substitui o vencido |

**`origin` é derivado, não coluna.** Sai do LEFT JOIN com `miepp_product_grids`,
que é 1:1 com a mídia. Guardar em `miepp_media` criaria uma segunda verdade para
discordar do join. O player usa para duas coisas: saber o que vence e manter
uma política de retenção de cache assimétrica — vale guardar versões anteriores
das geradas (elas oscilam e se repetem byte a byte), não das enviadas.

**`max_age_seconds` é o que resta, não o prazo nominal.** O relógio de
referência é `miepp_product_grids.last_checked_at` — a última consulta ao
Consinco —, não o momento do download: uma grade de prazo 20 min baixada 18 min
depois da última checagem vale 2 min, não 20. O cálculo é o
`ITEM_MAX_AGE_EXPRESSION` em `miepp-playlist.queries`, e ele precisa continuar
concordando com o `GRID_STALE_EXPRESSION` de `miepp-product-grid.queries`: um
decide o que o painel marca como vencido, o outro o que a tela pode exibir.

Sai como **duração** e não como instante de propósito. O MySQL roda em `-03` e
o `resolved_at` da resposta nasce em UTC no Node (`toISOString()`); duração não
tem fuso para interpretar errado, e `NOW()` e `last_checked_at` vêm do mesmo
relógio.

Ausente significa "não vence" — mídia comum omite o campo em vez de mandar
`null`, para o app não ter que tratar dois casos que dizem a mesma coisa.

**A regra que liga as duas pontas:** um item vencido só sai da lista quando
sobra algo para pôr no lugar — outro item, ou a reserva. Numa playlist só de
grades, todas vencidas, sem `MIEPP_FALLBACK_MEDIA_ID` configurado, a lista volta
como está e o item segue com `max_age_seconds: 0`. É o menos ruim: derrubar sem
substituto apagaria a parede, e o zero passa a decisão para o app com a
informação de que o conteúdo venceu.

Quando a lista fica vazia **e** há reserva, ela entra como item comum
(`item_id: 0`, sintético, não existe em `miepp_playlist_items`). Isso protege as
telas com APK antiga: elas não conhecem o campo `fallback` e apagariam a parede
ao receber `items: []`.

A reserva é resolvida em **toda** resposta, inclusive nas de `keep_cache: true`.
Uma reserva que só chegasse junto com a expiração faltaria exatamente quando
serve para alguma coisa — ela precisa estar em cache antes de a rede cair.

⚠️ **Por que isto não existia antes.** O DDL da grade e o cabeçalho de
`miepp-grid-render.use-cases` sempre disseram que o desfecho `failed` deixa a
grade "envelhecer até `stale` e sumir". Não sumia: o `GRID_STALE_EXPRESSION` só
existia nas queries do painel, e `SQL_GET_PLAYLIST_ITEMS` não fazia JOIN com
`miepp_product_grids`. Com o Consinco fora, a grade seguia na parede
indefinidamente — inclusive em tela **online**. Consertar exigia ter o que
exibir no lugar, e é por isso que a reserva veio junto e não depois.

---

## Pareamento de um player

1. Admin cadastra o player: `POST /miepp/players`.
2. Admin gera o código: `POST /miepp/players/:id/pairing-code` → devolve
   `code` e `expires_at` (10 min por padrão).
3. O app na tela troca o código pelo token: `POST /miepp/device/pair` com
   `{ "pairing_code": "..." }`.
4. A resposta traz o token **em texto puro, uma única vez**. O banco guarda só
   o SHA-256 em `miepp_device_tokens.token_hash` — nem o painel nem o suporte
   recuperam o token depois. Perdeu, pareia de novo.

Parear revoga os tokens anteriores do mesmo player: na troca de equipamento, a
caixa antiga para de baixar conteúdo assim que a nova entra no ar.

### Por que o código é assinado e não guardado

O backend interno roda em cluster com 2 instâncias (`pm2-runtime`). Um código
guardado em memória só seria reconhecido pelo processo que o emitiu — metade
das tentativas falharia de forma intermitente e praticamente indiagnosticável
no balcão. Guardar no banco exigiria tabela fora do schema fechado.

**O custo:** um código emitido não pode ser cancelado antes de expirar. O TTL
curto é a única janela de risco. Se algum dia for preciso revogação imediata ou
um código de 6 dígitos digitável no controle remoto, aí sim é necessária uma
tabela `miepp_pairing_codes` — é a extensão natural.

---

## Entrega de mídia

O player não tem sessão, então a rota que serve o binário não pode depender do
cookie. Cada URL sai assinada por HMAC e com validade curta, emitida no momento
em que `GET /miepp/device/playlist` monta a resposta:

```
GET /miepp/media/<uuid>/file?t=<expira>.<assinatura>&p=<playerId>
```

A assinatura cobre `uuid + playerId + expiração`. Uma URL vazada só serve para o
dispositivo a que foi emitida e vence sozinha. Qualquer falha responde 404
genérico — um 401 distinto confirmaria que o uuid existe, e os uuids aparecem no
JSON de playlist de qualquer tela pareada.

O binário mora no sistema `_files` do global (o mesmo do chat e do GTPP), atrás
de `MieppMediaStorageService`. Esse serviço é o único ponto do módulo que
conhece o `_files`: trocar o armazenamento um dia mexe só nele.

Excluir uma mídia **não** apaga o binário: o `_files` deduplica por SHA-256 e o
mesmo arquivo pode estar referenciado por outro módulo.

---

## Estado de uma tela: `online` / `offline`

`miepp_players.status` é **derivado de `last_seen_at` na leitura**, não lido da
coluna:

```
last_seen_at IS NULL                        → unknown
last_seen_at >= agora - MIEPP_OFFLINE_AFTER_MINUTES → online
senão                                        → offline
```

A coluna só é escrita pelo heartbeat, e sempre com `'online'`. Se a leitura
confiasse nela, uma tela que caísse (energia, rede, app travado) apareceria
como `online` para sempre — o oposto do que um módulo de monitoramento remoto
precisa mostrar. A coluna continua sendo atualizada e vai na resposta como
`last_known_status`, útil para diagnóstico.

A alternativa seria um job varrendo `miepp_players`; foi descartada por
acrescentar processo, e no cluster de 2 instâncias exigir trava para não rodar
duplicado.

**O que isso NÃO faz:** gravar o evento `offline` em
`miepp_player_status_log`. O log registra o que a tela reporta, e uma tela
caída não reporta nada. Um histórico de quedas ("desde quando essa tela está
fora?") exige o job varredor — é a extensão natural daqui, e a única coisa que
o painel ainda não consegue responder sozinho.

---

## Ciclo de vida do status da mídia

`image`/`html` nascem `ready`. `video` que entra na fila de transcodificação do
`_files` nasce `processing`, e quem o move dali é o
`workers/video-transcoder.js`, que agora atualiza `miepp_media` lado a lado com
os anexos do GTPP (o mesmo arquivo pode ser os dois — o storage deduplica por
hash):

| Momento no worker | `miepp_media.status` |
|---|---|
| job reservado | `processing` |
| conversão concluída | `ready` |
| falha final (após as tentativas) | `error` |

Só `ready` (e `weburl`, que não tem binário) chega à playlist do player — ver
`isPlayable` no shaper. Sem esse gancho, um vídeo transcodificado ficaria preso
em `processing` para sempre e nunca apareceria na tela, sem erro em lugar
nenhum.

**Decisão a confirmar:** na falha final o miepp marca `error`, enquanto o GTPP
marca `failed` e continua servindo o arquivo original. A diferença é
proposital — o codec que motivou a conversão é justamente o que a caixa Android
tende a não decodificar, e o resultado seria um quadro preto na loja. Com
`error`, a mídia sai da playlist e aparece marcada no painel. Se preferir
"tenta tocar assim mesmo", é uma linha em `failJob`.

---

## Grade de produtos

Um mosaico de produtos sobre um fundo enviado, exibido nas telas de loja **com
preço**. Tabelas `miepp_product_grids`, `_grid_items` e `_grid_renders`
(`GIPP-SQL/miepp-grade-produtos.sql`, aplicado em 16/09/2026).

### A separação em três partes

| Parte | Onde mora |
|---|---|
| Curadoria — quais PLUs, ordem, loja, fundo | `miepp_product_grids` + `_grid_items` |
| Dado do produto — descrição, EAN, preço, promoção | **Consinco, sempre** |
| Apresentação — a imagem montada | `_files`, registrada como mídia `image` |

**Não existe coluna de preço na curadoria, e é o ponto do desenho.** O preço vem
de `FPRECOEMBPRODUTO`/`FPRECOEMBPROMOC` no instante do render. O caso de uso
**recusa com 400** um item que traga `description`, `price`, `barcode` e
companhia, em vez de ignorá-los: um front que os envia acredita que estão sendo
gravados, e um dia alguém leria o preço daqui.

Por que não há invalidação por evento: o preço no Consinco é função com
vigência — promoção entra e sai na virada da data sem UPDATE em linha nenhuma.
Não há o que escutar. A única invalidação possível é por tempo.

### A grade é uma mídia `image`, e o player não sabe que ela existe

`miepp_product_grids.media_id` é 1:1 com `miepp_media`. A grade entra em
playlist e agendamento como qualquer imagem, e herda download assinado e cache
por checksum sem uma linha nova no app Android.

**Não acrescente `product_grid` ao ENUM `miepp_media.type`:** quebraria o
`isPlayable` do shaper e exigiria release do app em todas as telas antes de
qualquer grade ir ao ar.

A mídia nasce `processing`, sem binário. Como só `ready` chega à playlist, uma
grade sem render é descartada em silêncio — o comportamento certo para algo que
mostra preço.

#### O painel, ao contrário, precisa saber

O disfarce que serve ao app atrapalha quem edita: na biblioteca de mídia, uma
grade e um JPG enviado à mão eram a mesma linha — mesmo `type`, mesmos campos —
e quem clicasse numa grade caía no formulário de mídia, que edita título e
duração e não tem como mexer nos produtos.

`GET /miepp/media` e `GET /miepp/media/:id` (e as respostas de `POST` e `PUT`,
que releem a linha) levam dois campos a mais, pelo mesmo LEFT JOIN 1:1 que a
playlist do device já fazia:

| Campo | Valor | Para quê |
|---|---|---|
| `origin` | `upload` ou `generated` | rotular a linha; é o **mesmo** vocabulário de `media.origin` da playlist do device |
| `grid_id` | número, ou `null` no upload | levar ao editor certo: `/miepp/product-grids/:grid_id` |

E `?origin=upload|generated` filtra a listagem. O filtro é do **banco** e não do
front porque a lista é paginada: filtrar a página recebida devolveria uma página
de 50 com 6 itens, e a contagem (`SQL_COUNT_MEDIA`) precisa do mesmo `WHERE`,
senão a paginação conta o que a lista não mostra. Valor fora do vocabulário vira
"sem filtro" (`normalizeOrigin`) — `?origin=grade` devolvendo só os uploads seria
uma resposta plausível e errada.

`GET /miepp/media/:uuid/file` ficou **sem** o join de propósito: ali a resposta é
o binário, ninguém lê `origin`, e a consulta roda a cada download de cada tela.

### `stale` é derivado na leitura

`GRID_STALE_EXPRESSION`: sem consulta ao Consinco por `stale_after_minutes`
(default 20), a grade conta como vencida; `last_checked_at IS NULL` também.
Mesmo raciocínio do `status` do player — quem marcaria a grade como vencida
seria o renderizador, e é justamente quando ele morre que ela vence.

`last_checked_at` muito mais recente que `last_rendered_at` é **normal e bom**:
o job está consultando e os preços não mudaram.

### O renderizador

Worker próprio: `src/workers/miepp-grid-renderer.js`, app PM2
`miepp-grid-renderer` com **`instances: 1`** no mesmo container do backend (a
imagem já tem o Chromium do Puppeteer). Não pode viver dentro do app da API:
aquele roda em cluster com 2 instâncias, e o laço rodaria duas vezes — duas
consultas ao Consinco, dois Chromium e duas gravações concorrentes na mesma
grade. Mesmo motivo do transcodificador. Ainda pega um `GET_LOCK` no MySQL,
caso alguém mude o `instances`.

Cada ciclo (5 min por padrão, `MIEPP_GRID_RENDER_INTERVAL_MS`):

1. lista as grades `active = 1`, mais antiga primeiro;
2. resolve os PLUs no Consinco — **só os ativos para venda**
   (`ACTIVE_FOR_SALE_SQL`, reusado do BPPP);
3. calcula o `data_hash` do conteúdo resolvido;
4. decide, renderiza se preciso, grava em `_files` e publica.

**O Chromium abre e fecha a cada ciclo.** O `receipt.generator` mantém um vivo e
o `docker-compose.yml` documenta o resultado: ~800 MB de processos órfãos que o
`max_memory_restart` não pega. Repetir isso num job de cadência derrubaria o
container.

### Os quatro desfechos de um ciclo

| Desfecho | `last_checked_at` | Mídia | Tela |
|---|---|---|---|
| `rendered` | agora | `ready` | mostra a imagem nova |
| `unchanged` | agora | intacta | continua com a mesma |
| `off_air` | agora | `error` | some da playlist |
| `failed` | **não muda** | intacta | envelhece até `stale` e some |

A diferença entre `off_air` e `failed` é o que protege a parede. Em `off_air`
consultamos e sabemos que não dá para exibir. Em `failed` **não conseguimos
consultar** — carimbar a hora ali diria que os preços foram conferidos quando não
foram, e a grade seguiria no ar com o preço de ontem enquanto o Oracle estivesse
fora.

**Produto sem cadastro ativo tira a grade INTEIRA do ar** (decisão do
requerente, 16/09/2026). Renderizar com buraco mostraria vitrine furada;
renderizar sem o item mudaria o layout que alguém aprovou. Grade sem itens idem.

### Estilo do card

`miepp_product_grids.style` é uma coluna JSON, nula por padrão. Guarda cor e
opacidade do card, fonte/tamanho/cor da descrição e do preço, e a posição do
texto dentro do card. O vocabulário é fechado e mora em
`domain/miepp/product-grid/grid-style.rules.js`.

**Nulo significa "usa o padrão", e o padrão reproduz a imagem anterior à
feature, pixel a pixel.** É o que permite acrescentar a coluna sem mudar a cara
de nenhuma grade que já está no ar.

Três decisões que não são estéticas:

- **Cor é regex de hexadecimal, fonte e tamanho são chave de mapa.** Esses
  valores são interpolados direto no CSS e **não existe escape para valor de
  CSS** — a descrição do produto passa por `escapeHtml`, uma cor não passa por
  nada. Um valor torto viraria regra que o Chromium descarta em silêncio, e a
  grade sairia com a aparência antiga sem nenhum erro no log. Por isso a API
  recusa com 400 em vez de cair no padrão.
- **Tamanho é degrau (`PP`…`XXG`), não pixel.** O degrau multiplica o tamanho
  que o template calcula pela densidade da grade. Um valor absoluto ficaria bom
  num 1x6 e transbordaria num 6x6 — e transbordo em preço é ilegível, não feio.
  `M` vale exatamente 1.
- **Fonte só pode ser o que a imagem tem.** `fonts-liberation` e
  `fonts-dejavu-core`, instaladas no `Dockerfile.internal`. O render não carrega
  nada da rede: fonte vinda da internet faria a imagem sair diferente quando a
  rede oscila, e o `data_hash` deixaria de descrever o que foi para a parede.
  Acrescentar família em `FONT_FAMILIES` sem acrescentar o pacote no Dockerfile
  derruba o texto num fallback qualquer.

**O estilo entra no `data_hash`** (`computeDataHash`). Precisa entrar: sem isso,
mudar a cor no painel não dispara render nenhum — sem imagem nova, sem erro, sem
uma linha no log explicando. Vale para qualquer campo novo que chegue ao
template: entra no template e na digital no mesmo commit.

DDL: `GIPP-SQL/miepp-grade-estilo.sql`. No primeiro ciclo após o deploy toda
grade ativa renderiza uma vez (a fórmula da digital mudou); como a imagem sai
idêntica, o `FileService` deduplica por SHA-256, o `checksum` não muda e nenhuma
tela rebaixa nada.

### A trilha guarda o render inteiro, não só os produtos

`miepp_product_grid_renders.snapshot` é `{ items, layout, style }`.

Até 18/09/2026 guardava só o array de itens, e isso custou uma investigação
inteira: dois renders da mesma grade tinham snapshot idêntico e checksums
diferentes, e não havia como saber por quê olhando a trilha. O que havia mudado
era o número de colunas — que a trilha não registrava. Trilha que não explica a
diferença entre dois renders não está cumprindo o papel de trilha.

Registros anteriores a essa data são convertidos na leitura (`shapeSnapshot`, no
adapter) para a mesma forma, com `layout` e `style` nulos: a resposta HTTP tem um
formato só, e o painel não precisa adivinhar a idade do registro.

### Ainda falta

1. Excluir a grade vencida da playlist do device (`GRID_STALE_EXPRESSION` no
   JOIN de `SQL_GET_PLAYLIST_ITEMS`). Hoje o `stale` só aparece no painel — o
   que tira grade da tela é o status `error` da mídia.
2. **Confirmar com o app Android que ele rebaixa pelo `checksum`, não pela
   URL** — a URL é por `uuid` e não muda entre renders. Se ele comparar URL, a
   grade congela na primeira versão e nada no log acusa.
3. Recusar agendamento de grade em player de outra loja
   (`miepp_locations.shop_id` existe para isso e precisa ser preenchida à mão).
4. Filtrar inativo também na busca do painel: hoje `product-search` reusa a
   busca do BPPP, que **não** filtra — o editor consegue escolher um produto que
   vai tirar a grade do ar no primeiro ciclo.
5. **Prévia do estilo no painel.** Hoje quem ajusta uma cor espera o ciclo de 5
   minutos para ver o resultado, o que torna o ajuste fino inviável na prática.
   O caminho é uma rota que chama `renderGridHtml` e devolve a imagem sem
   gravar nada em `_files` nem tocar em `data_hash` — o template já é puro e
   aceita o estilo direto, então falta só a rota.
6. **Fonte enviada pelo marketing.** Pedido de 18/09/2026. Não precisa de
   Dockerfile: a fonte sobe para `_files` como qualquer mídia e entra no HTML
   como `@font-face` com o `.woff2` em data URI — mesmo caminho do fundo, que já
   é data URI justamente por isso. Continua sem rede no render e o `data_hash`
   continua descrevendo a imagem, desde que o id do arquivo entre na digital.
   Ver "Pontas soltas" para o que precisa ser decidido antes.

### `GET /miepp/product-search`

Mesma consulta de `GET /bppp/products` — o **mesmo** `BpppProductUseCases`,
atrás de `CAN_WRITE` do miepp. Existe porque a rota do BPPP exige `BPPP_USE`, e
quem monta grade tem `MIEPP_EDIT`: a tela tomaria 403 na primeira busca. A
alternativa era conceder `BPPP_USE` a todo editor de mídia.

Sem permissão nova para grade: montar grade é editar conteúdo. Render forçado e
trilha exigem `CAN_ADMINISTER`.

---

## Proof-of-play: quantas vezes cada mídia foi exibida

Adicionado em 21/09/2026. DDL em `GIPP-SQL/miepp-play-log.sql`.

### Nada no servidor sabia o que apareceu na parede

O módulo sabia o que estava **escalado** (playlist + agendamento) e que a tela
estava **viva** (`miepp_player_status_log`), e as três fontes que pareciam
responder "quantas vezes essa mídia passou" não respondiam:

| Fonte | O que ela conta de verdade |
|---|---|
| `miepp_player_status_log` | só `online`/`offline`/`error`/`reboot`; o heartbeat nunca disse qual mídia estava no ar |
| entrega do binário (`/media/:uuid/file`) | **downloads**, e o player cacheia por checksum. Mídia que toca 400 vezes é baixada uma |
| `miepp_product_grid_renders` | o servidor **desenhando** a imagem, não a tela mostrando. Serve para reclamação de preço |

Quem sabe é o player, e só ele. Daí `POST /miepp/device/plays` — a **primeira
rota em que o dispositivo escreve conteúdo**.

### O contrato com o app é o coração do desenho

```
POST /miepp/device/plays
Authorization: Bearer <token do device>

{ "plays": [
    { "event_uuid": "<gerado NO DISPOSITIVO>",
      "media_uuid": "<o uuid que veio em GET /device/playlist>",
      "started_at":  "2026-09-21T13:59:30-03:00",
      "duration_ms": 12000,
      "completed":   true,
      "playlist_id": 2, "schedule_id": 7 }
] }

→ 200 { "received": 1, "accepted": 1, "duplicated": 0, "rejected": [] }
```

Três decisões, e as três existem para o mesmo fim — **não travar a fila local
do player**:

1. **`event_uuid` vem do dispositivo.** A tela enfileira exibições enquanto
   está sem rede (o cenário normal numa loja) e reenvia depois. Sem chave de
   idempotência gerada na ponta, um lote reenviado porque a resposta HTTP se
   perdeu dobraria a contagem — e contagem que dobra em silêncio é pior do que
   contagem nenhuma. A `UNIQUE` de `event_uuid` absorve o reenvio e a rota
   responde `duplicated`.
2. **A crítica é por evento, não pelo lote.** Recusar o lote inteiro por causa
   de um evento ruim faria o app reenviar o mesmo corpo para sempre: o evento
   ruim nunca sairia da fila e a tela nunca mais reportaria nada. Cada evento
   volta como `accepted`, `duplicated` ou `rejected` **com motivo**
   (`invalid_duration`, `unknown_media`, `started_at_in_future`, …).
3. **2xx = o lote todo pode sair da fila local.** Os três desfechos são finais.
   Só erro 5xx pede reenvio.

Teto de 200 exibições por requisição (`MAX_PLAYS_PER_BATCH`): o ingest grava
evento por evento numa transação, e 200 eventos são ~400 comandos, que cabem no
timeout de 15s do pool.

⚠️ **Depende de release do app.** Sem o player mandando o evento, nenhuma rota
de relatório tem o que mostrar — o backend não deduz exibição de mais nada.

### Duas tabelas, e o acumulado é quem responde relatório

`miepp_player_status_log` já faz ~26 milhões de linhas/ano com 50 telas, e play
log cresce **mais rápido**: uma exibição a cada ~15s contra um heartbeat por
minuto. 50 telas × 12h ≈ 144 mil linhas/dia.

- **`miepp_media_plays`** — o evento cru. Retenção curta (sugestão: 90 dias).
  É a evidência de caso específico: "o que a tela 12 tocou às 14h03".
- **`miepp_media_play_daily`** — o acumulado por dia/mídia/tela/local, escrito
  na **mesma transação** do cru e só quando o INSERT do cru de fato inseriu.
  É o que **toda** rota de relatório lê. Sobrevive à purga do cru.

Não há job de agregação de propósito: no cluster PM2 de 2 instâncias ele
precisaria de trava para não rodar duplicado, e acumulado contado duas vezes é
pior do que não ter acumulado.

### Por que `location_id` é snapshot, e não join

A tela **muda de lugar**. Se o relatório resolvesse o local pelo
`miepp_players.location_id` atual, mover um equipamento do Caixa 1 para outra
loja migraria toda a audiência histórica junto — a loja A perderia exibições
que aconteceram nela. Por isso o local é gravado no ingest e nunca recalculado,
e o recorte por tela agrupa por `(player_id, location_id)`: uma tela que mudou
de local no período aparece em duas linhas.

`media_title` é snapshot pelo mesmo motivo por outro caminho: `DELETE` de mídia
é **físico** (`SQL_DELETE_MEDIA`), e relatório de campanha encerrada é
justamente o que se consulta depois. Daí também a ausência de FK em `media_id`
— CASCADE apagaria a trilha, RESTRICT impediria de apagar mídia velha.

No acumulado, `location_id` é `NOT NULL DEFAULT 0` e entra na PRIMARY KEY: em
chave única dois NULLs não são iguais, então tela sem local cadastrado criaria
uma linha nova por exibição em vez de somar. O `play-report.shaper` traduz
`0 → null` na leitura, e a API nunca expõe o sentinela.

### As rotas de leitura

| Rota | Responde | Lê |
|---|---|---|
| `GET /miepp/reports/media-plays` | ranking: quantas vezes cada mídia passou, em quantas telas e locais | acumulado |
| `GET /miepp/media/:id/plays` | uma mídia aberta por **local**, por **tela** e por **dia** | acumulado |
| `GET /miepp/players/:id/plays` | exibições cruas de uma tela — evidência | **cru** (sujeito à purga) |

Todas em `CAN_READ`: relatório é leitura do módulo, mesma decisão da grade de
produtos. Filtros `from`/`to` com janela padrão de 30 dias e teto de 366 — a
janela efetivamente usada volta em `range`, então o encurtamento nunca é
silencioso. Pontas invertidas são desinvertidas em vez de devolverem zero
linhas; data malformada cai no padrão e aparece na `range`.

As três quebras de `GET /media/:id/plays` vêm na mesma resposta em vez de três
rotas com `?group_by=`: quem abre essa tela quer as três ao mesmo tempo, e três
requisições dariam três oportunidades de a janela divergir entre os painéis.

### `seconds_on_screen` não é `plays × duração programada`

É o tempo somado que o player mediu. A diferença entre os dois é exatamente o
que o proof-of-play revela: tela rebootando no meio da mídia, playlist trocando
antes do fim. `completion_rate` é `completed_plays / plays`, e vem `null` com
zero exibição — 0% e "não houve exibição" são coisas diferentes no relatório.

---

## Rate limiting

As rotas `/miepp/device/*` e a de entrega de mídia são contadas por
**dispositivo** (`deviceLimiter`, 900 por 15 min), e ficam **fora** do
`apiLimiter`.

Isso não é detalhe: o player não tem sessão, então cairia no balde de IP — e
numa loja todas as telas saem pelo mesmo endereço. Vinte telas dividiriam as
2000 requisições por janela e começariam a receber 429 em horário de pico. É a
mesma armadilha que o cabeçalho de `rate-limit.middleware.js` descreve para os
usuários, agora do lado do dispositivo.

A chave é o SHA-256 do token (ou o `p` da query, na rota de mídia — valor
confiável porque a assinatura HMAC o cobre). Vale a ressalva de sempre: o
contador é por processo e são 2 instâncias, então o teto real fica entre 900 e
1800.

---

## Auditoria

Toda rota administrativa de escrita grava uma linha em `miepp_audit_log`
automaticamente, pelo `miepp-audit.middleware`. Nenhum controller faz isso à
mão — a rota só declara `audit('player')`.

- Só grava em resposta 2xx: uma tentativa recusada não alterou nada, e
  registrá-la encheria a trilha de ruído.
- `token`, `code`, `password` e `secret` são removidos do `detail`. A trilha é
  lida por qualquer admin; gravar o segredo ali anularia o cuidado de guardar
  só o hash em `miepp_device_tokens`.
- Não existe rota para inserir na trilha. Uma trilha que aceita escrita pela API
  deixa de valer como evidência.

Leitura: `GET /miepp/audit-log?entity_type=player&user_id=3&page=1&limit=50`
(somente `admin`).

---

## Variáveis de ambiente

Todas em `.env.example`, seção "miepp". As tabelas vivem no MySQL `global`
(`MYSQL_GLOBAL_*`), então não há variável de conexão própria.

| Variável | Obrigatória | Default | O que faz |
|---|---|---|---|
| `MIEPP_MEDIA_TOKEN_SECRET` | **sim** | — | HMAC das URLs de mídia |
| `MIEPP_PAIRING_SECRET` | **sim** | — | HMAC dos códigos de pareamento |
| `MIEPP_PUBLIC_BASE_URL` | na prática sim | `''` | prefixo absoluto das URLs entregues ao player |
| `MIEPP_MEDIA_TOKEN_TTL_HOURS` | não | `24` | validade da URL assinada |
| `MIEPP_PAIRING_TTL_MINUTES` | não | `10` | validade do código de pareamento |
| `MIEPP_DEVICE_TOKEN_TTL_DAYS` | não | sem expiração | rotação do token de device |
| `MIEPP_FALLBACK_PLAYLIST_ID` | não | sem fallback | playlist quando nada casa |
| `MIEPP_FALLBACK_MEDIA_ID` | não | sem reserva | mídia perene quando o conteúdo **vence** |
| `MIEPP_OFFLINE_AFTER_MINUTES` | não | `5` | sem heartbeat por este tempo, a tela conta como offline |

Sem os dois segredos, o resto da API sobe normalmente e só as rotas do miepp
respondem 500 dizendo qual variável falta — de propósito: o mesmo processo
serve EPP, GTPP e GAPP, e um `.env` incompleto do miepp não pode derrubá-los.

Gerar um segredo:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Subir o módulo

1. **Banco** — executar `GIPP-SQL/miepp-deploy.sql` no MySQL `global`. O
   cabeçalho do arquivo lista o que ele muda em relação ao `miepp_sql.sql`
   original (coluna `global_user_id`, `file_id` para VARCHAR(500), índices).
2. **Seed do primeiro admin** — o `INSERT` comentado no fim do mesmo arquivo.
   Sem ele ninguém entra.
3. **`.env`** — preencher os dois segredos e `MIEPP_PUBLIC_BASE_URL`.
4. **Deploy** — `docker compose build && docker compose up -d` em
   `/home/administrador/Documents/gpprh/api`. O código vai na imagem, então
   restart não basta.

### Rodar os testes

Sobre UNC o `npm` quebra (ver `CLAUDE.md`), então chame o Jest direto:

```bash
node "node_modules/jest/bin/jest.js" --testPathIgnorePatterns="\.claude" --testPathPattern="miepp"
```

239 testes, concentrados no que quebra silencioso: o resolvedor de agendamento,
a matriz de papéis, o shaper de item, as guardas de playlist, o ciclo do render
da grade e a crítica do lote de exibições. Todos usam fakes das portas — nenhum
toca o banco.

---

## Mapa dos arquivos

```
src/config/miepp.js                                    # env → config
src/schemas/miepp.schema.js                            # validação de payload
src/middlewares/
  miepp-device-auth.middleware.js                      # Bearer do player
  miepp-role.middleware.js                             # papel do painel
  miepp-audit.middleware.js                            # trilha automática
  rate-limit.middleware.js                             # deviceLimiter (alterado)
src/modules/global/
  miepp.routes.js                                      # as 65 rotas
  domain/miepp/                                        # puro, sem I/O
    miepp.enums.js  miepp-access.rules.js  pagination.rules.js
    schedule/schedule-resolver.rules.js                # ← a regra central
    schedule/days-of-week.js
    media/media-origin.rules.js                        # upload × grade, derivado do join
    playlist/playlist-item.shaper.js
    play/play-event.rules.js                           # crítica do lote do player
    play/play-range.rules.js                           # janela dos relatórios
    play/play-report.shaper.js                         # linhas do relatório
    product-grid/product-grid.rules.js                 # curadoria e layout
    product-grid/grid-render.rules.js                  # digital e decisão do ciclo
    product-grid/grid-style.rules.js                   # vocabulário do estilo
src/templates/miepp-grid/grid.template.js              # HTML que vira imagem
src/workers/miepp-grid-renderer.js                     # worker PM2 do render
  application/miepp/<sub-feature>/                     # casos de uso + portas
  infrastructure/miepp/                                # adapters MySQL + serviços
    miepp-media-storage.service.js                     # integração com `_files`
    miepp-media-token.service.js                       # assina URLs
    miepp-pairing-code.service.js                      # códigos de pareamento
  repositories/mysql/miepp-*.queries.js                # SQL puro
  controllers/miepp-*.controller.js
```

---

## Pontas soltas

- **Fonte enviada pelo usuário é arquivo executável pelo Chromium.** Antes de
  abrir a rota pedida em 18/09/2026, decidir: aceitar só `.woff2` (formato sem
  tabelas de hinting executáveis), validar o `magic number` do arquivo e não só
  a extensão, e limitar o tamanho — uma fonte de 5 MB vira data URI de ~6,7 MB
  dentro do HTML, em todo render de toda grade que a usar. Registrar a licença
  junto: fonte comercial redistribuída dentro de uma imagem é problema jurídico,
  não técnico.
- **`miepp_player_status_log` cresce rápido.** Um heartbeat por minuto por tela
  = ~1.440 linhas/tela/dia; 50 telas dão ~26 milhões de linhas por ano. Planejar
  purga ou particionamento antes de passar de algumas dezenas de telas. Lembrar
  que o servidor de dados (10.10.10.99) já está apertado.
- **A purga de `miepp_media_plays` não tem agendamento.** O `DELETE` em lotes
  está escrito no rodapé de `miepp-play-log.sql` e **ninguém o executa**. O
  acumulado (`miepp_media_play_daily`) não depende dele, então nada quebra — o
  cru só cresce. Combinar a retenção (sugestão: 90 dias) com o requerente e pôr
  num agendamento antes de passar de algumas dezenas de telas. Rodar em lote e
  fora do horário de loja: um `DELETE` de milhões de linhas segura o pool, e as
  estações acessam este banco direto.
- **O proof-of-play espera release do app.** As tabelas e as rotas estão de pé,
  mas exibição só existe se o player a reportar em `POST /device/plays`. Até o
  APK novo chegar, os relatórios respondem corretamente com zero. Combinar com
  quem faz o app: `event_uuid` gerado na ponta (é a idempotência), fila local
  persistida em disco (senão reboot perde a audiência do dia) e limpeza da fila
  só ao receber 2xx.
- **Não há mídia "mais vista por pessoa", só por tela.** O play log mede o que a
  parede exibiu, não quem olhou. Qualquer número de audiência de PESSOAS
  exigiria outra fonte (contagem de fluxo, cupom no caixa) — não prometer isso a
  partir destas tabelas.
- **Comando entregue e perdido fica em `sent`.** `GET /device/commands/pending`
  marca como `sent` na mesma transação da leitura, para não entregar duas vezes
  (um `reboot` duplicado derruba a tela no meio da veiculação). Se a resposta se
  perder na rede, o comando não volta sozinho para `pending` — quem reenvia é o
  painel.
- **Fallback é global, não por player/local.** Vale para os dois:
  `MIEPP_FALLBACK_PLAYLIST_ID` e `MIEPP_FALLBACK_MEDIA_ID`. O requisito admitia
  a v1 assim. Os ganchos estão em `MieppDeviceUseCases#_fallbackPlaylistId` e
  `#_findFallbackMediaRow`. Não existe eixo "cliente" para pendurar isso: o
  módulo é interno, `miepp_locations` tem uma linha e `miepp_player_groups`
  está vazia — por player ou por local são as extensões que fazem sentido.
- **`stale_after_minutes` está em 20 min porque é o default do DDL, não porque
  alguém decidiu.** Agora ele governa duas coisas ao mesmo tempo: quanto tempo
  a grade sobrevive ao servidor sem reconferir preço, e quanto tempo ela
  sobrevive na tela offline (vira o `max_age_seconds`). São a mesma pergunta de
  negócio — "por quanto tempo a operação aceita um preço não reconferido na
  parede?" — e precisam do mesmo número, vindo de quem responde por isso. 20 min
  é apertado para queda de rede: 21 min offline já derruba a grade.
- **`miepp_locations.shop_id` continua NULL.** Sem ele nada impede agendar uma
  grade com preços da loja A numa tela da loja B, e a validação que deveria
  recusar isso não tem com o que comparar. É preenchimento de cadastro
  (`NROEMPRESA` do Consinco), não código.
- **Não há histórico de quedas.** O `status` derivado responde "está fora
  agora?", mas `miepp_player_status_log` só tem o que a tela reportou — nenhum
  evento `offline` é gravado, porque uma tela caída não fala. Precisa do job
  varredor. Ver a seção "Estado de uma tela".
- **O código de pareamento tem 62 caracteres.** Serve para copiar/colar ou QR,
  não para digitar num controle remoto. Código curto exige tabela — ver acima.
