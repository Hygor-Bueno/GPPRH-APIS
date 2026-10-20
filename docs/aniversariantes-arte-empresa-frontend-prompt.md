# Prompt para o agente de frontend — GIPP-RH: arte do cartaz por empresa

> Copie tudo abaixo da linha para o agente do frontend.

---

# Tarefa: gestão da arte do cartaz de aniversariantes por empresa (frontend)

## Contexto

O cartaz de aniversariantes (`.pptx`) usa uma arte de fundo: balões, logo,
título e um cartão com as linhas pautadas onde os nomes são escritos. Até agora
era uma arte só. A partir de agora **cada empresa** (Peg Pese, Frugal, Hetros…)
pode ter a sua. A empresa é o prefixo de 2 dígitos da filial: `0202` → empresa
`02` (Peg Pese), `0101` → `01` (Frugal).

Empresa sem arte própria continua com a **arte padrão** — nada muda para quem
não mexer. O download do cartaz já escolhe a arte de cada filial sozinho; esta
tarefa é a tela de gestão.

Além da imagem, cada arte guarda as **medidas** (`layout`): onde ficam as
linhas e as colunas NOME | SETOR | DATA, a faixa com mês e filial, e as cores do
texto. Os nomes são desenhados por cima da imagem, então essas medidas precisam
bater com a arte. **Se a arte nova segue o mesmo modelo da padrão** (o caso
comum: troca logo e cores), basta enviar a imagem: o backend escala as medidas
padrão para o tamanho dela.

Mesmas regras de trabalho das tarefas anteriores: analise o módulo GIPP-RH
antes, proponha onde a tela fica, reaproveite componentes, peça "de acordo"
para qualquer coisa fora do escopo.

## API

Base `/global`, cookie HttpOnly (`credentials: 'include'`), envelopes
`{ error, data | message, code }` como no resto do GIPP-RH.

| Rota | Permissão | O que faz |
|---|---|---|
| `GET /global/gipp-rh/birthdays/flyer-arts` | `GIPPRH_VIEW_EMPLOYEE` | todas as empresas, com a arte de cada uma |
| `GET /global/gipp-rh/birthdays/flyer-arts/:companyCode/image` | `GIPPRH_VIEW_EMPLOYEE` | PNG da arte que sai no cartaz da empresa |
| `PUT /global/gipp-rh/birthdays/flyer-arts/:companyCode` | `GIPPRH_VIEW_EMPLOYEE` + `GIPPRH_MANAGE_BIRTHDAY` | envia a arte e/ou ajusta as medidas |
| `DELETE /global/gipp-rh/birthdays/flyer-arts/:companyCode` | `GIPPRH_VIEW_EMPLOYEE` + `GIPPRH_MANAGE_BIRTHDAY` | volta a empresa para a arte padrão |

`companyCode` é string de 2 dígitos (`"02"`), nunca número.

**Botões de enviar, ajustar e voltar à padrão só para quem tem
`GIPPRH_MANAGE_BIRTHDAY`** (a mesma permissão da lista de exclusão). Quem só
tem a de visualizar vê as artes, sem ações.

### `GET /global/gipp-rh/birthdays/flyer-arts`

```json
{
  "error": false,
  "data": [
    {
      "companyCode": "01",
      "companyName": "FRUGAL IMPORTADORA",
      "custom": true,
      "fileId": 812,
      "imageWidth": 1684,
      "imageHeight": 2382,
      "layout": {
        "rows_per_slide": 19,
        "first_row_top_px": 736,
        "last_line_px": 2224,
        "col_name_px": 200,
        "col_sector_px": 874,
        "col_date_px": 1350,
        "card_right_px": 1566,
        "tag_center_x_px": 1044,
        "tag_y_px": 480,
        "tag_height_px": 68,
        "accent_color": "1B7F3A",
        "text_color": "1F2A1F",
        "tag_fill_color": "FFFFFF"
      },
      "updatedAt": "2026-10-19T18:00:00.000Z",
      "updatedBy": 42
    },
    {
      "companyCode": "02",
      "companyName": "PEG PESE SUPERMERCADOS",
      "custom": false,
      "fileId": null,
      "imageWidth": 842,
      "imageHeight": 1191,
      "layout": { "...": "medidas da arte padrão" },
      "updatedAt": null,
      "updatedBy": null
    }
  ]
}
```

- `custom: false` = usa a arte padrão (o `layout` devolvido é o da padrão).
- Todas as medidas `*_px` são **em pixels da imagem** (`imageWidth` × `imageHeight`).

### O que cada medida significa

| Campo | O que é |
|---|---|
| `rows_per_slide` | quantas linhas pautadas o cartão tem (1 a 40). Filial com mais gente continua em outro slide |
| `first_row_top_px` | y onde começa a 1ª linha (fim do cabeçalho NOME / SETOR / DATA) |
| `last_line_px` | y da última linha pautada. A área entre os dois é dividida igualmente pelas linhas |
| `col_name_px` / `col_sector_px` / `col_date_px` | x onde começa cada coluna |
| `card_right_px` | x onde termina o cartão (fim da coluna DATA) |
| `tag_center_x_px` / `tag_y_px` / `tag_height_px` | centro horizontal, topo e altura da faixa "OUTUBRO · INTERLAGOS" |
| `accent_color` | cor da data e do texto da faixa (hex, sem `#`) |
| `text_color` | cor do nome e do setor |
| `tag_fill_color` | fundo da faixa |

Regras que o backend confere (valide também no formulário):
`col_name < col_sector < col_date < card_right ≤ imageWidth`;
`first_row_top < last_line ≤ imageHeight`; a faixa cabe na imagem; inteiros ≥ 0;
cores hex de 6 dígitos.

### `GET …/flyer-arts/:companyCode/image`

Devolve `image/png` (binário). Use para mostrar a arte e desenhar as guias por
cima. Para `<img>`, busque com `credentials: 'include'` e use um `blob:` URL
(o cookie é HttpOnly).

### `PUT …/flyer-arts/:companyCode` — **multipart/form-data**

| Campo | Obrigatório | O que é |
|---|---|---|
| `file` | na 1ª vez da empresa; depois, só para trocar a imagem | PNG ou JPEG, **proporção do cartaz (A3 em pé, altura = largura × 1,414, tolerância 2%)**. Ex.: 842×1191, 1684×2382, 3508×4961 |
| `layout` | não | **string JSON** com só os campos que quer mudar, ex.: `{"rows_per_slide":15,"accent_color":"1B7F3A"}` |

Como o backend monta as medidas:
- **Primeira arte da empresa, sem `layout`**: as medidas da arte padrão
  escaladas para o tamanho da imagem.
- **Troca de imagem do mesmo tamanho da anterior**: mantém as medidas já ajustadas.
- **Troca para imagem de outro tamanho**: volta para as medidas padrão escaladas.
- **Sem `file`**: só ajusta as medidas da arte que a empresa já tem.
- Em todos os casos, o que vier em `layout` sobrepõe.

Resposta `200` com o mesmo objeto de um item do `GET` (já atualizado).

### `DELETE …/flyer-arts/:companyCode`

`200 { "error": false, "message": "A empresa voltou para a arte padrão." }`.

### Códigos de erro

| Status | `code` | Quando | O que a tela faz |
|---|---|---|---|
| 400 | `GIPPRH_FLYER_ART_INVALID_COMPANY` | código fora do formato de 2 dígitos | não deveria acontecer |
| 404 | `GIPPRH_FLYER_ART_COMPANY_NOT_FOUND` | empresa não existe no Protheus | recarregar a lista |
| 400 | `GIPPRH_FLYER_ART_FILE_REQUIRED` | empresa sem arte própria e sem `file` | pedir a imagem |
| 400 | `GIPPRH_FLYER_ART_INVALID_IMAGE` | não é PNG/JPEG legível | mostrar a `message` |
| 400 | `GIPPRH_FLYER_ART_INVALID_PROPORTION` | fora da proporção do cartaz | mostrar a `message` (já diz a altura esperada) |
| 400 | `GIPPRH_FLYER_ART_INVALID_LAYOUT` | medidas inconsistentes | mostrar a `message` junto do formulário |
| 404 | `GIPPRH_FLYER_ART_NOT_FOUND` | `DELETE` em empresa que já usa a padrão | recarregar a lista |
| 500 | `GIPPRH_FLYER_ART_IMAGE_MISSING` | a imagem gravada sumiu do armazenamento | pedir para enviar a arte de novo |
| 500 | `GIPPRH_FLYER_ART_MYSQL_ERROR` / `SQLSERVER_ERROR` | falha de banco | erro genérico com "tentar novamente" |
| 413 | — | arquivo grande demais | mostrar a `message` |

## A tela

1. Lista das empresas (cartões ou tabela) com miniatura da arte, nome, selo
   **"Arte própria"** ou **"Arte padrão"**, e data da última alteração.
2. Ao abrir uma empresa:
   - a arte em tamanho de tela, com **guias desenhadas por cima** a partir do
     `layout`: as `rows_per_slide` linhas entre `first_row_top_px` e
     `last_line_px`, as três colunas e a faixa da filial. As medidas estão em
     pixels da imagem — converta pela escala da imagem exibida;
   - **"Enviar arte"** (upload de PNG/JPEG). Antes de enviar, leia as dimensões
     no navegador e avise se a proporção não for a do cartaz;
   - **"Ajustar medidas"**: formulário com os campos do `layout` (números e
     seletores de cor), com as guias atualizando ao vivo. Salvar manda só
     `layout` (sem `file`);
   - **"Voltar à arte padrão"** (com confirmação), só se `custom: true`.
3. Texto curto explicando que a arte vale para **todas as filiais da empresa** e
   que, se a arte nova segue o mesmo modelo da padrão, não precisa ajustar nada.
4. Sugestão (peça "de acordo" antes): botão "Baixar cartaz de teste", que chama
   o `/flyer` do mês atual filtrado por uma filial da empresa.

## Critérios de aceite

- [ ] Ações só com `GIPPRH_MANAGE_BIRTHDAY`; leitura com `GIPPRH_VIEW_EMPLOYEE`.
- [ ] Enviar arte de uma empresa muda o cartaz das filiais dela, e só delas.
- [ ] Guias batem com a arte na tela, nas medidas devolvidas pela API.
- [ ] Ajustar medidas sem reenviar a imagem.
- [ ] Voltar à padrão funciona e a lista mostra "Arte padrão" de novo.
- [ ] `companyCode` como string de 2 dígitos; `layout` enviado como string JSON no multipart.
- [ ] Erros tratados por `code`, sem comparar texto.
