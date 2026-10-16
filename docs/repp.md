# REPP — Reserva de Espaços Peg Pese

Agenda dos espaços compartilhados (Sala de Treinamento, Auditório). Qualquer
pessoa vê a agenda; quem administra o espaço vê os detalhes e aprova.

- Rotas: `src/modules/global/repp.routes.js`, montadas em `/global/spaces`.
- Tabelas: `re_spaces`, `re_space_admins`, `re_bookings`, `re_notifications`,
  `re_space_unblocked_dates` (MySQL `global`).
- DDL: `GIPP-SQL/re-reserva-espacos-deploy.sql`,
  `GIPP-SQL/re-notificacoes-deploy.sql` e `GIPP-SQL/re-regras-agenda-deploy.sql`
  (fora do repo). As três primeiras
  tabelas nasceram `ae_*` e foram renomeadas por
  `GIPP-SQL/re-renomeia-ae-para-re.sql` em 08/10/2026.

## Quem é quem

| Papel | De onde vem |
|---|---|
| Dono do sistema | permissão `SYSTEM_OWNER` (a mesma do bypass do `canAny`) |
| Administrador do espaço | linha em `re_space_admins` (N por espaço) |
| Criador | `re_bookings.created_by` |

O administrador **não** é permissão de `_permissions`: a permissão é global, e
aqui o alcance é um espaço. Em 08/10/2026: Sala de Treinamento → `_user` 9;
Auditório → `_user` 476 (em 16/10/2026 o 148 também foi incluído nos dois, por
SQL).

**Gestão pela API (decisões do Hygor, 16/10/2026)** —
`domain/repp/space-admin.rules.js`, DDL `GIPP-SQL/re-admins-espaco-deploy.sql`
(coluna `created_by`):

| Rota | Acesso | Comportamento |
|---|---|---|
| `GET /spaces/:id/admins` | dono / admin do próprio espaço | `{ space_id, can_manage_admins, items: [{ user_id, name, login, ad_status, since, added_by, added_by_name }] }` |
| `POST /spaces/:id/admins` `{ user_id }` | só o dono | idempotente; usuário precisa existir (`REPP_USER_NOT_FOUND`) e estar ativo (`REPP_USER_INACTIVE`) |
| `DELETE /spaces/:id/admins/:userId` | só o dono | idempotente; 409 `REPP_LAST_SPACE_ADMIN` se não sobrar administrador **ativo** |

- Só o dono adiciona/remove (403 `REPP_MANAGE_ADMINS_FORBIDDEN`): o
  administrador concederia detalhes de reserva e isenção de regras a outros.
- O "último ativo" é conferido sob `FOR UPDATE` na linha do espaço — duas
  remoções simultâneas dos dois últimos: uma passa, a outra leva 409 (medido
  em 16/10/2026).
- Remover não mexe em reservas, datas liberadas nem avisos já gravados; a
  pessoa só perde o acesso e os avisos dali em diante.
- `can_manage_admins` sai em cada espaço do `GET /spaces` (= dono).
- Os donos não aparecem na lista (administram tudo sem vínculo), salvo quem
  também foi adicionado ao espaço.

| Quem | Vê detalhes | Edita/cancela | Aprova/recusa |
|---|---|---|---|
| anônimo / logado comum | não | não | não |
| criador | a dele | a dele | não |
| admin do espaço | do espaço | do espaço | do espaço |
| dono do sistema | tudo | tudo | tudo |

Editar e cancelar: só reserva `pending`/`approved` que ainda não começou.

## Ciclo de vida (decisões do Hygor, 08/10/2026)

- **Qualquer logado cria.** Admin do espaço e dono → `approved` na hora
  (`reviewed_by` = ele). Os demais → `pending`.
- **Pendente ocupa o horário.** Quem pede primeiro segura até a decisão;
  `rejected` e `canceled` liberam.
- **Criador que troca espaço, data ou horário volta para `pending`** e solta o
  horário antigo (passa a ocupar só o novo). Trocar título, solicitante ou
  empresa não muda o status. Quem pode aprovar no espaço de destino edita sem
  mudar o status — editar uma pendente não a aprova por tabela.
- **Reserva que já começou não se edita nem cancela** (400).
- Cancelamento é soft delete (`canceled_by`, `canceled_at`, `cancel_reason`).

## Mascaramento

Decidido no backend, por espaço e por reserva. A agenda faz **duas consultas**:
a detalhada (espaços que o usuário administra + reservas que ele criou; dono =
tudo) e a mascarada, que **só lê** id, espaço, data, horário e status. Título,
solicitante, empresa, filial, centro de custo e autoria não saem do banco para
quem não pode vê-los, e na resposta a chave não existe (nem como `null`).

O recorte usa sentinelas (`NO_SPACE = 0`, `NO_USER = -1`) e `NOT (<=>)` na
mascarada: as duas metades são complementares exatas, sem NULL no meio. Usar
NULL para o anônimo faria `created_by <=> NULL` casar reserva sem autor e a
mostrar detalhada.

O front recebe as flags prontas: `can_view_details`, `can_manage`,
`can_review` por reserva; por espaço, também `can_book` e `requires_approval`.

## Conflito e concorrência

Sobreposição = mesmo espaço e dia, `pending`/`approved`,
`início < fim_outra AND fim > início_outra` (encostar não conflita). A
checagem roda dentro de transação depois de `SELECT ... FROM re_spaces WHERE id
IN (...) ORDER BY id FOR UPDATE` — equivalente ao `UPDLOCK, HOLDLOCK` do SQL
Server, travando só o espaço. Não usamos trava de intervalo em `re_bookings`
(gap lock): com dois inserts no mesmo vão ela termina em deadlock, não em fila.
Edição que troca de espaço trava os dois em ordem de id.

Medido em 08/10/2026: 5 `POST` simultâneos no mesmo horário → 1×201, 4×409.

O 409 (`code: REPP_BOOKING_CONFLICT`) traz só o intervalo ocupado, em
`fields.conflict`, mais `reason` (`overlap` | `setup`), `setup_minutes` e
`blocked` (a reserva existente ± folga). Escrita que perde corrida de estado
(alguém aprovou ou cancelou no meio) → 409 `REPP_BOOKING_STALE`.

## Regras de agenda (decisões do Hygor, 15/10/2026)

Código: `domain/repp/booking-window.rules.js`. "Quem administra" = admin do
espaço ou dono do sistema (o mesmo critério da aprovação automática).

| Regra | Vale para | Configuração | Recusa |
|---|---|---|---|
| Dia da semana bloqueado | quem não administra | `re_spaces.blocked_weekdays` (`'2,4'`, ISO 1=seg…7=dom) | 400 `REPP_BOOKING_WEEKDAY_BLOCKED` |
| Data liberada num dia bloqueado | exceção ao bloqueio | `re_space_unblocked_dates` (rotas abaixo) | — |
| Início ≥ agora + 24h | quem não administra | `MIN_ADVANCE_HOURS` | 400 `REPP_BOOKING_TOO_SOON` |
| Data ≤ mesmo dia daqui a 2 meses (31/12 → 28/02) | quem não administra | `MAX_ADVANCE_MONTHS` | 400 `REPP_BOOKING_TOO_FAR` |
| Folga de organização antes e depois de cada reserva | **todo mundo** | `re_spaces.setup_minutes` | 409 `REPP_BOOKING_CONFLICT` com `reason: 'setup'` |

Hoje só o Auditório tem regra: terça e quinta bloqueadas, 60 min de folga.

- A folga entra na checagem de conflito, sob a trava, com `setup_minutes` lido
  na própria linha travada: a busca é na janela `[início − folga, fim + folga)`
  presa ao dia, e a recusa prefere a sobreposição de verdade à que só invade a
  folga. **A aprovação não reaplica a folga** — o pedido já passou por ela ao
  ser criado, e pedido anterior à regra não pode ficar impossível de aprovar.
- **Edição só reaplica o que mudou:** 24h quando muda o início (espaço, data ou
  hora de início); 2 meses e dia da semana quando muda o dia (espaço ou data).
  Mudar só o título ou só o fim não esbarra nas 24h; reserva que já está numa
  terça pode mudar de horário.
- **Liberar data:** `POST /spaces/:id/unblocked-dates { date }` e
  `DELETE /spaces/:id/unblocked-dates/:date`, só admin do espaço/dono, as duas
  idempotentes e devolvendo o espaço no formato do `GET /spaces`. Só data de
  hoje em diante e num dia bloqueado do espaço (`REPP_DATE_NOT_BLOCKED`).
  Rebloquear não cancela reservas já feitas na data.
- `GET /spaces` devolve, por espaço: `blocked_weekdays`, `unblocked_dates`
  (de hoje em diante), `setup_minutes`, `min_booking_at`
  (`YYYY-MM-DDTHH:MM`, sem fuso), `max_booking_date` e `booking_rules_exempt`.
  Para quem administra, `min_booking_at`/`max_booking_date` = `null`.

## Erros

Todo `AppError` da suite leva `code` do enum `ReppErrorCode`
(`domain/repp/repp.enums.js`) — nenhum sai como `GENERIC_ERROR`, e um teste
falha se aparecer um sem código. `BadRequestError` não é usado porque o
construtor dele não aceita `code`. O que ainda sai `GENERIC_ERROR` é o
`validate.middleware` comum (formato de campo do corpo) e o 401 do
`auth.middleware`, iguais aos de qualquer outra rota.

## Empresa, filial e centro de custo

O front escolhe pelos seletores que já existem (`/protheus/companies`,
`/branches/:code`, `/cost-centers/:code`); ausentes, `null` ou vazios no `POST` = os da sessão (no `PUT`, = os da reserva).
Sem vínculo nem na sessão (login não achou o colaborador no Protheus) →
400 `REPP_ORGANIZATION_UNKNOWN`.
O backend valida os **códigos** no Protheus (`SYS_COMPANY`, `CTTxx0`, pool
`config/protheus`) e grava código + descrição do momento. Descrição vinda do
corpo é ignorada.

## Autenticação opcional

`middlewares/optional-auth.middleware.js` — usa o mesmo
`authenticateFromCookies` e renova o cookie como o `auth.middleware`, mas
nunca responde erro: sem sessão, sessão inválida, usuário inativo ou com troca
de senha pendente seguem anônimos. O `auth.middleware` não foi alterado.

## Datas

`booking_date`/`start_time`/`end_time` são hora local de parede e saem como
texto (`DATE_FORMAT`/`TIME_FORMAT`). Auditoria (`created_at` etc.) sai por
`localDateTime()`, sem fuso. "Passado" compara com o relógio do processo
(container em `America/Sao_Paulo`).

## Minhas reservas

`GET /spaces/bookings/mine?status=&start=&end=&space_id=&page=&limit=` — as
que o usuário criou, em **qualquer** status (é onde ele encontra a recusada ou
cancelada), mais recentes primeiro, paginadas no padrão
`domain/shared/pagination.rules.js` (50 por página, teto 200). Sem o teto de
62 dias da agenda: exige login e é paginada. `status` aceita vários separados
por vírgula (`REPP_INVALID_STATUS` se vier um desconhecido).

## Notificações (decisões do Hygor, 08/10/2026)

| `action` | Quando | Para quem |
|---|---|---|
| `canceled` / `approved` / `rejected` / `updated` | outra pessoa age na reserva | criador |
| `requested` | reserva vira pendente (pedido novo ou remarcação do criador) | administradores ativos do espaço |
| `created` | reserva nova que já nasce aprovada (criada por admin/dono) — 15/10/2026 | administradores ativos do espaço |

- Quem agiu nunca recebe o próprio aviso.
- Toda reserva **nova** gera exatamente um aviso por administrador do espaço:
  `requested` se nasce pendente, `created` se nasce aprovada — nunca os dois.
  Remarcação feita por admin não gera `created` (não é reserva nova).
- **Gravado sempre**, para todos os destinatários, em `re_notifications`, na
  MESMA transação da ação: não existe ação concluída sem aviso. Ação que
  falha (409, 400) não grava nada.
- Depois do commit sai um `repp:event` por destinatário (`POST WS_EMIT_URL`
  com `toUserId`, mesmo caminho do GTPP) com o **mesmo `id`** da linha, para o
  front não duplicar. Sem esperar e sem poder falhar a ação.
- **Ler e confirmar**, diferente do `gt_notify` do GTPP (que apaga no GET):
  `GET /spaces/notifications` devolve as não lidas (até 200) e não mexe em
  nada; `PATCH /spaces/notifications/read { ids }` marca — idempotente, id de
  outra pessoa é ignorado. Consumir no GET perderia o aviso num reload antes de
  ler, e o `StrictMode` do front descarta a primeira resposta em dev.
- `payload` é snapshot (espaço, data, horário, título, solicitante, quem agiu,
  motivo e, em `updated`/`requested` de remarcação, `previous` com o horário
  antigo): remarcar depois não reescreve aviso não lido.
- **Retenção:** lidas há mais de 30 dias são apagadas pela própria API, em
  lote de 1000, a cada `PATCH .../read`. Sem agendador de propósito: a API roda
  em cluster de 2 e um job de intervalo rodaria duplicado; o DELETE é
  idempotente.

## Pontas soltas

- Não há tela/rota para cadastrar espaço (só SQL). Administrador tem rota
  desde 16/10/2026.
- A agenda pública não lista recusadas/canceladas (o criador as vê em
  `/bookings/mine`).
- Sem horário de funcionamento nem passo mínimo.
- Dias bloqueados e folga só se configuram por SQL em `re_spaces`.
- O dono do sistema (`SYSTEM_OWNER`) não recebe `requested`/`created` — só
  quem está em `re_space_admins`. **Decisão do Hygor, 16/10/2026**: fica
  assim (são 7 donos ativos; todos receberiam todo pedido dos dois espaços).
