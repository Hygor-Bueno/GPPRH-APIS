# Prompt para o agente de frontend — GIPP-RH: aniversariantes do mês

> Copie tudo abaixo da linha para o agente do frontend.

---

# Tarefa: tela "Aniversariantes do mês" no GIPP-RH (frontend)

## Contexto

Todo mês o RH monta à mão, no PowerPoint, o cartaz "Tem gente fazendo
aniversário!", com um slide por filial e a lista NOME | SETOR | DATA, para
imprimir e afixar nas lojas. O backend agora gera esse arquivo pronto (`.pptx`,
editável) a partir do Protheus, e também entrega a mesma lista em JSON.

Esta tarefa é só frontend: uma tela no módulo **GIPP-RH** em que a pessoa
escolhe o mês, confere quem vai sair no cartaz, filtra filiais se quiser e
baixa o `.pptx`.

Stack: React + TypeScript + Vite, PWA. **Siga a estrutura do módulo GIPP-RH que
já existe** (cliente HTTP, hooks/serviços, componentes, rotas, menu, controle de
permissão, tratamento de erro e o download de arquivo que o recibo em PDF já
usa). Não crie arquitetura nova.

## Regras de trabalho (obrigatórias)

1. **Antes de escrever código**, analise o módulo GIPP-RH atual e me apresente:
   onde a tela vai morar, como se chega até ela (menu/rota), quais componentes
   existentes vai reaproveitar (seletor, tabela, botão de download) e como o
   download do recibo em PDF é feito hoje, para fazer igual.
2. **Sugestões** de melhoria ou de regra extra: liste e **peça meu "de acordo"
   antes de implementar**. Nada fora do escopo sem aprovação.
3. Mudanças mínimas, de baixo risco, próximas dos padrões existentes. Código
   completo, sem trechos parciais.

## API

Base: `/global` (a mesma das outras rotas do GIPP-RH). Autenticação por cookie
HttpOnly: `credentials: 'include'` (ou o cliente HTTP do projeto, que já faz
isso). Nunca mande token no header.

As duas rotas exigem login e a permissão **`GIPPRH_VIEW_EMPLOYEE`** (a mesma da
listagem de colaboradores). Sem login → 401; sem permissão → 403. **Esconda o
item de menu** de quem não tem a permissão, do mesmo jeito que as outras telas
do GIPP-RH.

Envelopes:

- sucesso: `{ "error": false, "data": ... }`;
- erro: `{ "error": true, "message": "...", "code": "..." }`. `message` vem em
  português e pode ir para a tela. Decida o comportamento por `code`/status,
  nunca comparando o texto.

### Parâmetros (iguais nas duas rotas)

| Query | Obrigatório | Formato |
|---|---|---|
| `month` | sim | `1` a `12` |
| `branches` | não | códigos de filial separados por vírgula, **sempre com 4 dígitos e zero à esquerda** (`0202,0206`). Ausente = todas. Nunca converta para número |

### 1. `GET /global/gipp-rh/birthdays?month=10`

Lista do mês agrupada por filial (filiais em ordem de código; pessoas em ordem
de dia e depois nome). Só tem filial que tem aniversariante.

```json
{
  "error": false,
  "data": {
    "month": 10,
    "month_name": "outubro",
    "branches": [
      {
        "branchCode": "0202",
        "branchName": "INTERLAGOS",
        "people": [
          {
            "branchCode": "0202",
            "branchName": "INTERLAGOS",
            "name": "Fernanda Aparecida dos Santos",
            "sector": "Perecíveis",
            "day": 1,
            "month": 10,
            "date": "01/10"
          }
        ]
      }
    ]
  }
}
```

- Mês sem ninguém: `branches: []` (200, não é erro).
- **Não existe** ano de nascimento nem matrícula na resposta, de propósito. Não
  tente mostrar idade.
- `branchName` já vem pronto para exibir (sem o "PEG PESE" na frente; outras
  empresas aparecem com o nome completo, ex.: "FRUGAL BOLONHA").

### 2. `GET /global/gipp-rh/birthdays/flyer?month=10[&branches=0202,0206]`

Devolve o arquivo binário `.pptx`:

- `Content-Type: application/vnd.openxmlformats-officedocument.presentationml.presentation`
- `Content-Disposition: attachment; filename="aniversariantes-10-outubro.pptx"`
  (o header está exposto no CORS; use esse nome no download).

Um slide por filial, até 19 nomes por slide (filial maior continua no slide
seguinte). Pode levar alguns segundos: mostre estado de carregamento no botão e
bloqueie clique duplo.

⚠️ **Em erro, a resposta é JSON, não arquivo.** Peça como blob/arraybuffer, mas
confira o status (e o `Content-Type`) antes de salvar: se não for 200, leia o
corpo como JSON e mostre a `message`. Nunca salve o JSON de erro como `.pptx`.

### Códigos de erro

| Status | `code` | Quando | O que a tela faz |
|---|---|---|---|
| 400 | `GIPPRH_BIRTHDAY_INVALID_MONTH` | `month` ausente ou fora de 1–12 | não deveria acontecer com o seletor; mostrar a `message` |
| 400 | `GIPPRH_BIRTHDAY_INVALID_BRANCH` | filial fora do formato de 4 dígitos | idem |
| 404 | `GIPPRH_BIRTHDAY_NOT_FOUND` | só no `/flyer`: ninguém no mês/filiais escolhidos | aviso "Nenhum aniversariante em {mês}" (sem tom de erro) |
| 500 | `SQLSERVER_ERROR` | falha ao ler o Protheus | erro genérico com opção de tentar de novo |

## A tela

1. **Seletor de mês** (janeiro a dezembro), começando no **mês atual**. Trocar o
   mês recarrega a lista.
2. **Filtro de filiais** (multisseleção, opcional), montado a partir das
   `branches` que a lista do mês devolveu. Nenhuma marcada = todas. O filtro
   pode ser aplicado só no front para a visualização; no download, mande
   `branches` com as marcadas (ou omita se forem todas).
3. **Prévia**: para cada filial, um bloco com o nome da filial, a quantidade de
   pessoas e uma tabela NOME | SETOR | DATA, na ordem que veio da API (não
   reordene). Mostre também o total geral e quantos slides o arquivo vai ter
   (`Σ ceil(pessoas_da_filial / 19)`), só como informação.
4. **Botão "Baixar cartaz (.pptx)"**, que usa os mesmos mês e filiais da tela.
   Desabilitado enquanto a lista carrega ou quando não há ninguém.
5. Estados: carregando, vazio ("Nenhum aniversariante em outubro"), erro com
   "tentar novamente". Layout responsivo; no celular a tabela pode virar lista.

Textos em português. Mês exibido com inicial maiúscula ("Outubro").

## Fora do escopo

- Editar nome ou setor pela tela: o RH ajusta direto no `.pptx`, que é editável.
- Exportar em PDF ou imagem, enviar por e-mail, agendar envio.
- Qualquer mudança de backend. Se faltar algo na API, me avise em vez de
  contornar.

## Critérios de aceite

- [ ] Item de menu e rota só para quem tem `GIPPRH_VIEW_EMPLOYEE`.
- [ ] Abre no mês atual e mostra a prévia agrupada por filial, na ordem da API.
- [ ] Filtro de filiais muda a prévia e o arquivo baixado, mantendo os zeros à
      esquerda (`0202`).
- [ ] Download salva com o nome do `Content-Disposition` e abre no PowerPoint.
- [ ] 404 do `/flyer` vira aviso amigável; erro JSON nunca é salvo como arquivo.
- [ ] Sem clique duplo no download; estados de carregando, vazio e erro tratados.
