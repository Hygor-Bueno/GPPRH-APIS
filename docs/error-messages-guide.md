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
