# CLAUDE.md — Contexto do projeto gpprh/api

## Stack
- **Node.js / Express** — API REST em `\\192.168.0.99\gpprh\api\src`
- **MySQL** (`poolGlobal`) — banco `global` em `10.10.10.99`
- **SQL Server** (mssql) — banco GIPP/Protheus em `10.10.10.51`
- **Oracle** (oracledb Thick mode) — ERP Consinco em `10.10.10.191:1521/orcl`
- **PM2** — processo `api-gpprh`; reiniciar com `pm2 restart api-gpprh`
- **URL produção** — `https://vagas.gpprh.com.br/api/v1/global/`

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
- **Auth** — login/logout/me via cookie

## Permissões EPP
| Código | Escopo |
|---|---|
| `USE_EPP` | Leitura geral |
| `EPP_ORDERS` | Ver, criar e atualizar pedidos |
| `EPP_PRODUCTS` | Cadastrar e editar produtos, menus e log_menus |
| `EPP_RECEIPE` | Acessar receitas Oracle (mobile, oracle_receipe) |
| `MANAGE_EPP` | Administração total |
