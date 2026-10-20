# Prompt para o agente de frontend — REPP: regras de agenda

> Copie tudo abaixo da linha para o agente do frontend. É a continuação de
> `docs/repp-frontend-prompt.md` e `docs/repp-status-frontend-prompt.md`: a
> agenda, "minhas reservas" e o sino já existem; entram agora as regras de
> agenda e o aviso `created`.
>
> Estado do backend em 16/10/2026: banco já migrado (`re-regras-agenda-deploy.sql`),
> código testado contra o banco real; **as regras só valem em produção depois
> do rebuild do container `api-gipp-enterprises`**. Antes disso, `GET /spaces`
> não traz os campos novos.

---

# Tarefa: regras de agenda da Reserva de Espaços (frontend)

## Contexto

O backend passou a aplicar cinco regras novas nas reservas (`POST` e `PUT`) e
a devolver, em cada espaço, os limites já calculados para quem consulta. O
front **continua sem regra própria**: ele só usa esses limites para avisar
**antes** de a pessoa enviar (desabilitar dia, mostrar o horário mínimo,
pintar a folga) e mostra a `message` do erro quando o backend recusar. Quem
decide é sempre o backend.

As regras (decisões do Hygor, 15/10/2026). "Administrador" = quem já recebe
`can_manage: true` no espaço (administrador do espaço ou dono do sistema):

| # | Regra | Vale para | Hoje |
|---|---|---|---|
| 1 | Dias da semana bloqueados | quem **não** administra | Auditório: terça e quinta. Sala de Treinamento: nenhum |
| 1b | O administrador pode **liberar uma data específica** de dia bloqueado (ex.: uma terça) para todos, e bloquear de novo | — | rotas novas |
| 2 | Folga de organização antes e depois de cada reserva do mesmo dia | **todo mundo**, inclusive administrador | Auditório: 60 min. Sala: 0 |
| 3 | Data até o mesmo dia daqui a 2 meses (hoje 16/10 → até 16/12; 31/12 → 28/02) | quem **não** administra | — |
| 4 | Início pelo menos 24h depois do pedido (data + hora, horário de Brasília) | quem **não** administra | — |
| 5 | Todo administrador do espaço é avisado de **toda** reserva nova | — | action nova `created` |

Stack: React + TypeScript + Vite, PWA. **Siga a estrutura do módulo de reservas
que já existe** (cliente HTTP, hooks/serviços, tipos, componentes, sino,
WebSocket). Não crie arquitetura nova.

## Regras de trabalho (obrigatórias)

1. **Antes de escrever código**, analise o módulo de reservas atual e me
   apresente: onde os limites vão entrar no calendário/formulário, onde fica o
   controle de liberar/bloquear data para o administrador, e quais tipos mudam.
2. **Sugestões** de melhoria ou de regra extra: liste e **peça meu "de acordo"
   antes de implementar**. Nada fora do escopo sem aprovação.
3. Mudanças mínimas, de baixo risco, próximas dos padrões existentes. Código
   completo, sem trechos parciais.
4. **Não reimplemente as regras como fonte de verdade.** Use os campos que a
   API manda; se a API recusar, mostre a `message` como vier.

## API

Mesma base, autenticação (cookie HttpOnly, `credentials: 'include'`) e
envelopes de sempre:

- sucesso: `{ "error": false, "data": ... }`;
- erro: `{ "error": true, "message": "...", "code": "...", "fields": ... }`.
  `message` é em português e vai para a tela como vier. Decida o comportamento
  por `code`/status, nunca comparando o texto.

### 1. `GET /global/spaces` (e `GET /global/spaces/me/managed`) — campos novos

Cada espaço ganhou seis campos, **calculados para quem está consultando**
(público; anônimo também recebe):

| Campo | Tipo | Significado | `null`/vazio quando |
|---|---|---|---|
| `blocked_weekdays` | `number[]` | dias da semana sem reserva comum, ISO: 1 = segunda … 7 = domingo. **Igual para todos**, inclusive o administrador (é com ele que o administrador vê o que pode liberar) | `[]` = nenhum dia bloqueado |
| `unblocked_dates` | `string[]` | datas `YYYY-MM-DD` de dia bloqueado que o administrador liberou, de hoje em diante, em ordem | `[]` = nenhuma |
| `setup_minutes` | `number` | folga livre exigida antes **e** depois de cada reserva do dia | `0` = sem folga |
| `min_booking_at` | `string \| null` | primeiro início aceito, `"YYYY-MM-DDTHH:MM"`, hora local **sem fuso** | `null` = sem limite (administrador) |
| `max_booking_date` | `string \| null` | última data aceita, `"YYYY-MM-DD"` | `null` = sem limite (administrador) |
| `booking_rules_exempt` | `boolean` | `true` = administrador: dias bloqueados, 24h e 2 meses não valem para ele. **A folga vale** | — |

Uma data está **bloqueada para quem consulta** quando:
`!booking_rules_exempt && blocked_weekdays.includes(isoWeekday(data)) && !unblocked_dates.includes(data)`.

`min_booking_at` é o "agora + 24h" do momento da consulta. Se a tela ficar
aberta por muito tempo, ele envelhece: recarregue `GET /spaces` ao focar a aba
ou antes de abrir o formulário (o backend confere de novo de qualquer jeito).

Exemplo para um usuário comum, em 16/10/2026 às 09:30:

```json
{
  "error": false,
  "data": [
    {
      "id": 2,
      "name": "Auditório",
      "description": null,
      "can_view_details": false,
      "can_manage": false,
      "can_review": false,
      "can_book": true,
      "requires_approval": true,
      "blocked_weekdays": [2, 4],
      "unblocked_dates": ["2026-11-10"],
      "setup_minutes": 60,
      "min_booking_at": "2026-10-17T09:30",
      "max_booking_date": "2026-12-16",
      "booking_rules_exempt": false
    },
    {
      "id": 1,
      "name": "Sala de Treinamento",
      "description": null,
      "can_view_details": false,
      "can_manage": false,
      "can_review": false,
      "can_book": true,
      "requires_approval": true,
      "blocked_weekdays": [],
      "unblocked_dates": [],
      "setup_minutes": 0,
      "min_booking_at": "2026-10-17T09:30",
      "max_booking_date": "2026-12-16",
      "booking_rules_exempt": false
    }
  ]
}
```

O mesmo Auditório para a administradora dele:

```json
{
  "id": 2,
  "name": "Auditório",
  "can_view_details": true,
  "can_manage": true,
  "can_review": true,
  "can_book": true,
  "requires_approval": false,
  "blocked_weekdays": [2, 4],
  "unblocked_dates": ["2026-11-10"],
  "setup_minutes": 60,
  "min_booking_at": null,
  "max_booking_date": null,
  "booking_rules_exempt": true
}
```

### 2. `GET /global/spaces/bookings` — sem mudança

Mesmo formato de antes. A folga **não** vem em cada reserva: para pintar o
trecho bloqueado na agenda, use `start_time - setup_minutes` até
`end_time + setup_minutes` do espaço (preso a 00:00 e 23:59). Isso vale também
para reservas mascaradas, que já trazem horário.

```json
{
  "error": false,
  "data": {
    "start": "2026-11-02",
    "end": "2026-11-08",
    "space_id": 2,
    "items": [
      {
        "id": 16,
        "space_id": 2,
        "space_name": "Auditório",
        "booking_date": "2026-11-06",
        "start_time": "14:00",
        "end_time": "15:00",
        "status": "approved",
        "can_view_details": false,
        "can_manage": false,
        "can_review": false
      }
    ]
  }
}
```

Com `setup_minutes: 60`, essa reserva bloqueia de 13:00 a 16:00 para qualquer
outra.

### 3. Liberar e bloquear de novo uma data (só administrador)

Só aparece para quem tem `can_manage: true` no espaço, e só faz sentido em
espaço com `blocked_weekdays` não vazio.

#### `POST /global/spaces/:id/unblocked-dates`

Corpo `{ "date": "2026-11-10" }`. Libera a data para todos. **Idempotente**
(liberar de novo não é erro). Responde **200** com o espaço inteiro, no mesmo
formato do `GET /spaces` (já com `unblocked_dates` atualizado). Use a resposta
para atualizar o estado, sem novo GET.

#### `DELETE /global/spaces/:id/unblocked-dates/:date`

Volta a bloquear. **Idempotente** (data que não estava liberada não é erro).
Responde **200** com o espaço inteiro. **Reservas já feitas na data continuam
valendo**: avise isso na confirmação ("As reservas já feitas neste dia não
serão canceladas").

Erros destas duas rotas:

| Status | `code` | Quando | `fields` |
|---|---|---|---|
| 400 | `REPP_DATE_NOT_BLOCKED` | a data não cai num dia bloqueado do espaço (só no POST) | `{ date, weekday, blocked_weekdays }` |
| 400 | `REPP_BOOKING_IN_PAST` | liberar data anterior a hoje (só no POST) | — |
| 400 | `REPP_INVALID_DATE` | data inexistente (`2026-02-30`) | — |
| 400 | `REPP_SPACE_INACTIVE` | espaço inativo | — |
| 403 | `REPP_NOT_SPACE_ADMIN` | quem chamou não administra o espaço | — |
| 404 | `REPP_SPACE_NOT_FOUND` | espaço não existe | — |
| 400 | `GENERIC_ERROR` | corpo sem `date` ou fora de `YYYY-MM-DD` (validador comum) | — |

### 4. Recusas novas em `POST` e `PUT /global/spaces/bookings`

| Status | `code` | Quando | `message` de exemplo | `fields` |
|---|---|---|---|---|
| 400 | `REPP_BOOKING_WEEKDAY_BLOCKED` | dia bloqueado e não liberado | "O espaço Auditório não aceita reservas às terças-feiras. Fale com o administrador do espaço se precisar desta data." | `{ "booking_date": "2026-11-10", "weekday": 2, "blocked_weekdays": [2, 4] }` |
| 400 | `REPP_BOOKING_TOO_SOON` | início a menos de 24h | "As reservas precisam ser feitas com pelo menos 24 horas de antecedência. O primeiro horário disponível é 17/10/2026 às 09:30." | `{ "min_booking_at": "2026-10-17T09:30" }` |
| 400 | `REPP_BOOKING_TOO_FAR` | data depois do limite de 2 meses | "Só é possível reservar com até 2 meses de antecedência, ou seja, até 16/12/2026." | `{ "max_booking_date": "2026-12-16" }` |
| 409 | `REPP_BOOKING_CONFLICT` | **mudou**: agora também quando invade a folga | ver abaixo | ver abaixo |

`REPP_BOOKING_CONFLICT` ganhou campos (os que existiam continuam iguais):

```json
{
  "error": true,
  "code": "REPP_BOOKING_CONFLICT",
  "message": "Este espaço exige um intervalo de 1 hora entre reservas para organização. Há uma reserva das 14:00 às 15:00, então o intervalo das 13:00 às 16:00 fica bloqueado.",
  "fields": {
    "conflict": { "start_time": "14:00", "end_time": "15:00" },
    "reason": "setup",
    "setup_minutes": 60,
    "blocked": { "start_time": "13:00", "end_time": "16:00" }
  }
}
```

| Campo | Significado |
|---|---|
| `conflict` | a reserva existente que impede (só horário, como antes) |
| `reason` | `"overlap"` = os horários se cruzam; `"setup"` = não se cruzam, mas a nova invade a folga da existente |
| `setup_minutes` | a folga do espaço (`0` em espaço sem folga) |
| `blocked` | `conflict` ± folga: o trecho que ninguém pode ocupar. Com folga 0, igual a `conflict` |

Quando há sobreposição de verdade e também folga invadida, vem `overlap`.
Mensagem de `overlap` (igual à de antes): "O horário conflita com uma reserva
existente das 14:00 às 15:00.".

**Ordem das checagens** (a primeira que falhar responde): formato → passado
(`REPP_BOOKING_IN_PAST`, que vale para todos) → 24h → 2 meses → dia da semana
→ empresa/filial/centro de custo → conflito/folga.

### 5. Aviso novo `created` (sino e WebSocket)

Mesmo formato dos outros avisos, em `GET /global/spaces/notifications` e no
`repp:event` do WebSocket (mesmo `id` nos dois; deduplique por `id`).

| `action` | Quem recebe | Quando |
|---|---|---|
| `requested` | administradores do espaço | reserva **nova que nasce pendente** (pedido de quem não administra), ou remarcação que volta para pendente. **Sem mudança** |
| `created` | administradores do espaço | reserva **nova que já nasce aprovada**: criada por um administrador do espaço ou pelo dono do sistema |

- Toda reserva nova gera **um** aviso por administrador: `requested` **ou**
  `created`, nunca os dois. Então "avisar de toda reserva nova" = tratar as
  duas actions.
- Quem criou não recebe aviso da própria reserva. Na prática, `created` chega
  quando o espaço tem mais de um administrador ou quando o dono do sistema
  reserva num espaço que outra pessoa administra.
- Editar uma reserva aprovada (mesmo trocando o horário) **não** gera
  `created`.

Exemplo no `GET /notifications`:

```json
{
  "id": 91,
  "action": "created",
  "booking_id": 16,
  "space_name": "Auditório",
  "booking_date": "2026-11-06",
  "start_time": "14:00",
  "end_time": "15:00",
  "title": "Reunião de diretoria",
  "requester_name": "HYGOR",
  "by_name": "HYGOR",
  "reason": null,
  "previous": null,
  "by_user_id": 148,
  "created_at": "2026-10-16T09:41:02",
  "read_at": null
}
```

No WebSocket: `{ "event": "repp:event", "payload": { ... } }` com os mesmos
campos, sem `created_at` e `read_at`.

Texto sugerido: "**Nova reserva**: {title} em {space_name}, {data}
{start}–{end}, feita por {by_name}." Clicar abre o detalhe da reserva
(`booking_id`); diferente de `requested`, **não** leva à fila de aprovação
(não há nada a aprovar).

### 6. O que mudou em rotas que já existiam

- `POST /bookings` e `PUT /bookings/:id`: as recusas novas acima, e o 409 por
  folga.
- **`PUT` só reaplica o que mudou**: 24h quando muda o início (espaço, data ou
  hora de início); 2 meses e dia da semana quando muda o dia (espaço ou data).
  Mudar só o título ou só a hora de fim não esbarra nas 24h. Uma reserva que
  já está numa terça pode mudar de horário. A folga é conferida sempre que
  espaço, data ou horário mudam.
- `PATCH /bookings/:id/approve`: **não** aplica a folga (confere só
  sobreposição). Pedido feito antes da regra continua aprovável.
- `GET /spaces` e `GET /spaces/me/managed`: campos novos; os antigos não
  mudaram.
- `GET /notifications` e `repp:event`: podem trazer `action: "created"`. Se o
  front tem um `switch` fechado nas actions, inclua o caso novo.
- Nenhum campo foi removido nem mudou de tipo.

## Foco: UI/UX

1. **Calendário/seletor de data do formulário** (quem não administra):
   - dias da semana bloqueados desabilitados, **exceto** as `unblocked_dates`;
     tooltip "Não disponível às terças e quintas neste espaço";
   - datas antes de `min_booking_at` (o dia) e depois de `max_booking_date`
     desabilitadas;
   - no dia de `min_booking_at`, o seletor de hora começa naquele horário.
   - Ao trocar de espaço no formulário, recalcule com os limites do espaço novo.
2. **Texto de ajuda** curto perto do formulário, montado pelos campos (não
   fixo): "Reservas com no mínimo 24h e até {max_booking_date}. Este espaço
   precisa de {setup_minutes} min livres entre reservas." Omita o que não se
   aplica (`null`, `0`, `[]`).
3. **Agenda semanal**: pinte a folga antes/depois de cada reserva do espaço
   (faixa mais clara que a reserva, rótulo "Organização"), e os dias
   bloqueados como indisponíveis para quem não administra (as datas liberadas
   aparecem normais).
4. **Erros do envio**: mostre a `message` como vier, no formulário, sem fechar.
   Extras por `code`:
   - `REPP_BOOKING_TOO_SOON`: botão "Usar {min_booking_at}" que preenche data e
     hora de início;
   - `REPP_BOOKING_TOO_FAR`: destaque o campo de data;
   - `REPP_BOOKING_WEEKDAY_BLOCKED`: destaque o campo de data;
   - `REPP_BOOKING_CONFLICT` com `reason: "setup"`: destaque `fields.blocked`
     na agenda e sugira o primeiro horário livre depois de
     `fields.blocked.end_time`.
5. **Administrador** (`booking_rules_exempt: true`): calendário sem bloqueio
   de dia, 24h ou 2 meses. Nos dias bloqueados, um indicador "Bloqueado para
   reservas comuns" com a ação **"Liberar esta data"** (`POST`), e nas datas
   liberadas "Liberada" com **"Bloquear de novo"** (`DELETE`, com a
   confirmação sobre reservas já feitas). Atualize o espaço com a resposta.
6. **Sino**: inclua `created` com ícone/cor próprios, distinto de `requested`.
7. **Mobile**: indisponível com motivo visível no toque (não só em hover).

## Fora do escopo (não implementar sem meu de acordo)

Tela para configurar dias bloqueados ou a duração da folga (hoje é só SQL),
lista de datas liberadas fora do calendário, regra de dia/hora no front
**substituindo** a resposta da API, aviso ao administrador quando outro
administrador edita uma reserva. Se achar que algo disso é necessário,
**sugira e peça "de acordo"**.

## Entrega

Antes de codar: a análise e a lista de sugestões. Depois do meu de acordo:
código completo e um resumo de como testar com dois usuários, um comum e a
administradora do Auditório:

1. comum: terça e quinta do Auditório desabilitadas; Sala de Treinamento
   liberada nesses dias;
2. administradora libera uma terça → o comum vê o dia habilitado (após
   recarregar os espaços) e consegue pedir; ela bloqueia de novo → o pedido
   feito continua na agenda;
3. comum tenta amanhã cedo → `REPP_BOOKING_TOO_SOON` com o botão do horário
   mínimo;
4. comum tenta uma data depois de `max_booking_date` → `REPP_BOOKING_TOO_FAR`;
5. com uma reserva das 14:00 às 15:00 no Auditório: 15:30 → 409 `setup`
   com 13:00–16:00 destacado; 16:00 → aceita;
6. administradora reserva no próprio espaço sem as regras de dia e
   antecedência, mas respeitando a folga;
7. dono do sistema reserva no Auditório → a administradora recebe `created`
   em tempo real e no sino.
