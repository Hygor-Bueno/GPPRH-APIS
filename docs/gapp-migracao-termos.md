# GAPP — Migração temporária de termos de smartphone do legado

Módulo **temporário** para importar os termos que o sistema antigo guarda numa
pasta (`<codigo>-<nome>.<ext>`) e vinculá-los aos smartphones da base atual.
Acesso: só `SYSTEM_OWNER`. Tela: **GAPP › Migração de Termos** (`/services/gapp-asset-term-migration`).

## Como o vínculo é decidido

1. Nome do arquivo → dígitos antes do **primeiro** hífen = `GIPP.gs_smartphone.codigo`;
   o restante (sem extensão) = `reponsible_name` do termo (até 100 caracteres).
2. `codigo` → `imei1` e `imei2` do legado.
3. IMEIs → `global.gapp_smartphone` (`imei_1` **ou** `imei_2`), só ativo existente em `gapp_active`.
4. Exatamente **um** ativo → `validated`. Nenhum → `not_found`. Mais de um
   (imei1 e imei2 em aparelhos diferentes, ou IMEI repetido na base) → `error / ASSET_AMBIGUOUS`.

O código antigo **nunca** é usado como id de ativo.

## Armazenamento — o mesmo de sempre

O termo é criado pelo `GappAssetTermUseCases.createAssetTerm` (o mesmo do
`POST /gapp/asset-term`): `FileService` (magic bytes, scan de PDF, SHA-256,
deduplicação, `_files`, módulo `GAPP`) e depois a linha em `gapp_asset_term`.
O documento abre pela rota genérica `/global/files/:fileId`, como qualquer termo.

> A especificação fala em "gravação no BLOB": no projeto atual o FileService
> grava em disco (`storage/uploads/GAPP/...`) com hash e registro em `_files` —
> BLOB só existe no legado do GTPP. Foi mantido o mecanismo atual, sem paralelo.

## Status e motivos

| status | significado |
|---|---|
| `pending` | identificado na pasta, aguardando validação |
| `validated` | ativo localizado pelo IMEI, pronto para migrar |
| `processing` | migrando agora (preso > 15 min = abandonado, o "Reprocessar" recupera) |
| `migrated` | termo criado (ou vínculo existente reaproveitado) |
| `error` | `INVALID_NAME`, `ASSET_AMBIGUOUS`, `SOURCE_FILE_MISSING`, `FILE_REJECTED`, `MIGRATION_FAILED` |
| `not_found` | `LEGACY_NOT_FOUND`, `LEGACY_WITHOUT_IMEI`, `ASSET_NOT_FOUND` |
| `ignored` | retirado manualmente (análise manual); "Devolver à fila" reabre |

## Contra duplicidade

- Varredura idempotente: chave única em `source_path`.
- Toda transição é `UPDATE ... WHERE status = <anterior>` — com 2 instâncias da API, só uma processa cada linha.
- Antes de criar o termo, procura termo do **mesmo ativo** com o **mesmo conteúdo** (hash em `_files`) ou mesmo nome de arquivo → reaproveita.
- O FileService deduplica o conteúdo por hash.

Atomicidade: o FileService usa conexão própria, então a ordem é a do cadastro
de termos — arquivo, depois vínculo. Se o vínculo falhar sobra no máximo um
`_files` órfão (deduplicado na próxima tentativa); nunca vínculo sem arquivo.

## Rotas (`/api/v1/global/gapp/term-migration`)

`GET /summary` · `GET /` (status, issue_code, search, page, limit) · `GET /:id` (com trilha) ·
`POST /scan` · `POST /validate {ids?|limit?}` (padrão 200) · `POST /migrate {ids?|limit?}` (padrão 10, teto 50) ·
`POST /retry {ids?|limit?}` · `PATCH /:id/ignore {reason?}` · `PATCH /:id/restore`.

## Implantação

1. Rodar `src/modules/global/repositories/mysql/gapp-term-migration-deploy.sql` no MySQL do `global`.
2. Garantir `SELECT` em `GIPP.gs_smartphone` para o usuário do `poolGlobal` (o SQL tem o `GRANT` comentado).
3. Montar a pasta do legado no container **somente leitura** e apontar a variável.
   No `docker-compose.yml`, serviço `api-gipp-enterprises`:

   ```yaml
   environment:
     GAPP_TERM_MIGRATION_SOURCE_DIR: /app/legacy_terms
   volumes:
     - /caminho/no/host/dos/termos:/app/legacy_terms:ro
   ```

   (Não foi adicionado ao compose versionado porque o caminho do host não
   existe ainda — um bind mount com origem inexistente impede o `up`.)
4. `docker compose build && docker compose up -d`.

## Roteiro sugerido

Identificar arquivos → Validar vínculos → conferir o painel (não localizados e
erros) → **Migrar lote de teste (5)** → abrir 2 ou 3 termos em GAPP › Termos de
Ativos → migrar o restante em lotes → Reprocessar erros → Ignorar o que for
análise manual.

## Remoção (quando terminar)

Os termos migrados ficam — são linhas normais de `gapp_asset_term`.

Backend: apagar o `require` e o `router.use('/gapp/term-migration', ...)` em
`modules/global/routes.js` e os arquivos:

- `modules/global/gapp-term-migration.routes.js`
- `modules/global/controllers/gapp-term-migration.controller.js`
- `modules/global/application/gapp/term-migration/` (pasta)
- `modules/global/domain/gapp/term-migration/` (pasta)
- `modules/global/infrastructure/gapp/mysql-term-migration.repository.js`
- `modules/global/infrastructure/gapp/fs-term-migration.source.js` (+ teste em `__tests__`)
- `modules/global/repositories/mysql/gapp-term-migration.queries.js`
- `schemas/gapp-term-migration.schema.js`
- a variável e o volume do compose; depois o bloco ROLLBACK do `.sql`.

Front: a entrada `asset-term-migration` em `entities/service/model/catalog.ts`,
a linha em `SERVICE_PAGES` (`app/routes/App.tsx`), `pages/Services/Gapp/AssetTermMigration.tsx`
e a pasta `features/gapp/term-migration/`.
