# Tarefa: de "fila de aprovação" para "revisão de alterações" (frontend)

## Contexto

A Gestão de Acessos (CCPP) tinha uma fila de aprovação: quem não era dono do
sistema recebia **202** e a alteração só valia depois que um dono aprovasse.
Isso foi implementado no front (commit `f388e435` do `gipp_enterprises`:
`RequestsPanel`, `RequestDetail`, sino no `NotificationPanel`,
`useGlobalWsNotifications`, `useWriteOutcome`).

**O backend mudou a regra.** Agora:

1. Quem tem `ACCESS_MANAGE` grava **na hora** (200/201, como qualquer rota).
   Cada alteração deixa um **registro** "aguardando revisão".
2. Quem tem a permissão nova **`ACCESS_APPROVE`** revisa os registros:
   - **Aprovar** só fecha o registro: a alteração fica.
   - **Recusar** desfaz a alteração e diz o que voltou e o que não deu para
     voltar.
3. Alteração feita por dono do sistema (`SYSTEM_OWNER`) já nasce aprovada e
   não aparece para revisão.
4. `SYSTEM_OWNER` sumiu da API: não aparece na lista de permissões, e o papel
   que a tem não aparece na lista de papéis. Só se dá pelo banco.
5. Ninguém além dos donos altera o próprio cadastro, nem as permissões de um
   papel que tem.

Esta tarefa ajusta o front a isso. **Reaproveite as telas que já existem**: a
"fila" vira "revisão". Não crie telas paralelas.

## Regras de trabalho (obrigatórias)

1. **Antes de escrever código**, me apresente:
   - o que sai (tratamento do 202, "Minhas solicitações" com cancelar,
     mensagens de "aguardando aprovação");
   - o que muda de texto e de permissão em cada tela;
   - como vai mostrar o "antes → depois" e o resultado do desfazer.
2. **Sugestões** fora disto: liste e **peça meu "de acordo"** antes.
3. Mudanças mínimas, próximas dos padrões existentes. Código completo.

## O que muda na API

### Escritas em `/global/access/*`

- **Não existe mais 202.** Toda escrita responde como antes de haver fila:
  200 (ou 201 na criação), com o objeto alterado. O `useWriteOutcome` (ou o
  equivalente) deve tratar só o caminho de sucesso normal. Remova o ramo
  `pending`.
- Passaram a gerar registro também: desativar usuário, reset de senha,
  criar/editar/excluir papel, criar/excluir permissão. Para a tela, nada
  muda: a resposta é a mesma.

Erros novos (403), todos com `code`:

| `code` | Quando | O que fazer na tela |
|---|---|---|
| `ACCESS_SELF_EDIT` | A pessoa tentou alterar o próprio cadastro, ou as permissões de um papel que ela tem. | Esconda/desabilite as ações no próprio usuário (compare com o id logado) e nos papéis dela; se mesmo assim vier, mostre a `message`. |
| `ACCESS_OWNER_PROTECTED` | Mexeu em `SYSTEM_OWNER` ou num papel que a tem. | Não deve acontecer pela tela, porque eles não aparecem nas listas. Mostre a `message`. |
| `ACCESS_REVIEWER_PROTECTED` | Quem não é dono tentou dar, tirar ou editar `ACCESS_APPROVE` (a permissão ou um papel que a tem, ex.: `ACCESS_APPROVER_TI`). | Para quem não é dono: na aba de papéis, mostre esses papéis sem marcar/desmarcar; na aba de permissões de um papel, `ACCESS_APPROVE` só leitura; papel revisor sem editar/excluir. Se vier, mostre a `message`. |
| `ACCESS_TARGET_IS_OWNER` | (já existia) Conta de dono, alterada por quem não é dono. | Igual a hoje. |

O detalhe de um usuário dono ainda pode listar o papel de dono (ex.:
`SUPER_ADMIN`) entre os papéis dele. Mostre esse papel **sem** o botão de
remover: a API recusa.

### Registros — `GET /global/access/requests`, `GET /global/access/requests/:id`

Mesmo formato de antes, com **dois campos novos**:

```json
{
  "id": 12,
  "type": "patch_user",
  "status": "pending",
  "target_user_id": 85, "target_user_login": "joao.silva", "target_user_name": "JOÃO DA SILVA",
  "target_role_id": null, "target_role_name": null,
  "target_permission_id": null, "target_permission_code": null,
  "payload":        { "name": "JOÃO S.", "branch_code": "0202" },
  "previous_state": { "name": "JOÃO DA SILVA", "branch_code": "0101" },
  "revert_result":  null,
  "sets_password": false,
  "requested_by": 68, "requested_by_name": "SUPORTE TI DEV", "requested_at": "2026-10-28T10:15:00",
  "reviewed_by": null, "reviewed_by_name": null, "reviewed_at": null, "review_note": null
}
```

- `status`:
  - `pending` = **já aplicada**, aguardando revisão;
  - `approved` = revisada e mantida (ou feita por dono);
  - `rejected` = revisada e **desfeita**;
  - `canceled` = só registros antigos.
- `previous_state` = como estava antes. Use com o `payload` para mostrar
  **antes → depois**. É `null` em criações e no reset de senha.
- `revert_result` (só em `rejected` novos):
  `{ "complete": false, "undone": ["name restaurado(s)"], "skipped": ["branch_code: foi alterado de novo depois; ficou como está."] }`.
  Mostre `undone` como lista de "desfeito" e `skipped` em destaque de aviso.
  Com `complete: false`, quem revisou precisa saber que algo ficou como está.
- Datas: sem fuso, leia com `parseApiDate` como já faz.

Tipos (`type`) — os 11 de antes e mais 7 novos:

| `type` | Frase sugerida | `previous_state` |
|---|---|---|
| `create_user` | Criou o usuário {payload.user} (+ N papéis, N aplicações) | — |
| `update_user` / `patch_user` | Editou {target_user_name} | campos antes |
| `deactivate_user` | Desativou {target_user_name} | `{ ad_status }` |
| `reset_password` | Resetou a senha de {target_user_name} | — (não tem desfazer) |
| `assign_user_roles` | Deu papéis a {target_user_name} | `{ role_ids }` antes |
| `remove_user_role` | Tirou {target_role_name} de {target_user_name} | `{ had }` |
| `grant_user_application` / `revoke_user_application` | Deu/tirou a aplicação {payload.application_id} | `{ had }` |
| `create_role` | Criou o papel {payload.name} | — |
| `update_role` | Editou o papel {target_role_name} | `{ name, description }` |
| `delete_role` | Excluiu o papel {previous_state.name} | `{ name, description, permission_ids }` |
| `assign_role_permissions` / `set_role_permissions` | Mudou as permissões de {target_role_name} | `{ permission_ids }` antes |
| `remove_role_permission` | Tirou {target_permission_code} de {target_role_name} | `{ had }` |
| `create_permission` | Criou a permissão {payload.code} | — |
| `update_permission` | Renomeou {previous_state.code} → {payload.code} | `{ code, description }` |
| `delete_permission` | Excluiu a permissão {previous_state.code} | `{ code, description }` |

Em registro de papel ou permissão excluídos, `target_role_name` e
`target_permission_code` vêm `null`. Use o `previous_state`.

### Revisão

- `PATCH /global/access/requests/:id/approve`: body opcional `{ note }`.
  **Agora aceita nota.** Mantém a alteração.
- `PATCH /global/access/requests/:id/reject`: body opcional `{ note }`.
  **Desfaz.** A resposta é o registro com `revert_result`.
- **`PATCH /global/access/requests/:id/cancel` não existe mais.** Tire o botão
  "Cancelar" de "Minhas solicitações". Essa aba pode virar "Minhas alterações"
  (filtro `requested_by` = eu, `status=all`), só leitura.
- Erros da revisão:
  - 409 `ACCESS_REQUEST_NOT_PENDING`: já revisada por outro. Recarregue.
  - 403 `ACCESS_REQUEST_SELF_REVIEW`: é alteração sua.
  - 403 `ACCESS_REQUEST_SELF_TARGET` **(novo)**: a alteração é no seu próprio
    cadastro. Esconda os botões quando `target_user_id` = id logado e quem
    revisa não é dono.

### Quem vê o quê

| Permissão | Pode |
|---|---|
| `ACCESS_VIEW` / `ACCESS_MANAGE` | listar e abrir registros (`GET /access/requests*`) |
| `ACCESS_APPROVE` (ou `SYSTEM_OWNER`) | sino (`GET /access/requests/summary`), aprovar, recusar |

Hoje o sino e os botões são mostrados só para `SYSTEM_OWNER`. Troque a
checagem por **`ACCESS_APPROVE` ou `SYSTEM_OWNER`**.

### WebSocket `access:request`

Mesmo evento, mesmo formato `{ action, request }`. Mudou o significado:

- `requested`: alteração nova feita por `ACCESS_MANAGE`, que **já vale**.
  Vai para quem revisa.
- `approved`: mantida. Vai para quem revisa e para o autor.
- `rejected`: **desfeita**. Vai para quem revisa e para o autor; o autor deve
  ver um aviso claro de que a alteração dele foi desfeita, com `review_note`.
- `canceled` não é mais enviado.

## Foco: UI/UX

1. **Textos**: "pedido", "solicitação", "aguardando aprovação" e "aprovar
   pedido" passam a ser "alteração", "aguardando revisão", "manter" e
   "desfazer". O botão de recusar deve dizer **"Desfazer"** e pedir
   confirmação ("A alteração será revertida. Continuar?").
2. **Detalhe** (`RequestDetail`): bloco **Antes → Depois** com
   `previous_state` × `payload`, campo a campo; listas de ids viram nomes
   pelo `lookup` que já existe. Depois de desfeita, mostre o
   `revert_result`.
3. **Sino**: igual, só que para `ACCESS_APPROVE`. A frase do item usa a
   tabela de tipos acima.
4. **Ações no próprio cadastro**: na lista e no `UserDrawer`, o usuário logado
   que não é dono não vê editar/papéis/aplicações/desativar/resetar no
   próprio registro. Nos papéis que ele tem, a aba de permissões fica só
   leitura.

## Fora do escopo (não implementar sem meu de acordo)

Desfazer em lote; editar o `revert_result`; tela de auditoria separada.

## Entrega

1. Primeiro, a análise pedida em "Regras de trabalho", item 1.
2. Depois do meu de acordo, o código.
3. Roteiro de teste manual, no mínimo:
   - gestor (`ACCESS_MANAGE`) dá um papel a alguém → 200, vale na hora; o
     revisor recebe no sino;
   - revisor (`ACCESS_APPROVE`) abre, vê antes → depois e mantém → some do sino;
   - gestor edita nome e filial; outra pessoa muda a filial de novo; o
     revisor desfaz a primeira → nome volta, filial fica, aviso em
     `skipped`;
   - gestor tenta editar o próprio cadastro → botões escondidos (e 403
     `ACCESS_SELF_EDIT` se forçar);
   - `SYSTEM_OWNER` não aparece em permissões, e `SUPER_ADMIN` não aparece
     em papéis;
   - "Minhas alterações" não tem mais o botão Cancelar.
