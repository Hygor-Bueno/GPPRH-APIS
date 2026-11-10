-- =============================================================================
-- GAPP — Migração TEMPORÁRIA dos termos de smartphone do sistema legado
-- =============================================================================
--
-- Controle e auditoria da importação dos arquivos de termo do sistema antigo
-- (`<codigo>-<nome>.<ext>`) para `global.gapp_asset_term`.
--
-- O arquivo NÃO é guardado aqui: ele passa pelo FileService (validação, hash
-- SHA-256, deduplicação, `_files`) e o vínculo é a linha normal de
-- `gapp_asset_term` — exatamente o mesmo caminho do POST /gapp/asset-term.
-- Esta tabela só lembra o que aconteceu com cada arquivo de origem, para que a
-- migração possa ser retomada sem duplicar documento ou vínculo.
--
-- Sem FOREIGN KEY para as tabelas definitivas, de propósito:
--   * o módulo é temporário — `DROP TABLE` destas duas tabelas não pode
--     depender de nada nem travar nada;
--   * a integridade de `active_id_fk` / `asset_term_id_fk` / `file_id_fk` é
--     garantida pelo backend no momento da gravação (o termo é criado pelo
--     caso de uso de termos, que já checa o ativo).
--
-- Remoção: ver o bloco "ROLLBACK" no fim do arquivo.
-- =============================================================================

CREATE TABLE IF NOT EXISTS global.gapp_asset_term_migration (
    migration_id            INT            NOT NULL AUTO_INCREMENT,

    -- Origem -----------------------------------------------------------------
    source_file_name        VARCHAR(255)   NOT NULL COMMENT 'Nome original do arquivo (ex.: 1235-Fulano.pdf)',
    source_path             VARCHAR(500)   NOT NULL COMMENT 'Caminho relativo à pasta de origem (GAPP_TERM_MIGRATION_SOURCE_DIR)',
    source_file_size        BIGINT         NULL,
    source_modified_at      DATETIME       NULL     COMMENT 'mtime do arquivo na varredura',

    -- Identificação no legado ---------------------------------------------------
    legacy_smartphone_code  INT            NULL     COMMENT 'GIPP.gs_smartphone.codigo — número antes do primeiro hífen',
    reponsible_name         VARCHAR(100)   NULL     COMMENT 'Restante do nome do arquivo; vai para gapp_asset_term.reponsible_name',
    legacy_imei1            VARCHAR(15)    NULL,
    legacy_imei2            VARCHAR(15)    NULL,
    imei                    VARCHAR(15)    NULL     COMMENT 'IMEI que casou com a base nova',
    imei_source             VARCHAR(5)     NULL     COMMENT 'imei1 | imei2',

    -- Destino ----------------------------------------------------------------
    active_id_fk            INT            NULL     COMMENT 'global.gapp_active.active_id (smartphone localizado pelo IMEI)',
    asset_term_id_fk        INT            NULL     COMMENT 'global.gapp_asset_term.asset_term_id criado/reaproveitado',
    file_id_fk              INT            NULL     COMMENT 'global._files.id gerado pelo FileService',

    -- Controle ---------------------------------------------------------------
    status                  VARCHAR(20)    NOT NULL DEFAULT 'pending'
                            COMMENT 'pending | validated | processing | migrated | error | not_found | ignored',
    issue_code              VARCHAR(40)    NULL     COMMENT 'Motivo estável do erro/não localizado (ver term-migration.rules.js)',
    message                 VARCHAR(1000)  NULL,
    attempts                INT            NOT NULL DEFAULT 0 COMMENT 'Tentativas de migração (POST /migrate)',

    -- Auditoria (mesmo padrão do GAPP) -------------------------------------------
    created_by              INT            NULL,
    updated_by              INT            NULL,
    created_at              DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    validated_at            DATETIME       NULL,
    processing_started_at   DATETIME       NULL,
    migrated_at             DATETIME       NULL,

    PRIMARY KEY (migration_id),
    -- Reexecutar a varredura nunca duplica o mesmo arquivo de origem
    -- (500 x 4 bytes = 2000 bytes: cabe no limite de 3072 do InnoDB/ROW_FORMAT=DYNAMIC)
    UNIQUE KEY uq_gapp_term_migration_source (source_path),
    KEY idx_gapp_term_migration_status (status, migration_id),
    KEY idx_gapp_term_migration_legacy (legacy_smartphone_code),
    KEY idx_gapp_term_migration_active (active_id_fk),
    KEY idx_gapp_term_migration_imei (imei)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='TEMPORÁRIA — controle da migração de termos de smartphone do legado';

-- Trilha de cada operação relevante (varredura, validação, migração, ignorar...).
-- Só INSERT pelo backend.
CREATE TABLE IF NOT EXISTS global.gapp_asset_term_migration_log (
    log_id          INT            NOT NULL AUTO_INCREMENT,
    migration_id_fk INT            NOT NULL,
    action          VARCHAR(20)    NOT NULL COMMENT 'scan | validate | migrate | retry | ignore | restore',
    from_status     VARCHAR(20)    NULL,
    to_status       VARCHAR(20)    NOT NULL,
    message         VARCHAR(1000)  NULL,
    created_by      INT            NULL,
    created_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (log_id),
    KEY idx_gapp_term_migration_log_item (migration_id_fk, log_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='TEMPORÁRIA — histórico da migração de termos do legado';

-- -----------------------------------------------------------------------------
-- Acesso ao legado: o backend lê GIPP.gs_smartphone pelo MESMO usuário do
-- poolGlobal (mesmo servidor 10.10.10.99). Se o usuário da API não tiver
-- leitura no schema GIPP, conceder (ajuste o usuário/host):
--
--   GRANT SELECT ON GIPP.gs_smartphone TO '<usuario_api>'@'%';
--
-- Conferência rápida antes do primeiro lote:
--   SELECT codigo, imei1, imei2 FROM GIPP.gs_smartphone LIMIT 5;
-- -----------------------------------------------------------------------------

-- =============================================================================
-- ROLLBACK (quando a migração terminar e o módulo for removido)
-- =============================================================================
-- Os termos migrados são linhas normais de gapp_asset_term e PERMANECEM.
-- Guarde um relatório antes de apagar, se quiser a rastreabilidade:
--   SELECT * FROM global.gapp_asset_term_migration WHERE status = 'migrated';
--
-- DROP TABLE IF EXISTS global.gapp_asset_term_migration_log;
-- DROP TABLE IF EXISTS global.gapp_asset_term_migration;
