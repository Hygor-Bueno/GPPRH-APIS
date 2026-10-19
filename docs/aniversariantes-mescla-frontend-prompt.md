# Prompt para o agente de frontend — GIPP-RH: mesclar filiais na impressão do cartaz

> Copie tudo abaixo da linha para o agente do frontend.

---

# Tarefa: mesclar filiais no download do cartaz de aniversariantes (frontend)

## Contexto

Na tela "Aniversariantes do mês", às vezes o RH precisa imprimir duas (ou
mais) filiais **no mesmo cartaz** — por exemplo, o Escritório Central (`0209`)
junto de Interlagos (`0202`), porque ficam no mesmo prédio. Isso vale **só para
o arquivo baixado**: a prévia na tela e a lista do mês continuam separadas por
filial, e nada é gravado. Na próxima vez, a escolha começa vazia.

O backend já faz a mescla. Esta tarefa é só a tela.

Mesmas regras de trabalho das tarefas anteriores: analise a tela atual antes,
reaproveite componentes, peça "de acordo" para qualquer coisa fora do escopo.

## API

Só mudou o download, que já existe:

`GET /global/gipp-rh/birthdays/flyer?month=10[&branches=…][&merge=0202,0209][&merge=0102,0104]`

| Query | Obrigatório | Formato |
|---|---|---|
| `merge` | não | um grupo por parâmetro: códigos de filial de 4 dígitos separados por vírgula. **Repita o parâmetro** para mais de um grupo. Cada grupo precisa de pelo menos 2 filiais, e uma filial não pode estar em dois grupos |

Como sai no arquivo:
- **A primeira filial do grupo é a principal**: o nome dela vai na faixa
  ("OUTUBRO · INTERLAGOS") e a arte é a da empresa dela.
- As pessoas das filiais do grupo aparecem juntas, em ordem de dia. Se passarem
  de 19 (ou das linhas da arte), continuam em outro slide da principal.
- Com `branches` informado, as filiais da mescla entram no filtro
  automaticamente — não precisa repetir.
- Se a principal não tiver ninguém no mês, a faixa usa o nome da primeira
  filial do grupo que tiver.

Monte a URL com `URLSearchParams.append('merge', '0202,0209')` para cada grupo.
**Não use `+` como separador** (vira espaço na URL).

Erro novo:

| Status | `code` | Quando | O que a tela faz |
|---|---|---|---|
| 400 | `GIPPRH_BIRTHDAY_INVALID_MERGE` | grupo com uma filial só, código inválido ou filial em dois grupos | mostrar a `message` (valide antes de enviar) |

## A tela

1. Perto do botão **"Baixar cartaz (.pptx)"**, uma opção **"Juntar filiais na
   impressão"** que abre a montagem dos grupos:
   - escolher a filial **principal** e as filiais que entram junto (a partir
     das filiais que a lista do mês devolveu);
   - permitir mais de um grupo; uma filial só pode estar em um grupo;
   - remover um grupo.
2. Mostrar um resumo antes de baixar, ex.: "Interlagos + Escritório Central →
   1 cartaz (44 pessoas, 3 slides)". Slides = `ceil(pessoas / 19)`.
3. A prévia da tela **não muda** — a mescla é só do arquivo. Deixe isso claro no
   texto ("só no cartaz impresso").
4. Ao trocar o mês, limpar os grupos.

## Critérios de aceite

- [ ] Sem grupo montado, o download é igual ao de hoje.
- [ ] Com grupo, o `.pptx` traz as filiais juntas com o nome e a arte da principal.
- [ ] Vários grupos no mesmo download funcionam (`merge` repetido).
- [ ] Filiais como string de 4 dígitos, com zero à esquerda.
- [ ] Grupo com uma filial só ou filial repetida é bloqueado na tela; o 400 do backend vira mensagem.
- [ ] A prévia da tela continua separada por filial.
