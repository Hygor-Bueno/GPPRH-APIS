# meipp — Mídia Interna e Externa Peg Pese

Gerenciamento e monitoramento remoto de mídia indoor digital: cadastro de telas,
biblioteca de mídia, playlists, agendamento e comandos remotos.

A suite vive dentro do módulo `global` (mesma decisão do GCPP e do GTPP), com
tabelas `meipp_*` no MySQL `global`. Não é um serviço separado nem um container
novo — sobe junto do `api-gipp-enterprises`.

**Prefixo em produção:** `https://vagas.gpprh.com.br/api/v1/global/meipp/`

---

## Três zonas de autenticação

Esta é a parte que mais importa entender antes de mexer no módulo. São três
mecanismos disjuntos, e nenhum se converte no outro.

| Zona | Quem entra | Como | Middleware |
|---|---|---|---|
| Painel (`/meipp/...`) | usuário do painel | cookie de sessão do global | `auth.middleware` + `requireMeippRole` |
| Dispositivo (`/meipp/device/...`) | o player Android | `Authorization: Bearer <token>` | `authenticateDevice` |
| Entrega de mídia (`/meipp/media/:uuid/file`) | o player, baixando o binário | assinatura HMAC na query (`?t=`) | nenhum — a assinatura é a autorização |

**O `auth.middleware` do global não foi tocado.** O `CLAUDE.md` proíbe
acrescentar Bearer àquele caminho, e com razão: ele é a sessão por cookie dos
usuários, com refresh e troca de senha. O player não é usuário — não renova
nada, e o token dele vale até ser revogado. `req.device` nunca vira `req.user`,
então um token de player não alcança nenhuma rota administrativa.

### Não existe `POST /auth/login` no meipp

O requisito original previa login próprio. Ele não foi implementado porque a
autenticação do painel é a sessão que já existe (`POST /api/v1/global/login`).
`meipp_users` é a tabela de **papel**, não de identidade: diz qual papel
(`admin`/`editor`/`viewer`) uma pessoa já autenticada tem dentro do módulo, e
serve de destino para as FKs de autoria. O vínculo é a coluna
`global_user_id`. A coluna `password_hash` continua no DDL mas nasce NULL e não
é lida por nenhuma query.

**Consequência prática:** o acesso ao módulo é ter uma linha ativa em
`meipp_users`. Não há permissão no sistema de permissões do global (`canAny`)
para esta suite. Sem o seed do primeiro admin (fim do `meipp-deploy.sql`),
ninguém entra.

---

## Papéis

| Papel | Leitura | CRUD de conteúdo | Usuários, desativar player, revogar token, auditoria |
|---|---|---|---|
| `viewer` | ✔ | ✘ | ✘ |
| `editor` | ✔ | ✔ | ✘ |
| `admin`  | ✔ | ✔ | ✔ |

Hierárquicos: a checagem é por patamar mínimo (`hasAtLeast`), não por lista de
papéis — assim uma rota nova não nasce com `['admin','editor']` esquecendo um
dos dois. Ver `domain/meipp/meipp-access.rules.js`.

---

## A regra central: qual playlist toca agora

`GET /meipp/device/playlist` é o coração do módulo. A decisão está isolada e é
pura — `domain/meipp/schedule/schedule-resolver.rules.js` — e roda assim:

1. Só agendamentos `active = 1`.
2. O alvo precisa alcançar o player: `all`, ou `player` com o id dele, ou
   `group` com algum grupo em que ele esteja.
3. Vigência: `start_date <= hoje <= end_date` (NULL = sem limite).
4. Janela: `start_time <= agora <= end_time` (NULL = sem limite).
5. Bit do dia atual ligado em `days_of_week` (bit0 = domingo … bit6 = sábado).
6. Vence a maior `priority`; empate vai para o `updated_at` mais recente;
   empate total, para o maior `id`.
7. Nada casou → playlist de fallback (`MEIPP_FALLBACK_PLAYLIST_ID`), ou
   `keep_cache: true` com lista vazia, e o player mantém o que já tem.

O critério de desempate por `id` não está no requisito original. Foi
acrescentado porque o `updated_at` do MySQL tem resolução de 1 segundo: dois
agendamentos salvos no mesmo segundo empatariam de verdade, e a tela alternaria
entre dois conteúdos de forma imprevisível a cada chamada.

### Limitação conhecida: janela que cruza a meia-noite

O critério 4 é literal, como especificado. Um agendamento 22:00→02:00 **nunca
casa**: às 23:00 falha o `end_time`, à 01:00 falha o `start_time`. Para cobrir
madrugada, cadastre dois agendamentos (22:00→23:59:59 e 00:00→02:00). O
`MeippScheduleUseCases` recusa `start_time > end_time` no cadastro com uma
mensagem dizendo isso, em vez de aceitar um agendamento que nunca tocaria.

Inverter o teste quando `end_time < start_time` mudaria o significado de dados
já cadastrados — é decisão do requerente, não efeito colateral de implementação.

---

## Pareamento de um player

1. Admin cadastra o player: `POST /meipp/players`.
2. Admin gera o código: `POST /meipp/players/:id/pairing-code` → devolve
   `code` e `expires_at` (10 min por padrão).
3. O app na tela troca o código pelo token: `POST /meipp/device/pair` com
   `{ "pairing_code": "..." }`.
4. A resposta traz o token **em texto puro, uma única vez**. O banco guarda só
   o SHA-256 em `meipp_device_tokens.token_hash` — nem o painel nem o suporte
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
tabela `meipp_pairing_codes` — é a extensão natural.

---

## Entrega de mídia

O player não tem sessão, então a rota que serve o binário não pode depender do
cookie. Cada URL sai assinada por HMAC e com validade curta, emitida no momento
em que `GET /meipp/device/playlist` monta a resposta:

```
GET /meipp/media/<uuid>/file?t=<expira>.<assinatura>&p=<playerId>
```

A assinatura cobre `uuid + playerId + expiração`. Uma URL vazada só serve para o
dispositivo a que foi emitida e vence sozinha. Qualquer falha responde 404
genérico — um 401 distinto confirmaria que o uuid existe, e os uuids aparecem no
JSON de playlist de qualquer tela pareada.

O binário mora no sistema `_files` do global (o mesmo do chat e do GTPP), atrás
de `MeippMediaStorageService`. Esse serviço é o único ponto do módulo que
conhece o `_files`: trocar o armazenamento um dia mexe só nele.

Excluir uma mídia **não** apaga o binário: o `_files` deduplica por SHA-256 e o
mesmo arquivo pode estar referenciado por outro módulo.

---

## Estado de uma tela: `online` / `offline`

`meipp_players.status` é **derivado de `last_seen_at` na leitura**, não lido da
coluna:

```
last_seen_at IS NULL                        → unknown
last_seen_at >= agora - MEIPP_OFFLINE_AFTER_MINUTES → online
senão                                        → offline
```

A coluna só é escrita pelo heartbeat, e sempre com `'online'`. Se a leitura
confiasse nela, uma tela que caísse (energia, rede, app travado) apareceria
como `online` para sempre — o oposto do que um módulo de monitoramento remoto
precisa mostrar. A coluna continua sendo atualizada e vai na resposta como
`last_known_status`, útil para diagnóstico.

A alternativa seria um job varrendo `meipp_players`; foi descartada por
acrescentar processo, e no cluster de 2 instâncias exigir trava para não rodar
duplicado.

**O que isso NÃO faz:** gravar o evento `offline` em
`meipp_player_status_log`. O log registra o que a tela reporta, e uma tela
caída não reporta nada. Um histórico de quedas ("desde quando essa tela está
fora?") exige o job varredor — é a extensão natural daqui, e a única coisa que
o painel ainda não consegue responder sozinho.

---

## Ciclo de vida do status da mídia

`image`/`html` nascem `ready`. `video` que entra na fila de transcodificação do
`_files` nasce `processing`, e quem o move dali é o
`workers/video-transcoder.js`, que agora atualiza `meipp_media` lado a lado com
os anexos do GTPP (o mesmo arquivo pode ser os dois — o storage deduplica por
hash):

| Momento no worker | `meipp_media.status` |
|---|---|
| job reservado | `processing` |
| conversão concluída | `ready` |
| falha final (após as tentativas) | `error` |

Só `ready` (e `weburl`, que não tem binário) chega à playlist do player — ver
`isPlayable` no shaper. Sem esse gancho, um vídeo transcodificado ficaria preso
em `processing` para sempre e nunca apareceria na tela, sem erro em lugar
nenhum.

**Decisão a confirmar:** na falha final o meipp marca `error`, enquanto o GTPP
marca `failed` e continua servindo o arquivo original. A diferença é
proposital — o codec que motivou a conversão é justamente o que a caixa Android
tende a não decodificar, e o resultado seria um quadro preto na loja. Com
`error`, a mídia sai da playlist e aparece marcada no painel. Se preferir
"tenta tocar assim mesmo", é uma linha em `failJob`.

---

## Rate limiting

As rotas `/meipp/device/*` e a de entrega de mídia são contadas por
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

Toda rota administrativa de escrita grava uma linha em `meipp_audit_log`
automaticamente, pelo `meipp-audit.middleware`. Nenhum controller faz isso à
mão — a rota só declara `audit('player')`.

- Só grava em resposta 2xx: uma tentativa recusada não alterou nada, e
  registrá-la encheria a trilha de ruído.
- `token`, `code`, `password` e `secret` são removidos do `detail`. A trilha é
  lida por qualquer admin; gravar o segredo ali anularia o cuidado de guardar
  só o hash em `meipp_device_tokens`.
- Não existe rota para inserir na trilha. Uma trilha que aceita escrita pela API
  deixa de valer como evidência.

Leitura: `GET /meipp/audit-log?entity_type=player&user_id=3&page=1&limit=50`
(somente `admin`).

---

## Variáveis de ambiente

Todas em `.env.example`, seção "meipp". As tabelas vivem no MySQL `global`
(`MYSQL_GLOBAL_*`), então não há variável de conexão própria.

| Variável | Obrigatória | Default | O que faz |
|---|---|---|---|
| `MEIPP_MEDIA_TOKEN_SECRET` | **sim** | — | HMAC das URLs de mídia |
| `MEIPP_PAIRING_SECRET` | **sim** | — | HMAC dos códigos de pareamento |
| `MEIPP_PUBLIC_BASE_URL` | na prática sim | `''` | prefixo absoluto das URLs entregues ao player |
| `MEIPP_MEDIA_TOKEN_TTL_HOURS` | não | `24` | validade da URL assinada |
| `MEIPP_PAIRING_TTL_MINUTES` | não | `10` | validade do código de pareamento |
| `MEIPP_DEVICE_TOKEN_TTL_DAYS` | não | sem expiração | rotação do token de device |
| `MEIPP_FALLBACK_PLAYLIST_ID` | não | sem fallback | playlist quando nada casa |
| `MEIPP_OFFLINE_AFTER_MINUTES` | não | `5` | sem heartbeat por este tempo, a tela conta como offline |

Sem os dois segredos, o resto da API sobe normalmente e só as rotas do meipp
respondem 500 dizendo qual variável falta — de propósito: o mesmo processo
serve EPP, GTPP e GAPP, e um `.env` incompleto do meipp não pode derrubá-los.

Gerar um segredo:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Subir o módulo

1. **Banco** — executar `GIPP-SQL/meipp-deploy.sql` no MySQL `global`. O
   cabeçalho do arquivo lista o que ele muda em relação ao `miepp_sql.sql`
   original (coluna `global_user_id`, `file_id` para VARCHAR(500), índices).
2. **Seed do primeiro admin** — o `INSERT` comentado no fim do mesmo arquivo.
   Sem ele ninguém entra.
3. **`.env`** — preencher os dois segredos e `MEIPP_PUBLIC_BASE_URL`.
4. **Deploy** — `docker compose build && docker compose up -d` em
   `/home/administrador/Documents/gpprh/api`. O código vai na imagem, então
   restart não basta.

### Rodar os testes

Sobre UNC o `npm` quebra (ver `CLAUDE.md`), então chame o Jest direto:

```bash
node "node_modules/jest/bin/jest.js" --testPathIgnorePatterns="\.claude" --testPathPattern="meipp"
```

66 testes, concentrados no que quebra silencioso: o resolvedor de agendamento,
a matriz de papéis, o shaper de item e as guardas de playlist. Todos usam fakes
das portas — nenhum toca o banco.

---

## Mapa dos arquivos

```
src/config/meipp.js                                    # env → config
src/schemas/meipp.schema.js                            # validação de payload
src/middlewares/
  meipp-device-auth.middleware.js                      # Bearer do player
  meipp-role.middleware.js                             # papel do painel
  meipp-audit.middleware.js                            # trilha automática
  rate-limit.middleware.js                             # deviceLimiter (alterado)
src/modules/global/
  meipp.routes.js                                      # as 58 rotas
  domain/meipp/                                        # puro, sem I/O
    meipp.enums.js  meipp-access.rules.js  pagination.rules.js
    schedule/schedule-resolver.rules.js                # ← a regra central
    schedule/days-of-week.js
    playlist/playlist-item.shaper.js
  application/meipp/<sub-feature>/                     # casos de uso + portas
  infrastructure/meipp/                                # adapters MySQL + serviços
    meipp-media-storage.service.js                     # integração com `_files`
    meipp-media-token.service.js                       # assina URLs
    meipp-pairing-code.service.js                      # códigos de pareamento
  repositories/mysql/meipp-*.queries.js                # SQL puro
  controllers/meipp-*.controller.js
```

---

## Pontas soltas

- **`meipp_player_status_log` cresce rápido.** Um heartbeat por minuto por tela
  = ~1.440 linhas/tela/dia; 50 telas dão ~26 milhões de linhas por ano. Planejar
  purga ou particionamento antes de passar de algumas dezenas de telas. Lembrar
  que o servidor de dados (10.10.10.99) já está apertado.
- **Comando entregue e perdido fica em `sent`.** `GET /device/commands/pending`
  marca como `sent` na mesma transação da leitura, para não entregar duas vezes
  (um `reboot` duplicado derruba a tela no meio da veiculação). Se a resposta se
  perder na rede, o comando não volta sozinho para `pending` — quem reenvia é o
  painel.
- **Fallback é global, não por player/local.** O requisito admitia a v1 assim.
  O gancho está em `MeippDeviceUseCases#_fallbackPlaylistId`.
- **Não há histórico de quedas.** O `status` derivado responde "está fora
  agora?", mas `meipp_player_status_log` só tem o que a tela reportou — nenhum
  evento `offline` é gravado, porque uma tela caída não fala. Precisa do job
  varredor. Ver a seção "Estado de uma tela".
- **O código de pareamento tem 62 caracteres.** Serve para copiar/colar ou QR,
  não para digitar num controle remoto. Código curto exige tabela — ver acima.
