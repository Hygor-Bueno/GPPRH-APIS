# Prompt para o frontend — Restrição de permissão nos prazos de itens (GTPP)

---

Cole o texto abaixo direto no chat do Claude:

---

Preciso adaptar o frontend do módulo GTPP para tratar a restrição de permissão que o backend agora aplica na edição de prazos de itens de tarefa.

## Contexto

Cada item de tarefa pode ter `initial_date` e `final_date` (prazo). O backend passou a restringir quem pode editar essas datas:

- **Pode editar**: o criador do item (`created_by`) **ou** o criador da tarefa (`user_id` da tarefa) **ou** um administrador (`MANAGE_GTPP` / `SYSTEM_OWNER`)
- **Não pode editar**: qualquer outro participante da tarefa

Se um usuário sem permissão tentar editar, o backend retorna:

```json
HTTP 403
{ "error": true, "message": "Apenas o dono do item, o criador da tarefa ou um administrador pode alterar os prazos." }
```

## Dados disponíveis para determinar permissão no front

### Na listagem de itens (GET `/api/v1/global/gtpp/tasks/:taskId/items`)

Cada item retorna:

```json
{
  "id": 42,
  "description": "Desenvolver tela de pedidos",
  "check": false,
  "created_by": 17,
  "assigned_to": null,
  "initial_date": "2026-06-08",
  "final_date": "2026-06-12",
  "deadline_percent": 40,
  "overdue": false
}
```

O campo `created_by` é o ID do usuário que criou o item.

### No detalhe da tarefa (GET `/api/v1/global/gtpp/tasks/:taskId`)

```json
{
  "id": 5853,
  "description": "Título da tarefa",
  "user_id": 12
}
```

O campo `user_id` é o criador da tarefa.

### Usuário logado

Disponível no store/contexto de autenticação. Exemplo: `auth.user.id` e `auth.user.permissions[]`.

## O que precisa ser implementado

### 1. Função de verificação de permissão

Crie uma função utilitária `canEditItemDates(item, taskCreatorId, currentUser)` que retorna `true` se:

```js
currentUser.id === item.created_by
|| currentUser.id === taskCreatorId
|| currentUser.permissions.includes('MANAGE_GTPP')
|| currentUser.permissions.includes('SYSTEM_OWNER')
```

### 2. Esconder / desabilitar o controle de edição de prazo

Na listagem de itens, o botão ou ícone que abre a edição de `initial_date` / `final_date` deve:

- **Ser ocultado ou desabilitado** quando `canEditItemDates()` retornar `false`
- Mostrar um tooltip explicativo quando o usuário passar o mouse sobre o controle desabilitado:
  > "Apenas o criador do item ou da tarefa pode editar o prazo."

### 3. Tratar o erro 403 defensivamente

Mesmo com o controle oculto no front, trate o 403 no código que chama o endpoint:

```
PUT /api/v1/global/gtpp/tasks/:taskId/items/:itemId
{ "action": "dates", "initial_date": "...", "final_date": "..." }
```

Se a resposta for 403, exiba uma mensagem de erro amigável ao usuário — não deixe a requisição falhar silenciosamente.

### 4. Sem impacto nas outras ações

A restrição de permissão se aplica **somente** à `action: "dates"`. As demais ações (`check`, `description`, `note`, `assigned_to`, etc.) não foram alteradas — continue chamando-as normalmente.

## Resumo visual esperado

| Usuário               | Vê o controle de data? | Pode editar? |
|-----------------------|------------------------|--------------|
| Criador do item       | Sim                    | Sim          |
| Criador da tarefa     | Sim                    | Sim          |
| Admin (MANAGE_GTPP)   | Sim                    | Sim          |
| Outro participante    | Não (oculto/disabled)  | Não (403)    |

## Stack

Use a mesma stack do projeto (React, Vue ou o que estiver sendo usado). Adapte à estrutura de store e componentes já existentes no módulo GTPP — não crie abstrações novas se não forem necessárias.
