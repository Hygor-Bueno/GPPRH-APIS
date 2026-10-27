# CLAUDE.md — Contexto do projeto gpprh/api

## Stack
- **Node.js / Express** — API REST em `\\192.168.0.99\gpprh\api\src`
- **MySQL** (`poolGlobal`) — banco `global` em `10.10.10.99`
- **SQL Server** (mssql) — banco GIPP/Protheus em `10.10.10.51`
- **Oracle** (oracledb Thick mode) — ERP Consinco em `10.10.10.191:1521/orcl`
- **Docker Compose** — 3 containers no servidor `192.168.0.99` (ver **Deploy** abaixo)
- **URL produção** — `https://vagas.gpprh.com.br/api/v1/global/`

## Deploy

⚠️ Desde **2026-08-06** quem atende a produção são **containers Docker**. O PM2 **do host** (`api-gpprh`, `ws-gpprh`, `front-gpprh`) foi parado nessa data — `pm2 restart api-gpprh` no host **não surte efeito nenhum**.

Compose project `api`, em `/home/administrador/Documents/gpprh/api` (Ubuntu 24.04, Docker 29.1.3, Compose v2.40.3). Todas as portas são publicadas **só no loopback** — quem alcança os containers é o Apache do próprio host.

| Container | Porta (host) | Papel | Dockerfile |
|---|---|---|---|
| `api-gipp-enterprises` | `127.0.0.1:4002` | Backend interno (GTPP, EPP, GAPP, GIPP-RH, Protheus, chat) | `Dockerfile.internal` |
| `ws-gipp-enterprises` | `127.0.0.1:4011` → `4001` no container | WebSocket (mesma imagem do interno, só o comando muda) | `Dockerfile.internal` |
| `api-gpprh` | `127.0.0.1:4010` | Backend público (site de vagas / candidatos) | `Dockerfile.public` |

**Aplicar mudança de código:** `docker compose build && docker compose up -d` no diretório acima.

**Diagnosticar:** `docker compose ps` / `docker compose logs -f <serviço>` — nunca `pm2 list` no host.

### PM2 ainda existe — dentro do container interno
O `Dockerfile.internal` roda `pm2-runtime start ecosystem.docker.config.js`, que sobe `src/server.internal.js` em **cluster com 2 instâncias**. Motivo: o cluster mode compartilha uma porta única, que é como o Apache enxerga o upstream. São dois arquivos ecosystem e só um está vivo:

| Arquivo | Onde roda | Status |
|---|---|---|
| `ecosystem.config.js` (raiz) | PM2 do host | **morto** — histórico |
| `ecosystem.docker.config.js` | `pm2-runtime` no container | **ativo — não apagar** |

### Detalhes que só funcionam dentro do Compose
- A porta do WebSocket é **hardcoded 4001** em `src/websocket/websocketServer.js` — só funciona pelo mapeamento `4011:4001`.
- `WS_EMIT_URL` resolve `ws-gipp-enterprises` **por nome de container** na rede `api_default`.
- `MYSQL_HOST=host.docker.internal` — o MySQL do banco `gpprh` está no host, não no container.
- Oracle Instant Client é **bind mount** de `/opt/oracle/instantclient_19_27` (não embutido na imagem); sem `LD_LIBRARY_PATH` → `DPI-1047`.
- Os pares de segredo JWT são **diferentes** entre interno e público (`INTERNAL_JWT_*` / `PUBLIC_JWT_*` no `.env`): é isso que impede um token de candidato de ser verificável no lado interno.

## Autenticação
- **Apenas via cookie HttpOnly** (`accessToken`, `refreshToken`, `userRole`)
- ⚠️ NÃO modificar `auth.middleware.js`, `auth-session.service.js` nem `auth.controller.js` para adicionar Bearer token

## Regras de desenvolvimento

### ⚠️ Stored Procedures SQL Server — regra obrigatória
Antes de chamar qualquer stored procedure via `.execute('sp_nome')`, **sempre verificar os parâmetros reais da procedure** antes de escrever o código.

Nunca inferir nomes de parâmetros a partir de:
- Mensagens de erro do SQL Server (indicam apenas o que *faltou*, não todos os parâmetros)
- Nomes de variáveis no código Node.js existente
- Convenção ou suposição

**Procedimento correto:**
1. Pedir ao usuário: `EXEC sp_helptext 'nome_da_procedure'`
2. Ler todos os parâmetros (`@nome tipo`)
3. Só então escrever os `.input('nome', sql.Tipo, valor)` — o nome no `.input()` deve ser idêntico ao `@nome` da SP (sem o `@`)

**Exemplo do erro que motivou essa regra (2026-06-09):**
```
"Procedure 'sp_update_gipp_rh_compensation' expects parameter '@user_branch', which was not supplied."
```
O código tinha `.input('branch_code', ...)`. A correção foi feita sem ver a SP completa — apenas trocou `branch_code` por `user_branch` baseado na mensagem de erro, sem confirmar os demais parâmetros.

### ⚠️ Rate limiting — a chave é o usuário, não o IP

Duas camadas **mutuamente exclusivas** em `app.factory` (ver cabeçalho de
`rate-limit.middleware.js`):

| Camada | Quem conta | Chave | Cota / 15 min |
|---|---|---|---|
| `apiLimiter` | só quem **não** tem sessão | IP | 2000 |
| `userLimiter` | só quem **tem** sessão | `_user.id` do token | 1000 |

Não volte a chavear rota autenticada por IP: era isso que fazia o uso de uma
pessoa devolver 429 para todas as outras atrás do mesmo endereço (NAT do app
mobile, terminal compartilhado). ⚠️ O `trust proxy` **estava errado** e foi corrigido em 15/09/2026. A cadeia
tem DOIS saltos (Apache do 10.10.10.99 → Apache do 192 na :4090 → container),
e `trust proxy = 1` fazia `req.ip` devolver `10.10.10.99` para todos — ou seja,
todo limiter por IP num balde único. Agora a confiança é por ENDEREÇO
(`app.factory.js`), o que cobre as duas cadeias e continua não-spoofável.

O teste antigo ("forjei o header e o balde não mudou") não provava segurança:
era indistinguível de "o balde é sempre o mesmo". Descoberto porque as telas do
MIEPP gravaram todas o mesmo `last_ip`.

No login são duas camadas também: `loginLimiter` (IP + username, 10 falhas) e
`loginIpLimiter` (IP, 50 falhas). Chavear login só por username permitiria
trancar a conta de um colega de fora.

O contador é **por processo** (store em memória, 2 instâncias no cluster), então
o limite real fica entre 1x e 2x. Store compartilhado exigiria Redis.

### ⚠️ Trilha de auditoria da jornada (GIPP) — SESSION_CONTEXT

Toda escrita em `GIPP.dbo.cf_work_schedules` dispara
`trg_cf_work_schedules_status_history`, que descobre o responsável lendo
`SESSION_CONTEXT` — não recebe parâmetro. **Qualquer novo caminho que insira em
`cf_work_schedules` ou mude `id_status_fk` precisa carimbar o contexto**, senão o
evento nasce como `change_source = 'DIRECT_DATABASE'` com usuário nulo.

Use `infra/sqlserver/session-context`:

```js
const request = pool.request().input(/* params da operação */);

bindContext(request, actor, {
    source: CHANGE_SOURCE.BACKEND,       // origem genérica é recusada
    reason: CHANGE_REASON.APPROVED_BY_MANAGER,
});

await request.query(withAuditContext(query, { captureRowCount: true }));
```

- O `actor` sai **sempre** de `toAuditActor(req.user)` (`utils/audit-actor`) — nunca do body.
- Contexto e operação vão no **mesmo batch**: é o que garante a mesma conexão física.
- **Não** envolva `prc_insert_cf_time_records` nem `pcr_process_work_schedules` em
  `sql.Transaction` — elas dão ROLLBACK interno e o COMMIT do Node estoura 3902.
- Com `captureRowCount`, leia a contagem em `recordset[0].affected_rows`;
  `rowsAffected[0]` passa a ser o do primeiro `sp_set_session_context` do batch.
- Matrícula e filial são **VARCHAR com zeros à esquerda** (`'002351'`, `'0202'`) — nunca converter para número.

Detalhes, rotas cobertas e roteiro de validação manual: [`docs/gipp-auditoria-jornada.md`](docs/gipp-auditoria-jornada.md).

---

## Módulos principais
- **EPP** (Encomendas por Pedido) — produtos, menus, pedidos, log_sales, estoque
- **GTPP** (Gestão de Tarefas) — tarefas, itens, usuários, histórico, score
- **GIPP-RH** — compensações, beneficiários, recibos de pagamento
- **BPPP** (Busca de Preço) — consulta de preço/estoque no Consinco (somente leitura)
- **miepp** (Mídia Interna e Externa) — mídia indoor digital: telas, playlists, agendamento, comandos remotos
- **Auth** — login/logout/me via cookie

### ⚠️ miepp — três autenticações que não se misturam

O painel usa a sessão por cookie de sempre. As telas (player Android) usam
`Authorization: Bearer` num middleware **próprio**
(`miepp-device-auth.middleware.js`) — **não** mexa no `auth.middleware` para
acomodá-las; a proibição da seção Autenticação continua valendo. A entrega de
mídia (`/miepp/media/:uuid/file`) não usa nenhum dos dois: é autorizada por
assinatura HMAC na query.

O acesso ao módulo é ter linha ativa em `miepp_users` (papel
`admin`/`editor`/`viewer`), **não** uma permissão do `canAny`. `miepp_users` é
tabela de papel, não de identidade — o vínculo com a sessão é `global_user_id`.

Rotas `/miepp/device/*` e a de mídia ficam **fora** do `apiLimiter` e são
contadas por dispositivo (`deviceLimiter`): sem sessão elas cairiam no balde de
IP, e as telas de uma mesma loja derrubariam umas às outras.

Detalhes, regra de resolução de playlist e pontas soltas:
[`docs/miepp.md`](docs/miepp.md). DDL: `GIPP-SQL/miepp-deploy.sql` (fora do repo).

### ⚠️ CPPP (ponto Control iD) — o espelho do relógio é imutável

`cppp_afd_records` é o AFD do relógio REP-C (registro fiscal, Portaria 671):
**só INSERT**. O banco recusa UPDATE/DELETE por trigger e um teste falha se
aparecer código escrevendo nela. Também **não existe rota de escrita contra o
relógio** — o cliente só conhece `login`, `get_afd` e `logout`. Correção de
marcação é linha em `cppp_punch_adjustments`, que só se cancela, nunca se apaga.

- Quem coleta é só o worker `cppp-afd-collector` (app PM2, `instances: 1`);
  a rota da tela só enfileira. A API fala com o relógio apenas no "testar
  conexão" do cadastro (login + logout).
- Relógios são cadastrados pela tela, cada um com seu IP; login/senha é um só,
  no `.env` (`CPPP_DEVICE_LOGIN`/`CPPP_DEVICE_PASSWORD`). O IP é restrito a IP
  literal de rede interna — o servidor manda a senha compartilhada para ele.
- Toda chamada ao relógio abre e fecha sessão (login → operação → logout); o
  login expira, nunca reaproveitar sessão.
- O campo "CPF" do AFD deste relógio guarda **CPF ou PIS** — validar pelos dois
  dígitos (`domain/cppp/cpf.rules.js`), nunca descartar "CPF inválido".
- Anexo de ajuste (atestado) é dado de saúde: o módulo `CPPP` não sai pela rota
  genérica `/files/:fileId` (`RESTRICTED_MODULES` no `files.controller`).

Detalhes, decisões e pontas soltas: [`docs/cppp.md`](docs/cppp.md). DDL:
`GIPP-SQL/cppp-deploy.sql` (fora do repo).

### ⚠️ REPP (reserva de espaços) — consulta pública, mascaramento no backend

`GET /spaces` e `GET /spaces/bookings[/:id]` são **públicos**
(`optional-auth.middleware`, nunca 401). Quem não administra o espaço nem criou
a reserva recebe só espaço, data, horário e status: a consulta mascarada **não
lê** as colunas sensíveis, e as chaves não existem na resposta. Não "simplificar"
para uma query só com campos apagados depois.

- Administrador do espaço = linha em `re_space_admins` (não é `_permissions`);
  dono do sistema = `SYSTEM_OWNER`.
- Não-admin cria `pending`; criador que troca data/horário volta para `pending`.
  Pendente ocupa o horário.
- Conflito só se checa dentro de `runLocked` (`FOR UPDATE` na linha do espaço).
- Aviso (`re_notifications`) é gravado na MESMA transação da ação e o GET **não**
  consome (ler e confirmar com `PATCH /notifications/read`) — o oposto do
  `gt_notify` do GTPP, de propósito. O `repp:event` leva o mesmo `id`.
- Lembrete (`reminder_minutes`) só dispara pelo worker `repp-reminder` (app PM2,
  `instances: 1`) — nunca pôr laço de intervalo na API, que roda em cluster de 2.

Detalhes: [`docs/repp.md`](docs/repp.md). DDL: `GIPP-SQL/re-reserva-espacos-deploy.sql`,
`GIPP-SQL/re-notificacoes-deploy.sql` e `GIPP-SQL/re-lembrete-deploy.sql`.

### ⚠️ Gestão de Acessos (`/access/*`) — fila de aprovação

Quem tem `ACCESS_MANAGE` e não é `SYSTEM_OWNER` não grava direto: criar
usuário, dar/tirar papel ou aplicação, mexer nas permissões de um papel,
renomear código de permissão, mudar `administrator` ou ativar usuário viram
pedido `pending` em `_access_requests` (resposta **202**). Só um `SYSTEM_OWNER`
aprova/recusa (`/access/requests/:id/approve|reject`), nunca o próprio pedido;
o `SYSTEM_OWNER` aplica na hora. Bloquear/desativar e editar nome/filial/senha
continuam diretos — exceto na conta de um `SYSTEM_OWNER`, que só outro dono
edita, desativa ou tem a senha trocada/resetada (403 `ACCESS_TARGET_IS_OWNER`;
no reset, via middleware `guardOwnerAccount` na rota).

- Rota nova que conceda acesso entra em `AccessRequestUseCases`, não chama o
  `AccessUseCases` direto do controller.
- O pedido guarda o **hash** da senha, nunca o texto; `toPublicRequest` tira o
  campo da resposta.
- Aprovar tira de `pending` com `UPDATE ... WHERE status = 'pending'` antes de
  aplicar (dois donos não aplicam duas vezes); se aplicar falhar, volta para
  `pending`.
- `POST /access/users` aceita `role_ids` e `application_ids`: o dono cria tudo
  numa transação (`insertUserWithAccess`); o gestor gera UM pedido
  `create_user` com as listas no `payload`. Sem isso o gestor não conseguiria
  pedir papel para um usuário que ainda não existe.
- Sino do dono = `GET /access/requests/summary` (estado, sem "lido") + evento
  `access:request` no WebSocket. O publisher nunca manda lista vazia: sem
  `toUserIds` o `eventBus` faz broadcast. Prompt do front:
  `docs/access-aprovacao-frontend-prompt.md`.

DDL: `GIPP-SQL/access-requests-deploy.sql`.

## Permissões EPP
| Código | Escopo |
|---|---|
| `EPP_USE` | Leitura geral |
| `EPP_ORDERS` | Ver, criar e atualizar pedidos |
| `EPP_PRODUCTS` | Cadastrar e editar produtos, menus e log_menus |
| `EPP_VIEW_RECIPE` | Acessar receitas Oracle (mobile, oracle_receipe) |
| `MANAGE_EPP` | Administração total |

## Permissões BPPP
| Código | Escopo |
|---|---|
| `BPPP_USE` | `GET /bppp/products` — consulta de preço/estoque/EAN no Consinco |
| `BPPP_MANAGE` | Administração do módulo (hoje equivale a `BPPP_USE`) |

Seed: `src/modules/global/repositories/mysql/bppp-permissions.sql`

## Permissões CPPP
| Código | Escopo |
|---|---|
| `CPPP_USE` | Ver inconsistências, marcações, ajustes e histórico de coleta |
| `CPPP_ADJUST` | Lançar e cancelar ajuste de ponto; abrir o atestado anexado |
| `CPPP_COLLECT` | Cadastrar/editar relógios (IP), disparar coleta e baixar o AFD bruto |

Papéis: `CPPP_RH` (USE + ADJUST) e `CPPP_MANAGER` (os três). Seed em
`GIPP-SQL/cppp-deploy.sql`.
