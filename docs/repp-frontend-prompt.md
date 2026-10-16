# Prompt para o agente de frontend — REPP (Reserva de Espaços)

> Copie tudo abaixo da linha para o agente do frontend.

---

# Tarefa: tela de Reserva de Espaços (frontend)

## Contexto

A empresa tem 2 espaços compartilhados: **Sala de Treinamento** e **Auditório**.
Hoje as reservas são controladas em planilha pela administradora de cada espaço.
O backend já está pronto: qualquer pessoa vê a agenda, qualquer usuário logado
pede uma reserva, e o administrador do espaço (ou o dono do sistema) aprova.

Stack: React + TypeScript + Vite, PWA. **Siga a estrutura de módulos que já
existe no projeto** (pastas, cliente HTTP, padrão de hooks/serviços, componentes
de UI, rotas, tratamento de erro, tema). Não crie arquitetura nova.

## Regras de trabalho (obrigatórias)

1. **Antes de escrever código**, analise a estrutura atual do front e me
   apresente: onde o módulo vai morar, quais componentes/hooks existentes vai
   reaproveitar e como a rota pública vai conviver com as rotas que exigem login.
2. **Sugestões** de melhoria ou de regra extra: liste e **peça meu "de acordo"
   antes de implementar**. Nada fora do escopo sem aprovação.
3. Mudanças mínimas, de baixo risco, próximas dos padrões existentes. Código
   completo, sem trechos parciais.

## ⚠️ Toda a regra de visibilidade e permissão já está no BACKEND

- O front **não decide** quem vê o quê. Ele renderiza o que recebe.
- Reserva que o usuário não pode ver chega **sem** os campos sensíveis (a chave
  nem existe — não é `null`). Não tente "esconder" campos no front: eles não vêm.
- Para mostrar/esconder ações, use **só** as flags que vêm em cada objeto:

| Flag | Onde | Significa |
|---|---|---|
| `can_view_details` | reserva, espaço | os campos completos vieram |
| `can_manage` | reserva, espaço | pode **editar** e **cancelar** |
| `can_review` | reserva, espaço | pode **aprovar** e **recusar** |
| `can_book` | espaço | está logado — pode pedir reserva |
| `requires_approval` | espaço | o pedido dele vai para aprovação (avise antes de enviar) |

Nunca reproduza no front regra do tipo "se for admin…" ou "se a data passou…":
as flags já consideram espaço, autoria, status e se a reserva já começou.

## API

- Base: `https://gigpp.com.br:73/api/v1` (a mesma base que o front já usa para
  `/global`).
- Autenticação **só por cookie HttpOnly** — requisições com
  `credentials: 'include'` (como o cliente HTTP do projeto já faz). Não existe
  Bearer token.
- Envelope de sucesso: `{ "error": false, "data": ... }`.
- Envelope de erro: `{ "error": true, "message": "...", "code": "...", "fields": ... }`.
  `message` é em português e pode ser mostrada ao usuário; decida comportamento
  por `code`/status, nunca casando texto.
- Datas e horas da reserva são **texto local**, sem fuso: `booking_date`
  `"2026-10-20"`, `start_time`/`end_time` `"09:00"`. Não converta para `Date`
  com fuso — trate como hora de parede. Carimbos de auditoria (`created_at`,
  `reviewed_at`...) vêm como `"2026-10-08T14:18:13"` (local, sem `Z`).

### Status da reserva

| `status` | Significado | Aparece na agenda? |
|---|---|---|
| `pending` | aguardando aprovação — **já ocupa o horário** | sim |
| `approved` | confirmada | sim |
| `rejected` | recusada — horário liberado | não (só por `GET /:id`, para quem vê detalhes) |
| `canceled` | cancelada — horário liberado | não (só por `GET /:id`, para quem vê detalhes) |

Regras que o backend aplica (só para você saber explicar na UI):
- Quem administra o espaço (ou é dono do sistema) reserva direto (`approved`).
  Os demais criam `pending`.
- Se o **criador** trocar data, horário ou espaço de uma reserva, ela volta para
  `pending` e precisa de nova aprovação. Trocar só título/solicitante/empresa
  não muda o status.
- Reserva que já começou não pode ser editada nem cancelada.

---

### 1. `GET /global/spaces` — público

Espaços ativos, com as flags de quem consulta. Sem login, `can_book: false`.

Resposta (logado como administradora do Auditório):

```json
{
  "error": false,
  "data": [
    {
      "id": 2,
      "name": "Auditório",
      "description": null,
      "can_view_details": true,
      "can_manage": true,
      "can_review": true,
      "can_book": true,
      "requires_approval": false
    },
    {
      "id": 1,
      "name": "Sala de Treinamento",
      "description": null,
      "can_view_details": false,
      "can_manage": false,
      "can_review": false,
      "can_book": true,
      "requires_approval": true
    }
  ]
}
```

### 2. `GET /global/spaces/me/managed` — exige login

Espaços que o usuário administra (dono do sistema: todos). Mesmo formato do
item acima. Lista vazia = não administra nada → não mostre a área de aprovação.

### 3. `GET /global/spaces/bookings?start=YYYY-MM-DD&end=YYYY-MM-DD&space_id=` — público

Reservas `pending` e `approved` do intervalo, ordenadas por data, início e
espaço. `start` e `end` obrigatórios, **no máximo 62 dias** (contando as duas
pontas). `space_id` opcional (filtro de local).

Cada item vem em **uma de duas formas**, decidida pelo backend:

**Mascarada** (anônimo, ou quem não administra aquele espaço nem criou a reserva):

```json
{
  "id": 1,
  "space_id": 2,
  "space_name": "Auditório",
  "booking_date": "2026-10-20",
  "start_time": "09:00",
  "end_time": "10:30",
  "status": "approved",
  "can_view_details": false,
  "can_manage": false,
  "can_review": false
}
```

**Completa** (administrador do espaço, dono do sistema ou o próprio criador):

```json
{
  "id": 3,
  "space_id": 1,
  "space_name": "Sala de Treinamento",
  "booking_date": "2026-10-20",
  "start_time": "16:00",
  "end_time": "17:00",
  "status": "pending",
  "title": "Integração de novos colaboradores",
  "requester_name": "FABRICIO ALVES SILVA",
  "company_code": "02",
  "company_name": "PEG PESE SUPERMERCADOS",
  "branch_code": "0201",
  "branch_name": "PEG PESE CEASA",
  "cost_center_code": "100001",
  "cost_center_description": "MOPRODUCAO",
  "created_by": 203,
  "created_by_name": "FABRICIO ALVES SILVA",
  "created_at": "2026-10-08T14:18:13",
  "updated_by": null,
  "updated_by_name": null,
  "updated_at": "2026-10-08T14:18:13",
  "reviewed_by": null,
  "reviewed_by_name": null,
  "reviewed_at": null,
  "review_note": null,
  "canceled_by": null,
  "canceled_by_name": null,
  "canceled_at": null,
  "cancel_reason": null,
  "can_view_details": true,
  "can_manage": true,
  "can_review": true
}
```

Resposta da lista:

```json
{
  "error": false,
  "data": {
    "start": "2026-10-19",
    "end": "2026-10-25",
    "space_id": null,
    "items": [ /* objetos nas duas formas acima, misturados */ ]
  }
}
```

Tipagem sugerida: uma união discriminada por `can_view_details`
(`MaskedBooking | DetailedBooking`).

### 4. `GET /global/spaces/bookings/:id` — público

Mesmo mascaramento da lista. Quem não vê detalhes recebe **404** para reserva
`rejected`/`canceled`; quem vê, recebe com o status.

### 5. `GET /global/spaces/bookings/pending` — exige login + administrar espaço

Fila de aprovação: pendentes que ainda não começaram, dos espaços que o usuário
administra (dono: todos). Lista de objetos **completos**. **403** para quem não
administra nenhum espaço.

### 6. `POST /global/spaces/bookings` — exige login

```json
{
  "space_id": 2,
  "booking_date": "2026-10-20",
  "start_time": "09:00",
  "end_time": "10:30",
  "title": "Treinamento de segurança",
  "requester_name": "MARIA DA SILVA",
  "company_code": "02",
  "branch_code": "0201",
  "cost_center_code": "100001"
}
```

- Obrigatórios: `space_id`, `booking_date`, `start_time`, `end_time`, `title`
  (até 150).
- `requester_name` (até 150): se omitido, vira o nome do usuário logado.
  Pré-preencha com o nome da sessão, editável (admin pode reservar para outra pessoa).
- `company_code` (2 dígitos), `branch_code` (4 dígitos), `cost_center_code`:
  se omitidos, `null` ou vazios, vêm da sessão. **São texto, com zero à esquerda — nunca número.**
  Pré-preencha com os dados da sessão (`/global/me` já traz `company_code`,
  `branch_code`, `cost_center_code`) e deixe trocar pelos seletores que já
  existem no projeto:
  - `GET /protheus/companies` → `[{ company_code, company_name }]`
  - `GET /protheus/branches/:companyCode` → `[{ branch_code, branch_name, ... }]`
  - `GET /protheus/cost-centers/:companyCode` → `[{ costCenterCode, costCenterDescription }]`
    (atenção: este vem em camelCase)
- O backend valida os códigos no Protheus e grava as descrições; não envie
  `company_name` etc. (são ignorados).

Resposta **201**: o objeto completo (forma 3), com `status` `approved` ou
`pending`.

### 7. `PUT /global/spaces/bookings/:id` — exige login + `can_manage`

Mesmos campos do POST, **todos opcionais** (ausente = mantém). Resposta 200 com
o objeto completo. Se o `status` voltar como `pending` depois de uma troca de
horário, avise: "Sua alteração foi enviada para aprovação". Antes de salvar uma
troca de data/horário/espaço numa reserva aprovada de quem tem
`requires_approval` no espaço, **confirme** com o usuário que ela voltará a
depender de aprovação.

### 8. `PATCH /global/spaces/bookings/:id/cancel` — exige login + `can_manage`

Corpo opcional `{ "reason": "até 255 caracteres" }`. Resposta 200 com o objeto
completo (`status: "canceled"`). Peça confirmação antes.

### 9. `PATCH /global/spaces/bookings/:id/approve` — exige login + `can_review`

Sem corpo. Resposta 200 (`status: "approved"`, `reviewed_by`, `reviewed_at`).

### 10. `PATCH /global/spaces/bookings/:id/reject` — exige login + `can_review`

Corpo opcional `{ "reason": "..." }` (vira `review_note`). Resposta 200
(`status: "rejected"`).

### Erros

Todo erro da REPP vem com um `code` próprio — **decida o comportamento por
ele**, nunca pelo texto de `message` (que pode ser exibido ao usuário).

| Status | `code` | Quando | O que a UI faz |
|---|---|---|---|
| 400 | `REPP_INVALID_DATE` | data ausente/inválida (`booking_date`, `start`, `end`) | erro no campo |
| 400 | `REPP_INVALID_TIME` | hora inválida | erro no campo |
| 400 | `REPP_INVALID_TIME_RANGE` | fim ≤ início | erro no campo de fim |
| 400 | `REPP_INVALID_DATE_RANGE` | `end` antes de `start` na agenda | bug do front — corrigir a chamada |
| 400 | `REPP_DATE_RANGE_TOO_LONG` | agenda com mais de 62 dias | bug do front — pedir só a semana |
| 400 | `REPP_INVALID_SPACE_ID` | `space_id` inválido | bug do front |
| 400 | `REPP_REQUIRED_FIELD` | campo obrigatório vazio (ex.: título só com espaços) | erro no campo |
| 400 | `REPP_FIELD_TOO_LONG` | texto acima do limite | erro no campo |
| 400 | `REPP_INVALID_ORGANIZATION_CODE` | empresa ≠ 2 dígitos / filial ≠ 4 dígitos | erro no seletor |
| 400 | `REPP_ORGANIZATION_UNKNOWN` | não veio no corpo e a sessão não tem vínculo no Protheus | destacar os seletores de empresa/filial/CC |
| 400 | `REPP_COMPANY_NOT_FOUND` | empresa não existe no Protheus | erro no seletor de empresa |
| 400 | `REPP_BRANCH_NOT_FOUND` | filial não pertence à empresa | erro no seletor de filial |
| 400 | `REPP_COST_CENTER_NOT_FOUND` | centro de custo não existe na empresa | erro no seletor de centro de custo |
| 400 | `REPP_BOOKING_IN_PAST` | data/hora já passou | "Escolha um horário futuro" |
| 400 | `REPP_SPACE_INACTIVE` | espaço desativado | recarregar `GET /spaces` |
| 400 | `REPP_BOOKING_NOT_EDITABLE` | editar/cancelar reserva que já começou, cancelada ou recusada | mensagem + recarregar |
| 400 | `REPP_BOOKING_ALREADY_STARTED` | aprovar/recusar o que já começou | mensagem + recarregar a fila |
| 400 | `GENERIC_ERROR` | formato de campo do corpo barrado pelo validador comum da API (ex.: `space_id` não numérico) | mostrar `message` |
| 401 | — (`{ error, message }`) | ação sem login / sessão expirada | convidar a fazer login |
| 403 | `REPP_BOOKING_FORBIDDEN` | editar/cancelar sem ser admin do espaço, dono ou criador | mensagem + atualizar a tela |
| 403 | `REPP_REVIEW_FORBIDDEN` | aprovar/recusar sem administrar o espaço | mensagem + atualizar a tela |
| 403 | `REPP_NOT_SPACE_ADMIN` | abrir a fila sem administrar espaço | esconder a fila |
| 404 | `REPP_BOOKING_NOT_FOUND` | reserva não existe (ou recusada/cancelada para quem não vê detalhes) | mensagem e voltar à agenda |
| 404 | `REPP_SPACE_NOT_FOUND` | espaço não existe | recarregar `GET /spaces` |
| 409 | `REPP_BOOKING_CONFLICT` | **conflito de horário** | ver abaixo |
| 409 | `REPP_BOOKING_STALE` | alguém mudou a reserva no meio | "Esta reserva foi alterada por outra pessoa" + recarregar |
| 409 | `REPP_BOOKING_NOT_PENDING` | aprovar/recusar o que não está mais pendente | recarregar a fila |
| 500 | `REPP_MYSQL_ERROR` / `REPP_PROTHEUS_ERROR` | falha interna / Protheus fora | erro genérico com "tentar de novo" |

O 401 vem do middleware de autenticação comum da API, com o mesmo formato de
todas as outras rotas (sem `code`).

Exemplo real de 409 de conflito — traz **só** o intervalo ocupado, nunca quem reservou:

```json
{
  "error": true,
  "message": "O horário conflita com uma reserva existente das 09:00 às 10:30.",
  "code": "REPP_BOOKING_CONFLICT",
  "fields": { "conflict": { "start_time": "09:00", "end_time": "10:30" } }
}
```

Tratamento amigável: manter o formulário preenchido, destacar no calendário o
intervalo `fields.conflict` e sugerir escolher outro horário; recarregar a
agenda (alguém pode ter acabado de reservar).

---

## Foco: UI/UX

1. **Rota pública.** A agenda tem que abrir **sem login** — garanta que o guard
   de rotas do projeto não redirecione para o login nesta tela. As ações
   (reservar, editar, aprovar) exigem login.
2. **Calendário semanal grande** como tela principal:
   - colunas = dias da semana, linhas = horários;
   - blocos de reserva posicionados e dimensionados por `start_time`/`end_time`;
   - sobreposição visual entre espaços diferentes quando o filtro mostra os dois
     (as reservas de um mesmo espaço nunca se sobrepõem).
3. **Filtros:**
   - **data:** semana anterior/próxima, "Hoje", e escolher uma data (vai para a
     semana dela). A consulta pede só a semana visível (bem abaixo dos 62 dias);
   - **local:** Sala de Treinamento / Auditório / ambos (`space_id`), com a lista
     vinda de `GET /global/spaces`.
4. **Livre × ocupado** com diferença visual clara. Dentro de ocupado, diferencie
   `pending` ("Aguardando aprovação", estilo mais leve/tracejado) de `approved`.
   Use uma cor por espaço quando os dois estiverem visíveis.
5. **Conteúdo do bloco:**
   - `can_view_details: false` → só "Ocupado" (ou "Aguardando aprovação") e o
     período;
   - `can_view_details: true` → título, solicitante, empresa, filial e centro de
     custo (no bloco o que couber; o resto no detalhe ao clicar).
6. **Clique em horário livre:**
   - logado → abre o formulário com espaço, data e horário pré-preenchidos; se o
     espaço tem `requires_approval: true`, avise no formulário que o pedido vai
     para aprovação da administradora;
   - não logado → convite para fazer login, voltando para a mesma semana/horário
     depois.
7. **Clique numa reserva:** detalhe (drawer/modal) com as ações que as flags
   permitirem — Editar / Cancelar (`can_manage`), Aprovar / Recusar
   (`can_review`, com motivo opcional na recusa).
8. **Fila de aprovação** para quem tem itens em `GET /global/spaces/me/managed`:
   acesso visível (badge com a quantidade de `GET /global/spaces/bookings/pending`),
   listando os pedidos com Aprovar/Recusar.
9. **Responsivo:** no mobile, troque a semana por **visão de dia ou lista**
   (navegação por dia), com o mesmo filtro de local.
10. **Estados:** loading (esqueleto do calendário), vazio ("Nenhuma reserva nesta
    semana" — continua permitindo clicar em horário livre), erro (com "tentar de
    novo"). Após criar/editar/cancelar/aprovar, atualize a semana visível.

## Fora do escopo (não implementar sem meu de acordo)

Cadastro de espaços e administradores, notificações, "minhas reservas",
exibição de canceladas/recusadas na agenda, horário de funcionamento. Se achar
que algo disso é necessário, **sugira e peça "de acordo"**.

## Entrega

Antes de codar: a análise da estrutura e a lista de sugestões. Depois do meu de
acordo: código completo, e um resumo do que foi feito e de como testar
(anônimo, usuário comum, administradora de um espaço, dono do sistema).
