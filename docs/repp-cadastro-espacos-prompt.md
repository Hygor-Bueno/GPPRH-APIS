# Prompt — REPP: cadastro de espaços, administradores e dias bloqueados

> Copie tudo abaixo da linha para quem vai consumir as rotas (agente do
> frontend, Postman, etc.). Continuação de `docs/repp-admins-frontend-prompt.md`
> e `docs/repp-regras-agenda-frontend-prompt.md`.
>
> Estado do backend em 19/10/2026: código testado com fakes (jest), **sem DDL
> novo**. As rotas de cadastro só existem em produção depois do rebuild do
> container `api-gipp-enterprises`.

---

# REPP — como cadastrar espaços, atribuir administradores e gerir os dias

Base: `/api/v1/global/spaces`. Autenticação por cookie de sessão (as rotas de
escrita respondem 401 sem sessão). Resposta de sucesso:
`{ error: false, data }`. Erro: `{ error: true, message, code, fields? }` —
decida pelo `code`, nunca pelo texto.

## Papéis

| Papel | Quem é | O que faz aqui |
|---|---|---|
| Dono do sistema | permissão `SYSTEM_OWNER` | tudo: cria espaço, edita, desativa, define administradores |
| Administrador do espaço | vínculo em `re_space_admins` | muda dias bloqueados e folga do **seu** espaço, libera datas, aprova reservas |
| Usuário comum | qualquer logado | só pede reserva |

O front não precisa calcular isso: cada espaço do `GET /spaces` traz
`can_edit_space` (dono), `can_edit_agenda` (administra o espaço) e
`can_manage_admins` (dono).

## 1. Cadastrar um espaço (dono)

```
POST /api/v1/global/spaces
{
  "name": "Sala de Reunião 2",
  "description": "Térreo, 12 lugares",
  "blocked_weekdays": [2, 4],
  "setup_minutes": 30,
  "admin_user_ids": [476, 148]
}
```

| Campo | Obrigatório | Regra |
|---|---|---|
| `name` | sim | até 100 caracteres, único (ignora maiúsculas) |
| `description` | não | até 255 caracteres |
| `blocked_weekdays` | não (padrão `[]`) | lista ISO: 1 = segunda … 7 = domingo |
| `setup_minutes` | não (padrão `0`) | inteiro de 0 a 240 — folga antes e depois de cada reserva |
| `admin_user_ids` | **sim, ≥ 1** | ids de `_user`, todos ativos; o espaço nunca nasce sem administrador |

Responde **201** com o espaço no mesmo formato do `GET /spaces`. Espaço e
administradores são gravados juntos: se algum falhar, nada é criado.

Para escolher os usuários, use a busca que o front já conhece:
`GET /api/v1/global/access/users`.

## 2. Administradores do espaço (dono)

| Ação | Rota | Corpo |
|---|---|---|
| Listar | `GET /api/v1/global/spaces/:id/admins` | — |
| Adicionar | `POST /api/v1/global/spaces/:id/admins` | `{ "user_id": 476 }` |
| Remover | `DELETE /api/v1/global/spaces/:id/admins/:userId` | — |

- As três devolvem `{ space_id, can_manage_admins, items: [{ user_id, name, login, ad_status, since, added_by, added_by_name }] }`.
- Adicionar e remover são idempotentes.
- O administrador do espaço pode **listar** os do próprio espaço, mas só o
  dono adiciona e remove.
- Remover o último administrador ativo → 409 `REPP_LAST_SPACE_ADMIN`
  (adicione outro antes).

## 3. Dias bloqueados e folga (dono ou administrador do espaço)

"Dia bloqueado" = o usuário comum não reserva naquele dia da semana; o
administrador do espaço e o dono reservam normalmente.

**Ex.: Auditório (id 2) bloqueado às terças e quintas, com 60 min de folga:**

```
PUT /api/v1/global/spaces/2
{ "blocked_weekdays": [2, 4], "setup_minutes": 60 }
```

- `"blocked_weekdays": []` tira todos os bloqueios.
- Campo ausente fica como está. Pode mandar o formulário inteiro: só conta o
  que **mudou** (o administrador que reenvia o nome igual não leva 403).
- Vale na hora para pedidos novos; reservas já feitas não são tocadas.

### Liberar uma data específica num dia bloqueado

```
POST   /api/v1/global/spaces/2/unblocked-dates   { "date": "2026-10-27" }
DELETE /api/v1/global/spaces/2/unblocked-dates/2026-10-27
```

- Libera a data para todos (exceção ao bloqueio da semana) e o `DELETE` volta
  a bloquear. As duas são idempotentes e devolvem o espaço.
- Só data de hoje em diante (`REPP_BOOKING_IN_PAST`) e que caia num dia
  bloqueado (`REPP_DATE_NOT_BLOCKED`).
- Bloquear de novo não cancela reservas já feitas na data.

## 4. Editar e desativar (dono)

```
PUT /api/v1/global/spaces/:id
{ "name": "Auditório Principal", "description": "2º andar", "active": false }
```

- Não há exclusão. `active: false` tira o espaço do `GET /spaces` e recusa
  reserva nova (`REPP_SPACE_INACTIVE`); reservas, administradores e avisos
  continuam. `active: true` reativa.
- Para listar também os desativados (tela de gestão):
  `GET /api/v1/global/spaces/me/managed?include_inactive=true`. Cada item traz
  `active`.

## 5. O que o `GET /spaces` devolve por espaço

```json
{
  "id": 2, "name": "Auditório", "description": null, "active": true,
  "blocked_weekdays": [2, 4], "unblocked_dates": ["2026-10-27"], "setup_minutes": 60,
  "min_booking_at": "2026-10-20T14:30", "max_booking_date": "2026-12-19",
  "booking_rules_exempt": false,
  "can_view_details": false, "can_manage": false, "can_review": false,
  "can_book": true, "requires_approval": true,
  "can_manage_admins": false, "can_edit_space": false, "can_edit_agenda": false
}
```

Use `blocked_weekdays` + `unblocked_dates` para desabilitar dias no
calendário do usuário comum. Para quem administra o espaço,
`booking_rules_exempt = true` e `min_booking_at`/`max_booking_date` = `null`:
não desabilite nada para ele.

## 6. Erros

| HTTP | `code` | Quando |
|---|---|---|
| 400 | `GENERIC_ERROR` | formato do corpo pelo validador comum: `name` ausente ou com mais de 100, `description` com mais de 255 |
| 400 | `REPP_REQUIRED_FIELD` | `name` só com espaços |
| 400 | `REPP_INVALID_WEEKDAYS` | `blocked_weekdays` não é lista de 1 a 7 |
| 400 | `REPP_INVALID_SETUP_MINUTES` | `setup_minutes` fora de 0–240 ou não inteiro |
| 400 | `REPP_INVALID_ACTIVE` | `active` não é booleano |
| 400 | `REPP_SPACE_ADMIN_REQUIRED` | `POST` sem `admin_user_ids` |
| 400 | `REPP_USER_INACTIVE` | administrador escolhido está bloqueado |
| 400 | `REPP_DATE_NOT_BLOCKED` / `REPP_BOOKING_IN_PAST` | liberar data que não está bloqueada ou já passou |
| 403 | `REPP_MANAGE_SPACES_FORBIDDEN` | não-dono criando espaço, ou administrador mudando nome/descrição/`active` (`fields.forbidden` lista os campos) |
| 403 | `REPP_NOT_SPACE_ADMIN` | quem não administra o espaço tentando editar |
| 403 | `REPP_MANAGE_ADMINS_FORBIDDEN` | não-dono adicionando/removendo administrador |
| 404 | `REPP_SPACE_NOT_FOUND` / `REPP_USER_NOT_FOUND` | id inexistente |
| 409 | `REPP_SPACE_NAME_TAKEN` | nome já usado por outro espaço |
| 409 | `REPP_LAST_SPACE_ADMIN` | remover o último administrador ativo |
