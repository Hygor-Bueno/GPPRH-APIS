# Prompt para o frontend — Filtros de filial e centro de custo nas jornadas em aberto (GIPP)

---

Cole o texto abaixo direto no chat do Claude:

---

Preciso adicionar dois filtros na tela de jornadas de trabalho em aberto (resumo de pagamento) do módulo GIPP, e ajustar o carregamento da página por causa de uma mudança de comportamento no backend.

## ⚠️ Mudança que quebra o comportamento atual

O endpoint `GET /api/v1/gipp/time-records/payment` **agora retorna lista vazia quando nenhum filtro é enviado**. Antes ele devolvia todas as jornadas em aberto.

Se a página hoje carrega a lista no `mount` sem parâmetros, ela vai passar a mostrar tabela vazia. O carregamento precisa deixar de ser automático: a tela abre pedindo que o usuário escolha um filtro, e só busca depois disso.

O motivo é performance, medido no banco real: sem filtro a consulta leva cerca de **3 segundos** (a view roda sobre cinco níveis de subquery com funções escalares). Com filtro cai para **130 a 680 ms**. Exigir um critério foi a forma de tornar a requisição barata.

## Endpoint

```
GET /api/v1/gipp/time-records/payment?branch_cod=0208&cost_center=1006
Authorization: Bearer <token>
```

Parâmetros, ambos opcionais e combináveis (quando os dois vêm, é E lógico):

| Parâmetro | Alias aceito | Exemplo | Observação |
|---|---|---|---|
| `branch_cod` | `branch` | `0208` | Aceita com ou sem zeros à esquerda — `208` e `0208` trazem o mesmo resultado |
| `cost_center` | `costCenter` | `1006` | Comparação exata (com trim). Não tem zero-padding |

Envie **pelo menos um** dos dois. String vazia conta como não enviado.

Permissão necessária: `VIEW_TIME_RECORDS` ou `MANAGE_TIME_RECORDS`. Sem token válido o retorno é 401.

## Resposta

Array de objetos, ordenado por nome do colaborador:

```json
[
  {
    "company_cod": "NOME DA EMPRESA LTDA",
    "cost_center": "1006",
    "registration": "000123",
    "collaborator": "NOME DO COLABORADOR",
    "month_salary": 3127.69,
    "branch_cod": "0208",
    "branch_desc": "FILIAL EXEMPLO",
    "hours_day": "07:20",
    "total_hours": "10:10",
    "normal_hour": "07:20",
    "extra_hour": "02:50",
    "night_hour": "0:00",
    "normal_payment": 208.51266479999998,
    "extra_hour_payment": 71.083863,
    "night_bonus_payment": 0,
    "total_payment": 279.5965278,
    "cod_work_schedule_fk": "2026072200020892"
  }
]
```

Quatro detalhes dos campos que afetam a renderização:

1. **Valores monetários vêm como float cru**, não formatado — `279.5965278`. Formate para BRL com 2 decimais no frontend (`month_salary`, `normal_payment`, `extra_hour_payment`, `night_bonus_payment`, `total_payment`).
2. **Horas vêm como string `"HH:MM"`, mas `night_hour` não tem zero à esquerda** — pode vir `"0:00"` em vez de `"00:00"`. Não assuma 2 dígitos na hora ao fazer parse ou comparação.
3. **`company_cod` contém o NOME da empresa**, apesar do nome do campo — `"NOME DA EMPRESA LTDA"`, não um código. Use como texto.
4. **`registration` vem com zeros à esquerda em 6 posições** — `"000123"`.

Não existe campo de data nem de status na resposta. A data só existe embutida nos 8 primeiros caracteres de `cod_work_schedule_fk` (`20260722` = 22/07/2026), então **não construa filtro de período** — são marcações em aberto e o filtro de data não faz parte deste escopo.

## De onde vêm as opções dos selects

O endpoint de pagamento não devolve a lista de filiais e centros de custo disponíveis (e não daria, já que ele agora exige filtro). Use os endpoints de Protheus, que já existem:

**Filiais** — `GET /api/v1/protheus/branches`

```json
{ "error": false, "data": [ { "branch_code": "0208", "branch_name": "FILIAL EXEMPLO", "company_code": "01" } ] }
```

O campo `branch_code` é o que vai em `branch_cod`.

**Centros de custo** — `GET /api/v1/protheus/cost-centers/:companyCode`

```json
{ "error": false, "data": [ { "costCenterCode": "1006", "costCenterDescription": "DESCRICAO DO CC" } ] }
```

O `:companyCode` precisa ser numérico. A lista de empresas vem de `GET /api/v1/protheus/companies`, que retorna `{ company_code, company_name }`.

Todos exigem `Authorization: Bearer <token>`.

## Comportamento da tela

Monte uma barra de filtros acima da tabela com dois selects (filial e centro de custo), um botão de buscar e um de limpar. Os selects devem permitir seleção vazia, já que qualquer um dos dois sozinho é válido.

Trate **três estados vazios diferentes** — não use a mesma mensagem para todos:

- **Nenhum filtro escolhido ainda:** mensagem orientando a selecionar filial e/ou centro de custo. Não dispare requisição.
- **Filtro aplicado e resposta vazia:** "Nenhuma jornada em aberto para este filtro."
- **Erro na requisição:** mensagem de erro com opção de tentar novamente.

O botão de buscar deve ficar desabilitado enquanto nenhum dos dois selects tiver valor — é o que impede a requisição inútil.

Mantenha o filtro escolhido na URL (query string) para que a página possa ser recarregada ou compartilhada com o mesmo recorte.

Não implemente paginação: o volume é pequeno (dezenas de linhas por filtro) e o backend não pagina.

## Erros

O backend responde com `{ "error": true, "message": "..." }`. 401 quando o token é inválido ou expirou, 403 quando falta permissão, 500 em falha inesperada.

## Stack

Usar a mesma stack já adotada no projeto. Usar Tailwind se já estiver configurado.

---

Implemente a barra de filtros, o carregamento sob demanda e os três estados vazios, e mostre como integrar na tabela de jornadas já existente.
