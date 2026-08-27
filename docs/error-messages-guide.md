# Guia de Mensagens de Erro

## Regra geral

| O que é | Idioma | Motivo |
|---|---|---|
| Mensagem que o **usuário** vê (400, 403, 404, 422) | **Português** | UX — usuário é BR |
| Mensagem que o **usuário** vê em falhas internas (500) | **Português** | Mesmo motivo |
| `console.error` / `console.warn` — logs do servidor | **Inglês** | Fácil de pesquisar, padrão da indústria |
| Stack traces e mensagens de bibliotecas | Inglês (automático) | Não controlamos |

---

## Exemplos práticos

### ✅ Correto

```javascript
// Erro de validação → usuário vê → Português
throw new AppError('Campo `to_user_id` é obrigatório.', 400);

// Erro de negócio → usuário vê → Português
throw new AppError('Arquivo não encontrado.', 404);

// Erro interno → usuário vê mensagem genérica → Português
throw new AppError('Erro interno do servidor. Tente novamente mais tarde.', 500);

// Log interno → Inglês
console.error('[chat:send] Failed to save message (userId=148):', err.message);
console.warn('[FileService] sharp not installed — WebP conversion unavailable.');
```

### ❌ Incorreto

```javascript
// Log em português
console.error('Erro ao salvar mensagem:', err.message); // ❌

// Mensagem de usuário em inglês
throw new AppError('File not found.', 404); // ❌

// Mensagem técnica exposta ao usuário
throw new AppError(`MySQL error: ${err.message}`, 500); // ❌ expõe detalhe interno
```

---

## AppError — quando usar cada status

| Status | Quando usar | Exemplo |
|---|---|---|
| `400` | Dado inválido enviado pelo cliente | `'Campo obrigatório ausente.'` |
| `401` | Não autenticado | `'Sessão expirada. Faça login novamente.'` |
| `403` | Autenticado mas sem permissão | `'Você não tem permissão para acessar este recurso.'` |
| `404` | Recurso não encontrado | `'Arquivo não encontrado.'` |
| `409` | Conflito (duplicado, etc.) | `'E-mail já cadastrado.'` |
| `422` | Dado semanticamente inválido | `'Data de início não pode ser maior que a data de fim.'` |
| `500` | Falha interna inesperada | `'Erro interno do servidor. Tente novamente mais tarde.'` |

---

## Erros 500 — nunca exponha detalhes técnicos

```javascript
// ❌ Expõe estrutura interna do banco
throw new AppError(`Erro: ${dbErr.message}`, 500);

// ✅ Mensagem genérica para o usuário + log detalhado para o servidor
console.error('[files] Failed to insert record:', dbErr.message);
throw new AppError('Não foi possível salvar o arquivo. Tente novamente.', 500);
```

---

## Prefixo nos logs

Use sempre um prefixo entre colchetes para facilitar o `grep` nos logs:

```javascript
console.error('[chat:send] Failed to emit event:', err.message);
console.error('[FileService] WebP conversion failed:', err.message);
console.warn('[auth] Invalid token attempt from IP:', req.ip);
```

Padrão: `[modulo:acao]` em minúsculas.

---

## Estado da tradução (24/08/2026)

Foi feita uma varredura completa do `src/`: **88 mensagens de usuário que estavam
em inglês foram traduzidas** — validação de schema, autenticação, LDAP, Google,
vagas, recibos, prestadores, fotos, rate limit, 404 de rota e as classes de erro
base. Hoje **não há nenhuma mensagem de usuário em inglês** no backend.

Identificadores seguem em inglês, por decisão: nomes de variável, de função, o
campo `code` do `AppError` (`SCHEDULE_NOT_FOUND`, `RATE_LIMIT_USER`, …) e as
chaves de payload. Só o texto destinado a gente foi traduzido.

### O que deliberadamente NÃO foi traduzido

| O que | Onde | Por quê |
|---|---|---|
| `throw new Error('Not implemented')` | ~306 ocorrências nas portas (`*.port.js`) | Marcador de contrato de arquitetura. Só dispara quando um adapter esquece de implementar um método da porta — nunca chega ao usuário, é lido por quem programa. |
| `console.error` / `console.warn` | todo o `src/` | Regra deste guia: log em inglês, para `grep` e por ser padrão da indústria. |

### ⚠️ Para o frontend

O texto da mensagem **não é contrato**. Quem precisa decidir comportamento a
partir de um erro deve usar o campo `code` do `AppError`, não comparar strings —
esta varredura mudou 88 textos de uma vez, e a próxima pode mudar mais.
