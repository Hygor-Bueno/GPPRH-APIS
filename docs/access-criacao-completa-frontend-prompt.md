> ⚠️ **Substituído em 28/10/2026** por [`access-revisao-frontend-prompt.md`](access-revisao-frontend-prompt.md): a fila de aprovação virou registro com revisão (sem 202, sem cancelar). Mantido como histórico do que o front implementou.

# Prompt para o agente de frontend — Gestão de Acessos: criar usuário já com papéis e aplicações

> Copie tudo abaixo da linha para o agente do frontend. É a continuação de
> `docs/access-aprovacao-frontend-prompt.md` (fila de aprovação e sino), que
> já está implementado no front.

---

# Tarefa: criar usuário já com papéis e aplicações (frontend)

## Contexto

Hoje, ao criar um usuário na Gestão de Acessos (CCPP), o `UserDrawer` mostra
só a aba **Dados**; **Papéis** e **Aplicações** só aparecem depois, na edição
(`isEditing`). Para quem não é dono do sistema isso não funciona: a criação
vira pedido pendente, o usuário ainda não existe, e dar papel ou aplicação a
ele responde 404 (`ACCESS_USER_NOT_FOUND`). O gestor teria de esperar a
aprovação para só então pedir os papéis, e o dono aprovaria duas ou três vezes
o que é uma coisa só.

O backend agora aceita **tudo de uma vez** no `POST /global/access/users`.
Esta tarefa é só frontend:

1. Na **criação**, o `UserDrawer` passa a mostrar também as abas **Papéis** e
   **Aplicações** (marcar sem salvar separado), e o Salvar envia tudo junto.
2. O **detalhe do pedido** (`RequestDetail`) e o resumo da lista mostram, num
   pedido de criação, os papéis e as aplicações pedidos.

**Siga o que já existe**: o `UserDrawer`, o `AssignmentChecklist` e os hooks
`useRoles`/`useApplications` que as abas de edição já usam, o `useWriteOutcome`
para 200/201 × 202, e o `lookup` de nomes do `RequestsPanel`. Não crie
componente paralelo nem chamada nova onde uma existente serve.

## Regras de trabalho (obrigatórias)

1. **Antes de escrever código**, me apresente como as abas vão funcionar na
   criação (o `AssignmentChecklist` hoje salva por diferença contra o que o
   usuário tem; na criação não há "o que tem" — é só a seleção) e o que muda no
   `RequestDetail`.
2. **Sugestões** fora disto: liste e **peça meu "de acordo"** antes.
3. Mudanças mínimas, próximas dos padrões existentes. Código completo.

## API

### `POST /global/access/users` — dois campos novos, opcionais

```json
{
  "user": "joao.silva",
  "name": "JOÃO DA SILVA",
  "registration": "002351",
  "branch_code": "0202",
  "ad_status": "active",
  "administrator": 0,
  "role_ids": [23, 9],
  "application_ids": [1, 39]
}
```

- `role_ids`: ids de `GET /global/access/roles`.
- `application_ids`: ids de `GET /global/access/applications` — **lista**
  (diferente da rota de aplicação do usuário, que recebe um por vez).
- Os dois são opcionais; sem eles a rota funciona como antes. Mande só quando a
  lista tiver algo (ou mande `[]`, tanto faz).

Respostas (as mesmas de hoje):

- **Dono do sistema** → **201**, usuário criado **já com** os papéis e as
  aplicações (numa transação só: ou vai tudo, ou nada).
- **Demais** → **202** com **um único pedido** `create_user`, que traz as
  listas em `payload.role_ids` e `payload.application_ids`. Aprovar aplica
  tudo junto.

Erros novos:

| Status | `code` | Quando / o que fazer |
|---|---|---|
| 400 | `ACCESS_UNKNOWN_ROLE` | Algum papel não existe mais (a `message` cita o id). Recarregue os papéis e mostre o erro na aba Papéis. |
| 400 | `ACCESS_UNKNOWN_APPLICATION` | Idem para aplicação, na aba Aplicações. |
| 400 | `ACCESS_INVALID_IDS` | Lista malformada — não deve acontecer pela tela. |

Continuam valendo `ACCESS_USERNAME_TAKEN` e `ACCESS_REQUEST_DUPLICATE` no campo
login. Os ids são conferidos **antes** de gerar o pedido, então um 400 aqui
significa que nada foi gravado.

### Pedido `create_user` — o que mudou no `payload`

```json
"payload": {
  "user": "joao.silva",
  "name": "JOÃO DA SILVA",
  "registration": "002351",
  "branch_code": "0202",
  "ad_status": "active",
  "administrator": 0,
  "table_protheus": null,
  "role_ids": [23, 9],
  "application_ids": [1, 39]
}
```

Pedidos criados antes desta mudança **não têm** as duas chaves — trate
ausente como lista vazia. Resolva os nomes pelo mesmo `lookup` que o
`RequestsPanel` já monta (papéis e aplicações).

## Foco: UI/UX

1. **Criação** no `UserDrawer`:
   - as três abas (Dados, Papéis, Aplicações) aparecem desde o início;
   - nas abas de vínculo, é só marcar/desmarcar — sem botão de salvar próprio;
     o **Salvar** do drawer envia tudo;
   - indique na aba quantos itens estão marcados (ex.: "Papéis (2)"), para a
     pessoa não esquecer que marcou algo fora da aba Dados;
   - se o erro voltar de uma aba que não está aberta, leve a pessoa até ela.
2. **Edição** não muda: as abas continuam salvando por diferença, como hoje.
3. **Detalhe do pedido** de criação: abaixo dos dados do usuário, duas listas
   — "Papéis" e "Aplicações" — com os nomes; "Nenhum" quando vazia. É isso que
   o dono vai aprovar, então precisa estar visível sem rolar muito.
4. **Resumo na lista / sino**: na frase do pedido de criação, acrescente a
   contagem quando houver ("Criar usuário joao.silva · 2 papéis, 2
   aplicações").

## Fora do escopo (não implementar sem meu de acordo)

Mudar a edição de papéis/aplicações para um envio único; criar usuário em lote.

## Entrega

1. Primeiro, a análise pedida em "Regras de trabalho", item 1.
2. Depois do meu de acordo, o código.
3. Roteiro de teste manual, no mínimo:
   - gestor cria usuário marcando 2 papéis e 1 aplicação → 202, **um** pedido
     na fila; o detalhe mostra os 2 papéis e a aplicação pelo nome;
   - dono aprova → o usuário aparece já com os papéis e a aplicação;
   - dono cria usuário com papéis e aplicações → 201, tudo valendo na hora;
   - criar sem marcar nada continua funcionando;
   - pedido de criação antigo (sem as listas) abre sem erro, com "Nenhum".
