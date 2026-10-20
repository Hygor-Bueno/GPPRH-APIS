# Prompt para o agente de frontend — GIPP-RH: tirar alguém do cartaz de aniversariantes

> Copie tudo abaixo da linha para o agente do frontend.

---

# Tarefa: lista de exclusão no cartaz de aniversariantes (frontend)

## Contexto

A tela "Aniversariantes do mês" do GIPP-RH já existe (prévia por filial +
download do `.pptx`). O RH precisa de uma **lista de exclusão**: quem estiver
nela não aparece na prévia nem no cartaz, em mês nenhum (ex.: a pessoa pediu
para não sair). O backend já faz o filtro — esta tarefa é só a tela.

A exclusão vale pela **pessoa** (o backend guarda o CPF), não pela matrícula:
se ela for transferida de filial, continua fora do cartaz.

Mesmas regras de trabalho da tarefa anterior: analise o módulo antes, proponha
onde fica, reaproveite componentes, peça "de acordo" para qualquer coisa fora
do escopo.

## API

Base `/global`, cookie HttpOnly (`credentials: 'include'`), envelopes
`{ error, data | message, code }` como no resto do GIPP-RH.

| Rota | Permissão | O que faz |
|---|---|---|
| `GET /global/gipp-rh/birthdays/exclusions` | `GIPPRH_VIEW_EMPLOYEE` | lista quem está fora do cartaz |
| `POST /global/gipp-rh/birthdays/exclusions` | `GIPPRH_VIEW_EMPLOYEE` + `GIPPRH_MANAGE_BIRTHDAY` | tira alguém do cartaz |
| `DELETE /global/gipp-rh/birthdays/exclusions/:id` | `GIPPRH_VIEW_EMPLOYEE` + `GIPPRH_MANAGE_BIRTHDAY` | devolve ao cartaz |

**Só mostre os botões de incluir/remover para quem tem `GIPPRH_MANAGE_BIRTHDAY`.**
Quem só tem a de visualizar vê a lista, sem ações.

### Lista do mês (mudou)

Cada pessoa em `GET /global/gipp-rh/birthdays` agora traz `registration`
(matrícula, string com zeros à esquerda — nunca converta para número). Ela não
aparece no cartaz; serve para o botão "Tirar do cartaz".

### `GET /global/gipp-rh/birthdays/exclusions`

```json
{
  "error": false,
  "data": [
    {
      "id": 3,
      "branchCode": "0202",
      "branchName": "INTERLAGOS",
      "registration": "002351",
      "name": "Fernanda Aparecida dos Santos",
      "sector": "Perecíveis",
      "dismissed": false,
      "reason": "Pediu para não aparecer",
      "createdAt": "2026-10-19T15:16:36.000Z",
      "createdBy": 42
    }
  ]
}
```

- Os dados da pessoa são do contrato **atual** no Protheus. `dismissed: true` =
  já foi desligada (pode mostrar um selo "desligado").
- Se o CPF não tiver mais contrato, `branchCode`, `branchName`, `registration`
  e `name` vêm `null` — mostre "Colaborador não encontrado no Protheus" e
  mantenha o botão de remover.
- Lista vazia = `[]`.

### `POST /global/gipp-rh/birthdays/exclusions`

```json
{ "branch_code": "0202", "registration": "002351", "reason": "Pediu para não aparecer" }
```

`branch_code` e `registration` são os da pessoa na lista do mês. `reason` é
opcional, até 255 caracteres. Resposta `201 { "error": false, "data": { "id": 3 } }`.

### `DELETE /global/gipp-rh/birthdays/exclusions/:id`

`200 { "error": false, "message": "Colaborador de volta ao cartaz." }`.

### Códigos de erro

| Status | `code` | Quando | O que a tela faz |
|---|---|---|---|
| 400 | `GIPPRH_BIRTHDAY_INVALID_EMPLOYEE` | filial/matrícula ausente ou fora do formato | mostrar a `message` |
| 400 | `GIPPRH_BIRTHDAY_INVALID_REASON` | motivo com mais de 255 caracteres | validar no campo antes de enviar |
| 400 | `GIPPRH_BIRTHDAY_INVALID_EXCLUSION_ID` | `:id` inválido | não deveria acontecer |
| 404 | `GIPPRH_BIRTHDAY_EMPLOYEE_NOT_FOUND` | matrícula não existe naquela filial | mostrar a `message` |
| 404 | `GIPPRH_BIRTHDAY_EXCLUSION_NOT_FOUND` | já tinha sido removida | recarregar a lista |
| 409 | `GIPPRH_BIRTHDAY_ALREADY_EXCLUDED` | a pessoa já está fora do cartaz | aviso e recarregar |
| 500 | `GIPPRH_BIRTHDAY_MYSQL_ERROR` / `SQLSERVER_ERROR` | falha ao ler a lista (MySQL) ou o Protheus | erro genérico com "tentar novamente" — vale também para a lista do mês |
| 403 | — | sem `GIPPRH_MANAGE_BIRTHDAY` | não deveria acontecer se os botões estiverem escondidos |

## A tela

1. Na prévia do mês, em cada linha: ação **"Tirar do cartaz"** → modal de
   confirmação com o nome da pessoa e campo opcional "Motivo". Ao confirmar,
   `POST` e recarregar a lista do mês (a pessoa some).
2. Uma área **"Fora do cartaz (N)"** — aba, seção recolhível ou modal, no
   padrão do módulo — com a lista do `GET /exclusions`: nome, filial, setor,
   motivo, data da inclusão, e ação **"Voltar ao cartaz"** (com confirmação).
   Depois de remover, recarregar as duas listas.
3. Deixe claro no texto que a exclusão vale para **todos os meses**.

## Critérios de aceite

- [ ] Botões de incluir/remover só com `GIPPRH_MANAGE_BIRTHDAY`.
- [ ] Tirar do cartaz some a pessoa da prévia e do `.pptx` baixado em seguida.
- [ ] Voltar ao cartaz traz a pessoa de volta no mês dela.
- [ ] Matrícula e filial enviadas como string, com zeros à esquerda.
- [ ] Erros tratados por `code`, sem comparar texto; 409 e 404 recarregam a lista.
