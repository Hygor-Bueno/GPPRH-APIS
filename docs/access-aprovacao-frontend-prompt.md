> ⚠️ **Substituído em 28/10/2026** por [`access-revisao-frontend-prompt.md`](access-revisao-frontend-prompt.md): a fila de aprovação virou registro com revisão (sem 202, sem cancelar). Mantido como histórico do que o front implementou.

# Prompt para o agente de frontend — Gestão de Acessos: aprovação de pedidos e sino

> Copie tudo abaixo da linha para o agente do frontend. A tela de Gestão de
> Acessos da CCPP já existe; esta tarefa adiciona a fila de aprovação.

---

# Tarefa: aprovação de pedidos de acesso e aviso no sino (frontend)

## Contexto

Na Gestão de Acessos (CCPP — Central de Controle Peg Pese), criar usuário e
alterar acesso **deixaram de valer na hora** para quem não é dono do sistema.
O backend agora transforma essas ações em **pedidos pendentes**, que só valem
depois que um dono do sistema (permissão `SYSTEM_OWNER`) aprova.

Quem faz o quê:

| Quem | Permissão | O que vê / faz |
|---|---|---|
| Dono do sistema | `SYSTEM_OWNER` | Tudo o que faz vale na hora. **Aprova ou recusa** os pedidos dos outros. Recebe o aviso no sino. |
| Gestor de acessos (papel `ACCESS_MANAGER_TI`) | `ACCESS_MANAGE` | Cria usuário e altera acesso → vira pedido. Acompanha e cancela os próprios pedidos. |
| Consulta | `ACCESS_VIEW` | Vê a lista de pedidos, sem agir. |

O backend já entrega tudo. Esta tarefa é só frontend:

1. **Tela de aprovação** (dono do sistema): lista dos pedidos pendentes, com
   destaque para **criação de usuário**, detalhe de cada pedido e os botões
   Aprovar / Recusar (com motivo).
2. **Sino** (dono do sistema): contador de pedidos pendentes, com os mais
   recentes no dropdown, atualizado em tempo real pelo WebSocket.
3. **Ajuste nas telas que já existem** (gestor): as ações que agora viram
   pedido respondem **202**, e a tela não pode tratar isso como "alterado".
4. **Meus pedidos** (gestor): status dos pedidos que ele fez, com o motivo da
   recusa, e o botão Cancelar enquanto pendente.

Stack: React + TypeScript + Vite, PWA. **Siga a estrutura da tela de Gestão de
Acessos que já existe** (cliente HTTP, hooks/serviços, componentes, rotas,
tratamento de erro) e a **conexão WebSocket que o projeto já tem** (a mesma do
GTPP, do chat e da Reserva de Espaços). Não crie uma segunda conexão nem
arquitetura nova.

## Regras de trabalho (obrigatórias)

1. **Antes de escrever código**, analise a tela de Gestão de Acessos e a camada
   de WebSocket atuais e me apresente: onde a tela de aprovação e "Meus
   pedidos" vão morar e como se chega até elas, onde fica o sino (se já existe
   um sino global — o da Reserva de Espaços, por exemplo — reaproveite) e como
   o `access:request` vai ser ouvido sem duplicar listener.
2. **Sugestões** de melhoria ou de regra extra: liste e **peça meu "de acordo"
   antes de implementar**. Nada fora do escopo sem aprovação.
3. Mudanças mínimas, de baixo risco, próximas dos padrões existentes. Código
   completo, sem trechos parciais.
4. Quem vê o quê sai das permissões do usuário logado (`/me`), mas o backend
   é quem garante: trate 403 sempre, mesmo em botão que "não deveria" aparecer.

## API

Mesma base e autenticação das rotas `/global/access/*` que a tela já usa
(cookie HttpOnly, `credentials: 'include'`). Envelopes:

- sucesso: `{ "error": false, "data": ... }`;
- erro: `{ "error": true, "message": "...", "code": "..." }`. `message` é em
  português e pode ir para a tela. Decida o comportamento por `code`/status,
  nunca comparando o texto.

### O pedido (objeto `request`)

Todas as rotas abaixo devolvem pedidos neste formato:

```json
{
  "id": 12,
  "type": "create_user",
  "status": "pending",
  "target_user_id": null,
  "target_user_login": null,
  "target_user_name": null,
  "target_role_id": null,
  "target_role_name": null,
  "target_permission_id": null,
  "target_permission_code": null,
  "payload": {
    "user": "joao.silva",
    "name": "JOÃO DA SILVA",
    "registration": "002351",
    "branch_code": "0202",
    "ad_status": "pending",
    "administrator": 0,
    "table_protheus": null
  },
  "sets_password": true,
  "requested_by": 145,
  "requested_by_name": "MARIA SOUZA",
  "requested_at": "2026-10-26T14:03:10",
  "reviewed_by": null,
  "reviewed_by_name": null,
  "reviewed_at": null,
  "review_note": null
}
```

- `status`: `pending` | `approved` | `rejected` | `canceled`.
- Datas vêm `YYYY-MM-DDTHH:mm:ss`, **hora local, sem fuso** (o mesmo formato
  dos comentários do GTPP). Leia pelo `parseApiDate` que o projeto já usa;
  não acrescente `Z` nem converta fuso.
- `sets_password: true` = o pedido define uma senha. **A senha nunca vem** —
  mostre só "define senha inicial". Em `create_user` sem senha, o usuário nasce
  com a senha padrão de usuário de AD.
- Em `create_user`, `target_user_id` só é preenchido **depois** de aprovado
  (é o usuário criado).

### Os tipos (`type`) e como mostrar cada um

| `type` | O que pede | Onde está o dado |
|---|---|---|
| `create_user` | **Criar usuário** | `payload`: `user` (login), `name`, `registration`, `branch_code`, `ad_status`, `administrator`, `table_protheus`, e desde 27/10/2026 `role_ids` e `application_ids` (ausentes em pedidos antigos = lista vazia) |
| `update_user` | Editar usuário (só chega aqui se mudar `administrator` ou ativar) | `target_user_*` + `payload` com os campos novos |
| `patch_user` | Idem, edição parcial | `target_user_*` + `payload` só com o que muda |
| `assign_user_roles` | Dar papéis ao usuário | `target_user_*` + `payload.role_ids` |
| `remove_user_role` | Tirar um papel do usuário | `target_user_*` + `target_role_name` |
| `grant_user_application` | Dar acesso a uma aplicação | `target_user_*` + `payload.application_id` |
| `revoke_user_application` | Tirar acesso a uma aplicação | `target_user_*` + `payload.application_id` |
| `assign_role_permissions` | Adicionar permissões a um papel | `target_role_name` + `payload.permission_ids` |
| `set_role_permissions` | **Substituir** todas as permissões de um papel | `target_role_name` + `payload.permission_ids` (lista final; vazia = tirar todas) |
| `remove_role_permission` | Tirar uma permissão de um papel | `target_role_name` + `target_permission_code` |
| `update_permission` | Renomear código/descrição de permissão | `target_permission_code` (atual) → `payload.code`, `payload.description` |

Ids (`role_ids`, `permission_ids`, `application_id`) vêm **sem nome**:
resolva com `GET /global/access/roles`, `/permissions` e `/applications`, que a
tela já usa (carregue uma vez e reaproveite). Em `set_role_permissions`, mostre
a **diferença** contra o que o papel tem hoje (`GET
/global/access/roles/:id/permissions`): o que entra e o que sai — é o que o
dono precisa ver para decidir. Em `update_user`/`patch_user`, mostre "antes →
depois" carregando o usuário (`GET /global/access/users/:id`).

`ad_status` (texto para a tela): `pending` = Pendente, `active` = Ativo,
`blocked` = Bloqueado, `delete` = Desativado. `administrator`: 0 = Não, 1 = Sim.

### 1. `GET /global/access/requests` — lista

Exige `ACCESS_VIEW` ou `ACCESS_MANAGE` (o dono do sistema passa sempre).

Query (todos opcionais):

- `status`: `pending` (**padrão**), `approved`, `rejected`, `canceled` ou `all`;
- `type`: um dos tipos acima;
- `requested_by`: id do usuário — "Meus pedidos" usa o id do usuário logado;
- `target_user_id`: pedidos sobre um usuário (útil no detalhe do usuário);
- `page`, `limit` (padrão 50, máximo 200).

Resposta (`data`), do mais recente para o mais antigo:

```json
{
  "items": [ { "...pedido..." } ],
  "pagination": { "total": 3, "limit": 50, "offset": 0, "page": 1, "pages": 1 }
}
```

400 `ACCESS_INVALID_REQUEST_STATUS` / `ACCESS_INVALID_REQUEST_TYPE` para filtro
desconhecido.

### 2. `GET /global/access/requests/:id` — detalhe

Mesmas permissões. 404 `ACCESS_REQUEST_NOT_FOUND`.

### 3. `PATCH /global/access/requests/:id/approve` — aprovar

Só `SYSTEM_OWNER`. Sem body. Aplica a mudança na hora.

Resposta: `{ "request": { ...pedido, status "approved"... }, "result": ... }`.
`result` é o que a ação devolveria se feita direto (em `create_user`, o
usuário criado). Depois de aprovar, recarregue o que a tela mostra daquele
usuário/papel.

Erros:

| Status | `code` | O que fazer |
|---|---|---|
| 403 | `ACCESS_REQUEST_SELF_REVIEW` | O dono não analisa o próprio pedido. Esconda os botões quando `requested_by` = usuário logado, e trate se vier. |
| 409 | `ACCESS_REQUEST_NOT_PENDING` | Outro dono já analisou. Mostre a mensagem e recarregue o pedido. |
| 409 | sem `code` específico (ex.: login já em uso) | A mudança não pôde ser aplicada; **o pedido continua pendente**. Mostre a mensagem — o dono decide se recusa. |
| 404 | `ACCESS_REQUEST_NOT_FOUND`, `ACCESS_USER_NOT_FOUND`, `ACCESS_ROLE_NOT_FOUND`, `ACCESS_PERMISSION_NOT_FOUND` | O pedido ou o alvo sumiu. Mostre a mensagem; se o pedido continuar pendente, o dono pode recusar. |

### 4. `PATCH /global/access/requests/:id/reject` — recusar

Só `SYSTEM_OWNER`. Body opcional `{ "note": "motivo" }` (até 255 caracteres).
Peça o motivo num diálogo: **não é obrigatório**, mas o campo deve estar lá e
com foco. Resposta: o pedido com `status: "rejected"` e `review_note`. Mesmos
403/409 do aprovar.

### 5. `PATCH /global/access/requests/:id/cancel` — cancelar o próprio pedido

`ACCESS_MANAGE`, e **só quem pediu**, enquanto pendente. Sem body.
403 `ACCESS_REQUEST_NOT_REQUESTER` · 409 `ACCESS_REQUEST_NOT_PENDING`. Peça
confirmação antes.

### 6. `GET /global/access/requests/summary` — sino

Só `SYSTEM_OWNER` (para os demais responde 403 — **não chame**).

```json
{
  "pending_total": 3,
  "pending_by_type": { "create_user": 2, "assign_user_roles": 1 },
  "latest": [ { "...pedido..." } ]
}
```

`latest` são os 5 pendentes mais recentes. É **estado**, não aviso guardado:
não existe "marcar como lido". O pedido sai do contador de **todos** os donos
quando qualquer um deles aprova ou recusa, ou quando quem pediu cancela.

### 7. Tempo real: `access:request` no WebSocket

Pela conexão que o projeto já tem chega
`{ "event": "access:request", "payload": { "action": "...", "request": { ...pedido... } } }`:

| `action` | Quem recebe | O que fazer |
|---|---|---|
| `requested` | todos os donos | Soma no contador, põe no topo do dropdown, toast "Novo pedido de acesso: Criar usuário joao.silva — por MARIA SOUZA". Se a tela de aprovação estiver aberta, insere na lista. |
| `approved` / `rejected` | todos os donos **e quem pediu** | Donos: tira do contador e da lista de pendentes (pode ter sido outro dono). Quem pediu: toast "Seu pedido foi aprovado" / "recusado: <motivo>" e atualiza "Meus pedidos". |
| `canceled` | todos os donos | Tira do contador e da lista. |

Dedupe por `request.id`: o mesmo pedido pode chegar pelo evento e pelo GET.
O evento é só atalho — quem estava offline não recebe nada guardado: **ao
logar e ao voltar o foco para a aba, chame o `summary`** (dono). Na dúvida,
recarregar o `summary` é sempre correto.

### 8. Telas que já existem: resposta 202

Para quem não é dono, estas rotas agora respondem **202** em vez de 200/201:

- `POST /access/users` (criar usuário);
- `PUT` / `PATCH /access/users/:id` **quando** mudam `administrator` ou passam
  `ad_status` para `active` (o resto da edição continua 200);
- `POST` / `DELETE /access/users/:id/roles[...]`;
- `POST` / `DELETE /access/users/:id/applications[...]`;
- `POST` / `PUT` / `DELETE /access/roles/:id/permissions[...]`;
- `PUT /access/permissions/:id`.

Corpo do 202:

```json
{
  "error": false,
  "message": "Pedido registrado. A alteração só vale depois que um dono do sistema aprovar.",
  "data": { "pending": true, "request": { ...pedido... } }
}
```

Trate por **status 202** (ou `data.pending === true`), nunca pelo texto:

- mostre a `message` num toast de informação (não de sucesso "salvo");
- **não** atualize a tela como se a mudança tivesse acontecido (não marque o
  papel como dado, não ponha o usuário na lista);
- feche o formulário e, onde fizer sentido, mostre um selo "Aguardando
  aprovação" (ex.: no usuário, usando `GET /access/requests?target_user_id=`).

Para o dono, as mesmas rotas continuam 200/201, como hoje.

Outros erros novos nessas telas:

| Status | `code` | Quando |
|---|---|---|
| 403 | `ACCESS_TARGET_IS_OWNER` | Quem não é dono tentou editar, desativar, trocar ou resetar a senha de um usuário dono do sistema. Mostre a mensagem; se der, esconda essas ações nesse usuário. |
| 409 | `ACCESS_USERNAME_TAKEN` | Criar usuário com login que já existe. Erro no campo login. |
| 409 | `ACCESS_REQUEST_DUPLICATE` | Já existe pedido pendente para criar esse login. Erro no campo login. |
| 400 | `ACCESS_INVALID_IDS` | Lista de ids vazia ou inválida. |

## Foco: UI/UX

1. **Tela de aprovação** (só para `SYSTEM_OWNER`), na área da Gestão de
   Acessos:
   - abre em **Pendentes**, com abas ou filtro para Aprovados / Recusados /
     Cancelados / Todos;
   - **criação de usuário em destaque**: filtro rápido "Novos usuários" e,
     no card, login, nome, matrícula, filial, status inicial, se é
     administrador e "define senha inicial";
   - cada item: o que foi pedido em uma frase ("Dar papel CPPP_RH a JOÃO DA
     SILVA"), quem pediu e quando;
   - detalhe com tudo o que o dono precisa para decidir (diferença das
     permissões, antes → depois) e os botões **Aprovar** e **Recusar**;
     aprovar pede confirmação; recusar abre o campo de motivo;
   - pedidos analisados mostram quem analisou, quando e o motivo.
2. **Sino**: contador com o `pending_total` (some quando zero), dropdown com
   os `latest` e "Ver todos" levando para a tela de aprovação já filtrada. Se
   já existe sino global, os pedidos de acesso entram nele como mais uma
   origem, sem quebrar as outras.
3. **Meus pedidos** (quem tem `ACCESS_MANAGE`): lista com
   `requested_by = <meu id>`, status em destaque (Pendente / Aprovado /
   Recusado + motivo / Cancelado) e Cancelar nos pendentes.
4. Botões de ação desabilitados durante a chamada (evita clique duplo).
5. Estados vazios: "Nenhum pedido pendente", "Você ainda não fez pedidos".
6. **Mobile**: lista em cards, botões de ação ao alcance, sino acessível no
   cabeçalho.

## Fora do escopo (não implementar sem meu de acordo)

Aprovação em lote, edição de um pedido pendente (o caminho é cancelar e pedir
de novo), notificação por e-mail/push, histórico de avisos lidos (não existe
"lido" — o sino é o contador de pendentes).

## Entrega

1. Primeiro, a análise pedida em "Regras de trabalho", item 1.
2. Depois do meu de acordo, o código.
3. Roteiro de teste manual, no mínimo:
   - gestor (`ACCESS_MANAGER_TI`) cria usuário → toast de pedido registrado,
     usuário **não** aparece na lista; aparece em "Meus pedidos" como Pendente;
   - dono logado em outra aba: o sino conta 1 sem recarregar, e o pedido
     aparece no topo da tela de aprovação;
   - dono aprova → contador zera, o usuário aparece na lista; o gestor recebe
     "Seu pedido foi aprovado";
   - dono recusa com motivo → o gestor vê "Recusado" e o motivo;
   - dois donos aprovando o mesmo pedido → o segundo vê a mensagem do 409 e a
     lista se ajusta;
   - gestor tenta resetar a senha de um dono → 403 com a mensagem;
   - dono faz qualquer alteração → vale na hora (200/201), sem pedido.
