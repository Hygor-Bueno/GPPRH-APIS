# GIPP — trilha de auditoria da compra de folga

Como o backend informa ao SQL Server **quem** mudou o status de uma jornada, e
como validar isso à mão. Levantado e implementado em 21/08/2026.

## O problema que isso resolve

`dbo.trg_cf_work_schedules_status_history` grava uma linha em
`cf_work_schedule_status_history` a cada INSERT em `cf_work_schedules` e a cada
UPDATE que muda `id_status_fk`. O trigger não recebe parâmetro: ele lê
`SESSION_CONTEXT`. O backend nunca setava esse contexto, então **todo** evento
gerado pela API nascia assim:

```text
changed_by_global_user_id = NULL
change_source             = DIRECT_DATABASE   -- default do COALESCE no trigger
change_reason             = NULL
```

## As seis chaves

| Chave | Origem | Coluna de destino |
|---|---|---|
| `global_user_id` | `req.user.id` | `changed_by_global_user_id` |
| `user_name` | `req.user.name` | `changed_by_name_snapshot` ¹ |
| `user_registration` | `req.user.registration` | `changed_by_registration_snapshot` ¹ |
| `user_branch` | `req.user.branch_code` | `changed_by_branch_snapshot` ¹ |
| `change_source` | `CHANGE_SOURCE.*` | `change_source` |
| `change_reason` | `CHANGE_REASON.*` | `change_reason` |

¹ **As três colunas ainda não existem** e o trigger implantado não lê essas três
chaves. O backend as envia de qualquer forma — o SQL Server ignora chave não
lida, sem erro. Aplicando `alter-status-history-actor-snapshots.sql` (na pasta de
scripts do usuário) elas passam a ser preenchidas sem mudança de código. Esse
script foi reescrito em 26/08/2026 para acompanhar a coluna `changed_at_local` —
a versão anterior falharia.

`req.user` vem do cookie HttpOnly e foi carimbado no login a partir de
`sp_get_user_authorization` + Protheus. **Nada disso vem do corpo da
requisição.**

## Por que batch único e não transação

`SESSION_CONTEXT` pertence à conexão física, e cada `pool.request()` do `mssql`
pega uma conexão qualquer do pool. Setar o contexto num request e fazer o UPDATE
em outro é sorteio.

A saída óbvia seria `sql.Transaction` (que prende uma conexão), mas ela **não
serve para as procedures deste fluxo**: `prc_insert_cf_time_records` e
`pcr_process_work_schedules` abrem `BEGIN TRANSACTION` próprio e dão `ROLLBACK`
no `CATCH` delas. Em SQL Server o ROLLBACK aninhado desfaz **todas** as
transações e zera `@@TRANCOUNT`; o `COMMIT` do Node depois estoura erro 3902 e
mascara o erro real da procedure.

Então o mecanismo é `withAuditContext`: um único `request.query()` com tudo no
mesmo batch — que por definição roda inteiro numa só conexão física.

```text
EXEC sp_set_session_context × 6      ← contexto
BEGIN TRY
    <UPDATE ou EXEC da procedure>
    SELECT @@ROWCOUNT AS affected_rows
END TRY
BEGIN CATCH
    EXEC sp_set_session_context × 6 (NULL)   ← limpeza no erro
    THROW                                     ← preserva a mensagem original
END CATCH
EXEC sp_set_session_context × 6 (NULL)       ← limpeza no sucesso
```

A limpeza é obrigatória: a conexão volta ao pool com o contexto que tiver, e
`ROLLBACK` **não** desfaz `SESSION_CONTEXT`. Por isso também não se usa
`@read_only = 1` — impediria a limpeza, e a sessão de uma conexão de pool dura
horas.

`sql.Transaction` continua disponível em `withAuditTransaction`, para operações
atômicas entre si que **não** chamem essas procedures.

## Base de tempo do histórico: hora LOCAL

**Aplicado em 26/08/2026.** A coluna de data da tabela de auditoria guarda **hora
local**, a mesma base de `cf_time_records.created_at`. O nome é
`changed_at_local` — a base de tempo fica declarada no nome de propósito, porque
foi justamente uma coluna de data sem base explícita que gerou a confusão
descrita abaixo. A coluna `changed_at_utc` **não existe mais**.

Script: `converte-historico-para-hora-local.sql` (17.877 linhas convertidas,
trigger trocado para `SYSDATETIME()`, tudo numa transação só). Ele tem guarda de
idempotência: rodar de novo aborta, para não subtrair 3 horas duas vezes.

Validado na aplicação: um UPDATE que reatribui o mesmo status executa sem erro e
não gera evento — prova que o trigger compila com o nome novo e que a regra
"update sem mudança de status não gera histórico" segue valendo.

⚠️ **O que se perde, e foi aceito conscientemente:** se o horário de verão voltar,
a hora da mudança acontece duas vezes e dois eventos distintos ficam com carimbo
idêntico, sem ordem definida. E se o fuso do servidor mudar, os registros antigos
passam a significar outro instante. Era o argumento a favor de UTC; a legibilidade
no dia a dia pesou mais.

### O histórico da confusão (só para contexto — não é mais o estado atual)

Até 26/08/2026 a tabela guardava UTC na coluna `changed_at_utc`, enquanto
`cf_time_records.created_at` guardava hora local (`GETDATE()`). Quem olhava as
duas lado a lado via 3 horas de diferença e concluía que uma estava errada —
quando as duas estavam certas e o intervalo real entre os registros era de 1 a 3
MILISSEGUNDOS. Exemplo do mesmo evento: `created_at = 11:15:33.210` e
`changed_at_utc = 14:15:33.213`.

Foram tentados dois caminhos antes do atual: uma view de leitura
(`view-status-history-local-time.sql`) e uma coluna computada
(`fix-historico-hora-local-definitivo.sql`). Os dois resolviam a leitura mas
mantinham a coluna UTC visível. **Os dois estão obsoletos** — não aplique
nenhum deles.

Se um dia for preciso converter entre fusos numa consulta, o caminho é
`AT TIME ZONE` (que respeita o histórico de DST), nunca
`DATEADD(HOUR, -3, ...)`, que erra em qualquer data anterior a 2019:

```sql
<coluna> AT TIME ZONE 'E. South America Standard Time' AT TIME ZONE 'UTC'
```

## Rotas cobertas

| Rota | Transição | `change_source` | `change_reason` |
|---|---|---|---|
| `POST /gipp/time-records` (tipo 1) | — → 1 (`INITIAL_STATE`) | `BACKEND` | Compra de folga criada |
| `POST /gipp/time-records` (tipo 4) | 1 → 2 | `BACKEND` | Compra de folga enviada para aprovação |
| `PATCH /gipp/time-records/approve` | 2 → 3 | `BACKEND` | Compra de folga aprovada pelo gerente |
| `POST /gipp/payments` | 3 → 6 | `BACKEND` | Cálculo financeiro iniciado |
| `PATCH /gipp-rh/treasury/confirm` | 6 → 4 | `BACKEND` | Pagamento concluído |
| `PATCH /gipp/time-records/discard` | 1\|2\|3 → 5 | `BACKEND` | Compra de folga cancelada |
| reversão de fechamento (interna) | 6 → 3 | `FINANCIAL_JOB` | Cálculo financeiro revertido — recibo não gerado |

`PUT /gipp/time-records` não altera `cf_work_schedules` e por isso não gera
evento — mas atualiza os snapshots da marcação junto com o `id_global`.

## De quem são os snapshots de `cf_time_records`

**Do usuário de `id_global`, que neste banco é quem LANÇOU a marcação** — não o
colaborador da jornada. O colaborador é `cf_work_schedules.employee_id` +
`branch_time_record`.

Evidência levantada em 21/08/2026: 29 valores distintos de `id_global` contra
1.247 `employee_id`; as 66.457 linhas já preenchidas têm 28 matrículas
distintas; `vw_employee_work_summary` projeta a coluna como
`launched_by -- id_global de quem lancou a entrada`; e
`prc_update_cf_time_records` sobrescreve `id_global` com quem editou.

---

# Roteiro de validação manual

Não há ambiente de integração com SQL Server nos testes automatizados (o pool é
dublê). Estes passos cobrem o que só o banco real prova. Rode em homologação, ou
em produção com uma jornada de teste que você possa cancelar depois.

## 0 — Pré-requisito ⚠️ ORDEM OBRIGATÓRIA

**Aplique `alter-prc-cf-time-records-snapshots.sql` ANTES de subir o backend.**

O backend já envia os dois parâmetros novos. Contra a procedure atual o SQL
Server recusa a chamada inteira — `"Procedure or function
prc_insert_cf_time_records has too many arguments specified."` (verificado
contra o banco em 21/08/2026). Subir o backend primeiro derruba
`POST /gipp/time-records` por completo.

A ordem inversa é segura: os parâmetros novos têm default `NULL`, então a
procedure nova funciona com o backend antigo.

Confirmar depois de aplicar:

```sql
SELECT o.name AS proc_name, p.name AS param, TYPE_NAME(p.user_type_id) AS type
FROM sys.parameters p JOIN sys.objects o ON o.object_id = p.object_id
WHERE o.name IN ('prc_insert_cf_time_records','prc_update_cf_time_records')
ORDER BY o.name, p.parameter_id;
```

Esperado: `@registration_snapshot varchar` e `@branch_code_snapshot varchar` nas
duas.

## 1 — Marcação nova recebe os snapshots, com zeros à esquerda

`POST /gipp/time-records` com `id_record_type_fk = 1`, autenticado como um
encarregado cuja matrícula comece com zero.

```sql
SELECT TOP (5) id_time_records, cod_work_schedule, id_global,
       registration_snapshot, branch_code_snapshot, created_at
FROM GIPP.dbo.cf_time_records
ORDER BY id_time_records DESC;
```

- [ ] `registration_snapshot` = matrícula do **lançador**, 6 caracteres, zeros preservados
- [ ] `branch_code_snapshot` = filial do lançador, 4 caracteres
- [ ] `id_global` = id do lançador
- [ ] os snapshots **não** batem com o `employee_id` da jornada (confira em `cf_work_schedules`)

## 2 — INITIAL_STATE com responsável

Mesma requisição do passo 1.

```sql
SELECT TOP (5) * FROM GIPP.dbo.cf_work_schedule_status_history
ORDER BY id_status_history DESC;
```

- [ ] `event_type = INITIAL_STATE`, `previous_status_id IS NULL`, `new_status_id = 1`
- [ ] `changed_by_global_user_id` = id do lançador — **não NULL**
- [ ] `change_source = BACKEND` — **não `DIRECT_DATABASE`**
- [ ] `change_reason = 'Compra de folga criada'` (e não o genérico `'Marcação criada.'`)

## 3 — STATUS_CHANGED 1 → 2 na saída

`POST /gipp/time-records` com `id_record_type_fk = 4` para o mesmo colaborador.

- [ ] evento `STATUS_CHANGED`, `1 → 2`
- [ ] `change_reason = 'Compra de folga enviada para aprovação'`
- [ ] responsável preenchido

## 4 — Aprovação em lote gera um evento por jornada

`PATCH /gipp/time-records/approve` com 3+ jornadas em status 2, como gerente.

- [ ] 3 eventos `2 → 3`, um por jornada
- [ ] todos com o **mesmo** `changed_by_global_user_id` (o gerente) e
      `change_reason = 'Compra de folga aprovada pelo gerente'`

## 5 — Update sem mudança de status não gera evento

```sql
-- Conte antes
SELECT COUNT(*) FROM GIPP.dbo.cf_work_schedule_status_history;

-- Reatribui o MESMO status
UPDATE GIPP.dbo.cf_work_schedules
SET id_status_fk = id_status_fk
WHERE cod_work_schedule = '<jornada de teste>';

-- Conte depois
SELECT COUNT(*) FROM GIPP.dbo.cf_work_schedule_status_history;
```

- [ ] a contagem não muda (o `WHERE d.id_status_fk <> i.id_status_fk` do trigger barra)

## 6 — Rollback não deixa histórico órfão

Provoque falha depois da mudança de status na mesma transação — por exemplo
`POST /gipp/payments` para uma jornada sem valores calculáveis, que cai na
reversão `6 → 3`.

- [ ] não existe evento cujo `new_status_id` corresponda a um status que a
      jornada não tem hoje em `cf_work_schedules`
- [ ] a sequência de eventos fecha: `3 → 6` seguido de `6 → 3` com
      `change_source = FINANCIAL_JOB`

## 7 — Contexto não vaza entre requisições do pool ⚠️ o mais importante

Duas requisições de **usuários diferentes**, uma imediatamente após a outra
(ou em paralelo), na mesma instância. Ex.: gerente A aprova a jornada X, gerente
B aprova a jornada Y.

```sql
SELECT TOP (10) cod_work_schedule, changed_by_global_user_id, changed_at_local
FROM GIPP.dbo.cf_work_schedule_status_history
ORDER BY id_status_history DESC;
```

- [ ] a jornada X está assinada por A e a Y por B — **nunca as duas por A**

Repita algumas vezes: o pool tem 20 conexões por instância, e o vazamento só
apareceria quando a conexão é reaproveitada. Este é o teste que a suíte
automatizada não consegue fazer.

## 8 — Exceção limpa o contexto

Force um erro de regra: `POST /gipp/time-records` com saída (tipo 4) sem entrada
correspondente — a procedure lança `RAISERROR`.

- [ ] a resposta é 409 com mensagem em português (a tradução do
      `sqlserver-error.translator` continua funcionando, ou seja, o `THROW;`
      preservou a mensagem original)
- [ ] a requisição **seguinte**, de outro usuário, grava o responsável correto
      (o contexto foi limpo pelo `BEGIN CATCH`)

## 9 — Nenhuma origem anônima sobrou

Depois de exercitar todas as rotas:

```sql
SELECT change_source, event_type, COUNT(*) AS qtd,
       SUM(CASE WHEN changed_by_global_user_id IS NULL THEN 1 ELSE 0 END) AS sem_usuario
FROM GIPP.dbo.cf_work_schedule_status_history
WHERE changed_at_local >= '<data do deploy>'
GROUP BY change_source, event_type
ORDER BY 3 DESC;
```

- [ ] zero linhas com `change_source = 'DIRECT_DATABASE'` no período
- [ ] `sem_usuario = 0` para tudo que veio de rota (`BACKEND`)

`DIRECT_DATABASE` depois do deploy significa **escrita fora da API** — alguém no
SSMS, um job, ou um caminho de código que ainda não passa pelo contexto.

## 10 — Marcações ainda nascendo sem snapshot

```sql
SELECT CONVERT(VARCHAR(7), created_at, 120) AS mes, COUNT(*) AS qtd
FROM GIPP.dbo.cf_time_records
WHERE registration_snapshot IS NULL OR branch_code_snapshot IS NULL
GROUP BY CONVERT(VARCHAR(7), created_at, 120)
ORDER BY 1 DESC;
```

Em 21/08/2026 havia 58 linhas, todas de `2026-08`. Depois do deploy esse número
não deve crescer. Se crescer, existe um inserter fora da API.
