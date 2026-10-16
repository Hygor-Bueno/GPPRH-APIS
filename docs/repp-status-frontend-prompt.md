# Prompt para o agente de frontend — REPP: status das minhas reservas e avisos

> Copie tudo abaixo da linha para o agente do frontend. É a continuação de
> `docs/repp-frontend-prompt.md`: a agenda já existe, e "minhas reservas" e
> notificações, que ficaram fora do escopo lá, entram agora.

---

# Tarefa: "Minhas reservas" e avisos da Reserva de Espaços (frontend)

## Contexto

A tela de Reserva de Espaços (agenda semanal, pedido, aprovação) já está no
front. Falta o lado de **quem pediu**: hoje, quando a administradora recusa um
pedido, o solicitante não fica sabendo, e muito menos o motivo. A reserva
recusada some da agenda (o horário foi liberado), então ele não tem onde olhar.

O backend já entrega tudo isso. Esta tarefa é só frontend:

1. **Minhas reservas**: lista das reservas que o usuário criou, em qualquer
   status, mostrando com destaque **o status e o motivo** da recusa ou do
   cancelamento.
2. **Avisos (sino)**: o usuário é avisado quando a reserva dele é aprovada,
   recusada, cancelada ou alterada por outra pessoa. A administradora é avisada
   quando entra um pedido novo. Em tempo real pelo WebSocket, e recuperados
   pela API quando ele não estava online.

Stack: React + TypeScript + Vite, PWA. **Siga a estrutura do módulo de reservas
que já existe** (cliente HTTP, hooks/serviços, componentes, rotas, tratamento de
erro) e a **conexão WebSocket que o projeto já tem** (a mesma usada pelo GTPP e
pelo chat). Não crie uma segunda conexão nem arquitetura nova.

## Regras de trabalho (obrigatórias)

1. **Antes de escrever código**, analise o módulo de reservas e a camada de
   WebSocket atuais e me apresente: onde "Minhas reservas" vai morar e como se
   chega até ela, onde fica o sino (se já existe um sino global, reaproveite) e
   como o `repp:event` vai ser ouvido sem duplicar listener.
2. **Sugestões** de melhoria ou de regra extra: liste e **peça meu "de acordo"
   antes de implementar**. Nada fora do escopo sem aprovação.
3. Mudanças mínimas, de baixo risco, próximas dos padrões existentes. Código
   completo, sem trechos parciais.

## API

Mesma base, autenticação (cookie HttpOnly, `credentials: 'include'`) e
envelopes da agenda:

- sucesso: `{ "error": false, "data": ... }`;
- erro: `{ "error": true, "message": "...", "code": "...", "fields": ... }`.
  `message` é em português e pode ir para a tela. Decida o comportamento por
  `code`/status, nunca comparando o texto.

As três rotas abaixo **exigem login** (401 do middleware comum, sem `code`).

### 1. `GET /global/spaces/bookings/mine`

As reservas que o usuário **criou**, em **todos** os status, da mais recente
para a mais antiga (data e horário decrescentes), com paginação.

| Query | Obrigatório | Formato |
|---|---|---|
| `status` | não | um ou vários separados por vírgula: `pending`, `approved`, `rejected`, `canceled`. Ausente = todos |
| `start` / `end` | não | `YYYY-MM-DD`, filtram pela data da reserva. Sem limite de 62 dias |
| `space_id` | não | id do espaço |
| `page` / `limit` | não | padrão 50 por página, máximo 200 |

Resposta:

```json
{
  "error": false,
  "data": {
    "items": [ /* reservas completas, formato abaixo */ ],
    "pagination": { "total": 12, "limit": 50, "offset": 0, "page": 1, "pages": 1 }
  }
}
```

Cada item é a **reserva completa** (a mesma `DetailedBooking` que a agenda já
tipa, sempre com `can_view_details: true`). Os campos que importam nesta tela:

| Campo | Uso |
|---|---|
| `status` | `pending` · `approved` · `rejected` · `canceled` |
| `review_note` | **motivo da recusa** (pode ser `null`: o motivo é opcional) |
| `reviewed_by_name` / `reviewed_at` | quem aprovou/recusou e quando |
| `cancel_reason` | **motivo do cancelamento** (pode ser `null`) |
| `canceled_by_name` / `canceled_at` | quem cancelou e quando |
| `can_manage` | mostra Editar/Cancelar (já é `false` para recusada, cancelada ou já iniciada) |

Exemplo de uma recusada:

```json
{
  "id": 41,
  "space_id": 2,
  "space_name": "Auditório",
  "booking_date": "2026-10-22",
  "start_time": "14:00",
  "end_time": "16:00",
  "status": "rejected",
  "title": "Treinamento de prevenção de perdas",
  "requester_name": "FABRICIO ALVES SILVA",
  "company_code": "02",
  "company_name": "PEG PESE SUPERMERCADOS",
  "branch_code": "0201",
  "branch_name": "PEG PESE CEASA",
  "cost_center_code": "100001",
  "cost_center_description": "MOPRODUCAO",
  "created_by": 203,
  "created_by_name": "FABRICIO ALVES SILVA",
  "created_at": "2026-10-09T08:12:40",
  "updated_by": null,
  "updated_by_name": null,
  "updated_at": "2026-10-09T10:03:11",
  "reviewed_by": 88,
  "reviewed_by_name": "ADMINISTRADORA DO AUDITORIO",
  "reviewed_at": "2026-10-09T10:03:11",
  "review_note": "Auditório reservado para a diretoria nesse horário.",
  "canceled_by": null,
  "canceled_by_name": null,
  "canceled_at": null,
  "cancel_reason": null,
  "can_view_details": true,
  "can_manage": false,
  "can_review": false
}
```

Datas e horas são **texto local sem fuso**: `booking_date` `"2026-10-22"`,
`start_time` `"14:00"`, e as de auditoria (`created_at`, `reviewed_at`, ...)
`"2026-10-09T10:03:11"`. **Não converta para `Date` com fuso**, porque a hora
mostrada ficaria 3h adiantada. Formate o texto como ele vem.

Erros específicos:

| Status | `code` | Quando |
|---|---|---|
| 400 | `REPP_INVALID_STATUS` | `status` com valor desconhecido |
| 400 | `REPP_INVALID_DATE_RANGE` | `end` anterior a `start` |
| 400 | `REPP_INVALID_SPACE_ID` | `space_id` inválido |

### 2. `GET /global/spaces/bookings/:id`

Já usado pela agenda. Para o **criador**, devolve a reserva completa em
qualquer status, inclusive recusada e cancelada. É a rota do detalhe quando o
usuário clica num aviso (`booking_id`). 404 `REPP_BOOKING_NOT_FOUND` se a
reserva não existe mais.

### 3. Avisos

#### `GET /global/spaces/notifications`

As **não lidas** do usuário, mais recentes primeiro (até 200). **Buscar não
marca como lida nem apaga**, então pode chamar quantas vezes precisar
(StrictMode, reload, foco na aba).

```json
{
  "error": false,
  "data": [
    {
      "id": 57,
      "action": "rejected",
      "booking_id": 41,
      "space_name": "Auditório",
      "booking_date": "2026-10-22",
      "start_time": "14:00",
      "end_time": "16:00",
      "title": "Treinamento de prevenção de perdas",
      "requester_name": "FABRICIO ALVES SILVA",
      "by_name": "ADMINISTRADORA DO AUDITORIO",
      "reason": "Auditório reservado para a diretoria nesse horário.",
      "previous": null,
      "by_user_id": 88,
      "created_at": "2026-10-09T10:03:11",
      "read_at": null
    }
  ]
}
```

Os dados do aviso são **uma foto do momento da ação**: espaço, data, horário e
título como estavam quando o aviso foi gerado. Use-os para montar o texto. Para
o estado atual da reserva, abra `GET /bookings/:id`.

| `action` | Quem recebe | Texto sugerido | Campos extras |
|---|---|---|---|
| `rejected` | criador | "Seu pedido **{title}** em {space_name}, {data} {start}–{end}, foi **recusado** por {by_name}." | `reason` (motivo) |
| `approved` | criador | "... foi **aprovado** por {by_name}." | — |
| `canceled` | criador | "... foi **cancelado** por {by_name}." | `reason` (motivo) |
| `updated` | criador | "... foi **alterado** por {by_name}." | `previous` (veja abaixo) |
| `requested` | administradores do espaço | "**Novo pedido**: {title} em {space_name}, {data} {start}–{end}, de {requester_name}." | `previous` (veja abaixo) |

- `reason` vem em `rejected` e `canceled` e pode ser `null`. Nesse caso mostre
  "Nenhum motivo informado", não esconda a linha.
- `previous` só vem quando houve **remarcação** (`updated`, ou `requested` de
  um pedido remarcado): `{ space_name, booking_date, start_time, end_time }`
  com o horário **antigo**. Mostre "de {antigo} para {novo}". Nos outros casos
  é `null`.
- Ninguém recebe aviso da própria ação, então quem cancela a própria reserva
  não é avisado.

#### `PATCH /global/spaces/notifications/read`

Corpo `{ "ids": [57, 58] }` (de 1 a 500 ids). Marca como lidas e responde
`{ "updated": 2 }`. É idempotente: id já lido ou de outra pessoa é ignorado sem
erro. 400 `REPP_INVALID_NOTIFICATION_IDS` para lista vazia, com mais de 500
itens ou com valor inválido.

#### Tempo real: `repp:event` no WebSocket

Na conexão WebSocket que o projeto já mantém, chega uma mensagem
`{ "event": "repp:event", "payload": { ... } }` só para o destinatário.
O `payload` tem **o mesmo formato** de um item do GET, sem `created_at` e
`read_at`, e com **o mesmo `id`** da linha gravada.

- Deduplique por `id`. O mesmo aviso aparece no GET e no evento.
- O evento é só um atalho: o aviso **já está gravado** antes de o evento sair.
  Se o usuário estava offline, ele vem no próximo `GET /notifications`. Não
  dependa do WebSocket para nada que não possa ser recuperado pelo GET.

## Foco: UI/UX

1. **Acesso a "Minhas reservas"** dentro do módulo de reservas, visível para
   quem está logado (botão/aba ao lado da agenda). Anônimo não vê.
2. **Lista**, mais recente primeiro, com paginação no padrão do projeto. Cada
   item mostra espaço, data, horário, título e um **selo de status** com cor
   própria:
   - `pending`: "Aguardando aprovação";
   - `approved`: "Aprovada";
   - `rejected`: "**Recusada**", com o motivo (`review_note`) **visível na
     própria linha**, sem precisar abrir o detalhe, e "por {reviewed_by_name}
     em {reviewed_at}";
   - `canceled`: "Cancelada", com `cancel_reason` e "por {canceled_by_name} em
     {canceled_at}".
3. **Filtros**: status (chips, múltipla escolha → `status=rejected,canceled`),
   espaço e período opcional. Abrindo pelo aviso de recusa, já filtre por
   `rejected`.
4. **Detalhe** (o mesmo drawer/modal da agenda): para recusada/cancelada,
   bloco em destaque no topo com status, motivo, quem e quando. Ações só pelas
   flags (`can_manage`). Para uma recusada, ofereça **"Pedir outro horário"**,
   que abre o formulário de nova reserva já preenchido com espaço, título e
   organização da recusada (é um `POST` novo, não edição).
5. **Sino** com contador de não lidas:
   - ao logar e ao voltar o foco para a aba: `GET /notifications`;
   - ao receber `repp:event`: adiciona no topo (se o `id` ainda não estiver na
     lista) e mostra um toast curto (para `rejected`, com o motivo);
   - clicar num aviso: marca **aquele** como lido e abre o detalhe da reserva
     (`booking_id`). Para `requested`, leva à fila de aprovação;
   - "Marcar todas como lidas": um único `PATCH` com todos os ids exibidos;
   - otimista: some do contador na hora e volta se o `PATCH` falhar.
6. **Estados**: loading (esqueleto da lista), vazio ("Você ainda não fez
   nenhuma reserva" / "Nenhuma reserva com esse filtro"), erro com "tentar de
   novo". Sino vazio: "Nenhum aviso novo".
7. **Atualização cruzada**: um `repp:event` sobre uma reserva que está aberta
   na tela (lista ou detalhe) recarrega aquela reserva. Se o aviso é
   `approved`, `canceled` ou `updated`, recarregue também a semana visível da
   agenda.
8. **Mobile**: lista em cards, motivo visível sem expandir, sino acessível no
   cabeçalho.

## Fora do escopo (não implementar sem meu de acordo)

Histórico de avisos já lidos (o backend só devolve as não lidas), notificação
push do PWA/sistema operacional, e-mail, exibir recusadas/canceladas na agenda
pública, tornar o motivo obrigatório na recusa. Se achar que algo disso é
necessário, **sugira e peça "de acordo"**.

## Entrega

Antes de codar: a análise da estrutura (módulo de reservas + WebSocket) e a
lista de sugestões. Depois do meu de acordo: código completo e um resumo do
que foi feito e de como testar com dois usuários, um solicitante e a
administradora do espaço:

1. o solicitante pede uma reserva → a administradora recebe `requested` em
   tempo real;
2. a administradora recusa com motivo → o solicitante vê o toast com o motivo,
   o sino conta 1 e "Minhas reservas" mostra "Recusada" com o motivo;
3. repetir com o solicitante **offline** → ao entrar, o aviso aparece pelo GET;
4. recusa **sem** motivo → "Nenhum motivo informado";
5. reload com aviso não lido → continua lá até ser marcado como lido.
