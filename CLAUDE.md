# CLAUDE.md — Contexto do projeto gpprh/api

## Stack
- **Node.js / Express** — API REST em `\\192.168.0.99\gpprh\api\src`
- **MySQL** (`poolGlobal`) — banco `global` em `10.10.10.99`
- **SQL Server** (mssql) — banco GIPP/Protheus em `10.10.10.51`
- **Oracle** (oracledb Thick mode) — ERP Consinco em `10.10.10.191:1521/orcl`
- **Docker Compose** — 3 containers no servidor `192.168.0.99` (ver **Deploy** abaixo)
- **URL produção** — `https://vagas.gpprh.com.br/api/v1/global/`

## Deploy

⚠️ Desde **2026-08-06** quem atende a produção são **containers Docker**. O PM2 **do host** (`api-gpprh`, `ws-gpprh`, `front-gpprh`) foi parado nessa data — `pm2 restart api-gpprh` no host **não surte efeito nenhum**.

Compose project `api`, em `/home/administrador/Documents/gpprh/api` (Ubuntu 24.04, Docker 29.1.3, Compose v2.40.3). Todas as portas são publicadas **só no loopback** — quem alcança os containers é o Apache do próprio host.

| Container | Porta (host) | Papel | Dockerfile |
|---|---|---|---|
| `api-gipp-enterprises` | `127.0.0.1:4002` | Backend interno (GTPP, EPP, GAPP, GIPP-RH, Protheus, chat) | `Dockerfile.internal` |
| `ws-gipp-enterprises` | `127.0.0.1:4011` → `4001` no container | WebSocket (mesma imagem do interno, só o comando muda) | `Dockerfile.internal` |
| `api-gpprh` | `127.0.0.1:4010` | Backend público (site de vagas / candidatos) | `Dockerfile.public` |

**Aplicar mudança de código:** `docker compose build && docker compose up -d` no diretório acima.

**Diagnosticar:** `docker compose ps` / `docker compose logs -f <serviço>` — nunca `pm2 list` no host.

### PM2 ainda existe — dentro do container interno
O `Dockerfile.internal` roda `pm2-runtime start ecosystem.docker.config.js`, que sobe `src/server.internal.js` em **cluster com 2 instâncias**. Motivo: o cluster mode compartilha uma porta única, que é como o Apache enxerga o upstream. São dois arquivos ecosystem e só um está vivo:

| Arquivo | Onde roda | Status |
|---|---|---|
| `ecosystem.config.js` (raiz) | PM2 do host | **morto** — histórico |
| `ecosystem.docker.config.js` | `pm2-runtime` no container | **ativo — não apagar** |

### Detalhes que só funcionam dentro do Compose
- A porta do WebSocket é **hardcoded 4001** em `src/websocket/websocketServer.js` — só funciona pelo mapeamento `4011:4001`.
- `WS_EMIT_URL` resolve `ws-gipp-enterprises` **por nome de container** na rede `api_default`.
- `MYSQL_HOST=host.docker.internal` — o MySQL do banco `gpprh` está no host, não no container.
- Oracle Instant Client é **bind mount** de `/opt/oracle/instantclient_19_27` (não embutido na imagem); sem `LD_LIBRARY_PATH` → `DPI-1047`.
- Os pares de segredo JWT são **diferentes** entre interno e público (`INTERNAL_JWT_*` / `PUBLIC_JWT_*` no `.env`): é isso que impede um token de candidato de ser verificável no lado interno.

## Autenticação
- **Apenas via cookie HttpOnly** (`accessToken`, `refreshToken`, `userRole`)
- ⚠️ NÃO modificar `auth.middleware.js`, `auth-session.service.js` nem `auth.controller.js` para adicionar Bearer token

## Regras de desenvolvimento

### ⚠️ Stored Procedures SQL Server — regra obrigatória
Antes de chamar qualquer stored procedure via `.execute('sp_nome')`, **sempre verificar os parâmetros reais da procedure** antes de escrever o código.

Nunca inferir nomes de parâmetros a partir de:
- Mensagens de erro do SQL Server (indicam apenas o que *faltou*, não todos os parâmetros)
- Nomes de variáveis no código Node.js existente
- Convenção ou suposição

**Procedimento correto:**
1. Pedir ao usuário: `EXEC sp_helptext 'nome_da_procedure'`
2. Ler todos os parâmetros (`@nome tipo`)
3. Só então escrever os `.input('nome', sql.Tipo, valor)` — o nome no `.input()` deve ser idêntico ao `@nome` da SP (sem o `@`)

**Exemplo do erro que motivou essa regra (2026-06-09):**
```
"Procedure 'sp_update_gipp_rh_compensation' expects parameter '@user_branch', which was not supplied."
```
O código tinha `.input('branch_code', ...)`. A correção foi feita sem ver a SP completa — apenas trocou `branch_code` por `user_branch` baseado na mensagem de erro, sem confirmar os demais parâmetros.

---

## Módulos principais
- **EPP** (Encomendas por Pedido) — produtos, menus, pedidos, log_sales, estoque
- **GTPP** (Gestão de Tarefas) — tarefas, itens, usuários, histórico, score
- **GIPP-RH** — compensações, beneficiários, recibos de pagamento
- **BPPP** (Busca de Preço) — consulta de preço/estoque no Consinco (somente leitura)
- **Auth** — login/logout/me via cookie

## Permissões EPP
| Código | Escopo |
|---|---|
| `EPP_USE` | Leitura geral |
| `EPP_ORDERS` | Ver, criar e atualizar pedidos |
| `EPP_PRODUCTS` | Cadastrar e editar produtos, menus e log_menus |
| `EPP_VIEW_RECIPE` | Acessar receitas Oracle (mobile, oracle_receipe) |
| `MANAGE_EPP` | Administração total |

## Permissões BPPP
| Código | Escopo |
|---|---|
| `BPPP_USE` | `GET /bppp/products` — consulta de preço/estoque/EAN no Consinco |
| `BPPP_MANAGE` | Administração do módulo (hoje equivale a `BPPP_USE`) |

Seed: `src/modules/global/repositories/mysql/bppp-permissions.sql`
