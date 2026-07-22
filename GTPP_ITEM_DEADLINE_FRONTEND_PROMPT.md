# Prompt para o frontend — Termômetro de prazo por item de tarefa (GTPP)

---

Cole o texto abaixo direto no chat do Claude:

---

Preciso implementar um termômetro visual de prazo para os itens de uma tarefa no módulo GTPP do nosso sistema.

## Contexto

O backend já entrega todos os dados calculados. Cada item de tarefa agora tem campos de data opcionais e o percentual de prazo decorrido já vem pronto — o frontend não precisa calcular nada.

## O que o backend retorna (GET dos itens)

```json
{
  "id": 42,
  "description": "Desenvolver tela de pedidos",
  "check": false,
  "initial_date": "2026-06-08",
  "final_date": "2026-06-12",
  "deadline_percent": 40,
  "overdue": false
}
```

Campos novos:
- `initial_date` — data de início do item (string YYYY-MM-DD ou null)
- `final_date` — data de fim/prazo do item (string YYYY-MM-DD ou null)
- `deadline_percent` — inteiro de 0 a 100 indicando quanto do prazo já passou. null quando o item não tem datas
- `overdue` — boolean. true quando final_date já passou (mesmo que check = true)

O cálculo por trás é: `(hoje - initial_date) / (final_date - initial_date) × 100`

Exemplo real:
- Início: 04/06/2026
- Fim: 14/06/2026
- Hoje: 08/06/2026
- Resultado: 40%

## Componente termômetro

Quero um componente reutilizável chamado `DeadlineBar` que receba as props:
- `percent` (number | null)
- `overdue` (boolean)
- `initialDate` (string | null)
- `finalDate` (string | null)

Comportamento visual:
- Se `percent` for null (item sem datas): não renderizar nada
- De 0% a 60%: barra verde
- De 61% a 85%: barra amarela/laranja (atenção)
- De 86% a 99%: barra vermelha (urgente)
- 100% + `overdue = true`: barra vermelha escura + ícone ou texto "Atrasado"
- 100% + `overdue = false`: barra verde completa (concluído no prazo — `check = true`)

A barra deve ser horizontal, fina (estilo progress bar), e exibir o percentual ao lado. As datas devem aparecer em tooltip ou texto pequeno abaixo.

## Como criar um item com prazo (POST)

```
POST /api/v1/global/gtpp/tasks/:taskId/items
Content-Type: application/json

{
  "description": "Nome do item",
  "initial_date": "2026-06-08",
  "final_date": "2026-06-12"
}
```

Os campos `initial_date` e `final_date` são opcionais. Se informados, devem vir juntos e respeitar as datas da tarefa pai.

## Como atualizar o prazo de um item existente (PUT)

```
PUT /api/v1/global/gtpp/tasks/:taskId/items/:itemId
Content-Type: application/json

{
  "action": "dates",
  "initial_date": "2026-06-08",
  "final_date": "2026-06-12"
}
```

Para remover as datas de um item:
```json
{
  "action": "dates",
  "initial_date": null,
  "final_date": null
}
```

## Validações que o backend já faz (não precisa replicar no front, apenas tratar os erros)

- `initial_date` e `final_date` devem vir juntos — não aceita só um dos dois
- `initial_date` deve ser anterior a `final_date`
- `initial_date` do item não pode ser anterior à `initial_date` da tarefa pai (quando a tarefa tiver data)
- `final_date` do item não pode ultrapassar o `final_date` da tarefa pai (quando a tarefa tiver data)

Em caso de erro o backend retorna HTTP 400 com `{ "error": true, "message": "..." }`.

## Onde exibir

O termômetro deve aparecer em cada item da lista de itens da tarefa, logo abaixo ou ao lado da descrição do item, somente quando `deadline_percent !== null`.

## Stack

Usar a mesma stack já adotada no projeto (React, Vue ou o que estiver sendo usado). Usar Tailwind se já estiver configurado.

---

Implemente o componente `DeadlineBar` e mostre como integrá-lo na listagem de itens existente.
