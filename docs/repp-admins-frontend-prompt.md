# Prompt para o agente de frontend — REPP: gestão dos administradores de espaço

> Copie tudo abaixo da linha para o agente do frontend. É a resposta à
> consulta "gestão dos administradores de espaço" e a continuação de
> `docs/repp-frontend-prompt.md`, `docs/repp-status-frontend-prompt.md` e
> `docs/repp-regras-agenda-frontend-prompt.md`.
>
> Estado do backend em 16/10/2026: banco já migrado
> (`re-admins-espaco-deploy.sql`), código testado contra o banco real; **as
> rotas só existem em produção depois do rebuild do container
> `api-gipp-enterprises`**.

---

# Tarefa: tela de administradores dos espaços (frontend)

## Respostas à consulta

1. **Suporte no backend:** não existia; **foi criado** (rotas abaixo).
2. **Onde mora o vínculo:** tabela própria do REPP, `re_space_admins`
   (espaço × usuário), e **não** um papel/permissão da Gestão de Acessos — a
   permissão é global, e aqui o alcance é um espaço. Até agora só por SQL; a
   partir do rebuild, pelas rotas novas. O **dono do sistema**
   (`SYSTEM_OWNER`) administra todos os espaços **sem** estar na tabela.
3. **Quem gerencia:** **só o dono do sistema** adiciona e remove (decisão do
   Hygor, 16/10/2026). O administrador do espaço **vê** a lista do próprio
   espaço, sem botões. O front sabe pelo flag `can_manage_admins`.
4. **Busca de usuários:** use **`GET /global/access/users`**, a que o front já
   conhece. Ela exige `ACCESS_VIEW`/`ACCESS_MANAGE`, mas o dono do sistema
   passa por cima de qualquer permissão — e só ele adiciona. Não foi criada
   busca nova.
5. **Efeitos colaterais de remover:**
   - reservas, datas liberadas e avisos **já gerados** não mudam (aprovação
     feita por ele continua valendo; os avisos continuam no sino dele até
     serem lidos, mas ao abri-los ele vê a reserva mascarada);
   - dali em diante ele perde `can_manage`/`can_review` no espaço, sai da fila
     de aprovação, para de receber `requested`/`created` e volta às regras de
     dia bloqueado, 24h e 2 meses;
   - **o espaço nunca fica sem administrador ativo**: remover o último
     responde 409 `REPP_LAST_SPACE_ADMIN` (adicione outro antes).

Stack: React + TypeScript + Vite, PWA. **Siga a estrutura do módulo de reservas
que já existe** (cliente HTTP, hooks/serviços, tipos, componentes, rotas,
tratamento de erro) e reaproveite o seletor/busca de usuários da Gestão de
Acessos se houver um componente pronto. Não crie arquitetura nova.

## Regras de trabalho (obrigatórias)

1. **Antes de escrever código**, analise o módulo de reservas e o de Gestão de
   Acessos e me apresente: onde a tela vai morar e como se chega a ela, qual
   componente de busca de usuário será reaproveitado e quais tipos mudam.
2. **Sugestões** de melhoria ou de regra extra: liste e **peça meu "de acordo"
   antes de implementar**. Nada fora do escopo sem aprovação.
3. Mudanças mínimas, de baixo risco, próximas dos padrões existentes. Código
   completo, sem trechos parciais.
4. Permissão é do backend: mostre o que vier e trate o 403.

## API

Mesma base, autenticação (cookie HttpOnly, `credentials: 'include'`) e
envelopes de sempre:

- sucesso: `{ "error": false, "data": ... }`;
- erro: `{ "error": true, "message": "...", "code": "...", "fields": ... }`.
  `message` é em português e vai para a tela como vier. Decida o comportamento
  por `code`/status, nunca comparando o texto.

As três rotas **exigem login** (401 do middleware comum, sem `code`).

### 1. Flag novo em `GET /global/spaces` (e `/me/managed`)

| Campo | Tipo | Significado |
|---|---|---|
| `can_manage_admins` | `boolean` | `true` = quem consulta é dono do sistema: mostra adicionar/remover. Igual em todos os espaços |

Use junto com `can_manage`: quem tem `can_manage: true` vê a lista do espaço;
quem também tem `can_manage_admins: true` vê os botões.

### 2. `GET /global/spaces/:id/admins`

Administradores do espaço, por nome. Acesso: dono do sistema ou administrador
do próprio espaço.

```json
{
  "error": false,
  "data": {
    "space_id": 1,
    "can_manage_admins": true,
    "items": [
      {
        "user_id": 148,
        "name": "HYGOR AZEVEDO BUENO",
        "login": "hygor",
        "ad_status": "active",
        "since": "2026-10-16T11:37:13",
        "added_by": null,
        "added_by_name": null
      },
      {
        "user_id": 9,
        "name": "MARCELA AZEVEDO POLETO",
        "login": "marcela",
        "ad_status": "active",
        "since": "2026-10-08T13:59:51",
        "added_by": null,
        "added_by_name": null
      }
    ]
  }
}
```

| Campo | Tipo | Observação |
|---|---|---|
| `user_id` | `number` | id do `_user` |
| `name` / `login` | `string` | nome e login de rede |
| `ad_status` | `string` | `active`, `blocked`, ... Um administrador bloqueado continua na lista, mas não conta como administrador ativo e não recebe avisos: mostre um selo "Inativo" |
| `since` | `string` | desde quando, **hora local sem fuso** (`"2026-10-16T13:25:20"`). Não converta com fuso: formate o texto como vem |
| `added_by` / `added_by_name` | `number \| null` / `string \| null` | quem adicionou. `null` = vínculo criado antes da tela (por SQL): mostre "—" |

Os donos do sistema **não** aparecem na lista (administram tudo sem vínculo),
salvo quem também foi adicionado ao espaço. Mostre uma nota fixa: "Os donos do
sistema também administram todos os espaços."

### 3. `POST /global/spaces/:id/admins`

Corpo `{ "user_id": 68 }`. Só o dono. **Idempotente** (adicionar quem já é
administrador não é erro e não muda "desde" nem "adicionado por"). Responde
**200** com o mesmo objeto do GET, já atualizado: use a resposta, sem novo GET.

### 4. `DELETE /global/spaces/:id/admins/:user_id`

Só o dono. **Idempotente** (remover quem não é administrador não é erro).
Responde **200** com o mesmo objeto do GET, já atualizado.

### Erros

| Status | `code` | Quando | Rotas |
|---|---|---|---|
| 403 | `REPP_NOT_SPACE_ADMIN` | não administra o espaço nem é dono | GET |
| 403 | `REPP_MANAGE_ADMINS_FORBIDDEN` | não é dono do sistema ("Somente o dono do sistema pode adicionar ou remover administradores de espaço.") | POST, DELETE |
| 404 | `REPP_SPACE_NOT_FOUND` | espaço não existe | todas |
| 404 | `REPP_USER_NOT_FOUND` | usuário não existe ("Usuário não encontrado.") | POST, DELETE (id inválido) |
| 400 | `REPP_USER_INACTIVE` | usuário não está ativo ("Só é possível tornar administrador um usuário ativo.") | POST |
| 409 | `REPP_LAST_SPACE_ADMIN` | removeria o último administrador **ativo** ("O espaço precisa de pelo menos um administrador ativo. Adicione outro administrador antes de remover este.") | DELETE |
| 400 | `GENERIC_ERROR` | corpo sem `user_id` numérico (validador comum) | POST |

Nenhuma dessas recusas traz `fields`.

### Busca de usuários: `GET /global/access/users`

A rota da Gestão de Acessos que o front já usa. Para o dono do sistema ela
sempre responde. Filtre por ativos (só usuário ativo vira administrador) e
esconda da lista quem já é administrador do espaço.

## O que mudou em rotas que já existiam

- `GET /spaces` e `GET /spaces/me/managed`: ganharam `can_manage_admins`.
  Nada foi removido nem mudou de tipo.
- Adicionar/remover um administrador muda, **na hora**, o que essa pessoa
  recebe nas outras rotas (`can_manage`, `can_review`, fila de aprovação,
  isenção das regras de agenda, avisos). Ela vê isso no próximo
  `GET /spaces` — não há evento de WebSocket para essa mudança.

## Foco: UI/UX

1. **Acesso**: dentro do módulo de reservas, uma entrada "Administradores"
   visível em cada espaço com `can_manage: true` (aba no espaço, ou ação no
   card). Quem não administra nenhum espaço não vê.
2. **Lista** por espaço: nome, login, "desde {since}", "adicionado por
   {added_by_name}" (ou "—"), selo "Inativo" quando `ad_status !== 'active'`.
   Nota fixa sobre os donos do sistema.
3. **Adicionar** (só com `can_manage_admins`): botão que abre a busca de
   usuários (nome/login), mostra só ativos e quem ainda não é administrador;
   confirmar chama o `POST` e atualiza a lista com a resposta. Aviso no
   diálogo: "Esta pessoa poderá aprovar e recusar pedidos, ver os detalhes de
   todas as reservas do espaço e reservar sem as regras de antecedência e de
   dias bloqueados."
4. **Remover** (só com `can_manage_admins`): confirmação com o nome e o efeito
   ("deixará de aprovar pedidos e de receber avisos deste espaço; as reservas
   já aprovadas continuam valendo"). Quando só resta **um** administrador
   ativo, desabilite o remover dele com tooltip "Adicione outro administrador
   antes" — e trate o 409 `REPP_LAST_SPACE_ADMIN` de qualquer forma (a lista
   pode ter mudado).
5. **Estados**: loading, vazio (não deve acontecer, mas mostre "Nenhum
   administrador"), erro com "tentar de novo", 403 com a `message`.
6. **Depois de alterar**, recarregue `GET /spaces` se o usuário logado se
   adicionou ou se removeu (as flags dele mudam).
7. **Mobile**: lista em cards, ações em menu.

## Fora do escopo (não implementar sem meu de acordo)

Cadastro de espaço, permitir que o administrador do espaço gerencie outros,
histórico de quem já foi administrador, aviso ao usuário de que virou ou
deixou de ser administrador. Se achar que algo disso é necessário, **sugira e
peça "de acordo"**.

## Entrega

Antes de codar: a análise e a lista de sugestões. Depois do meu de acordo:
código completo e um resumo de como testar com três usuários (um dono do
sistema, a administradora do espaço e um usuário comum):

1. administradora abre "Administradores" do espaço dela → vê a lista sem
   botões; não vê a entrada nos espaços que não administra;
2. dono adiciona o usuário comum → ele aparece com "adicionado por" e
   "desde"; o usuário comum, ao recarregar, passa a ver a fila de aprovação e
   `can_manage` no espaço;
3. dono adiciona de novo a mesma pessoa → nada muda, sem erro;
4. dono tenta adicionar um usuário inativo → mensagem de
   `REPP_USER_INACTIVE`;
5. dono remove até sobrar um → o botão do último fica desabilitado; forçando
   a chamada, aparece a mensagem de `REPP_LAST_SPACE_ADMIN`;
6. administradora tenta chamar `POST` (ex.: pela devtools) → 403
   `REPP_MANAGE_ADMINS_FORBIDDEN` tratado com a mensagem.
