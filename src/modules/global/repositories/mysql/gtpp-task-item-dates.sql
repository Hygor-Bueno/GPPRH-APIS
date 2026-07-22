-- ============================================================
-- Adiciona campos de prazo por item de tarefa (GTPP)
-- Execute uma vez no banco `global`
-- ============================================================

ALTER TABLE gt_task_item
    ADD COLUMN initial_date DATE NULL DEFAULT NULL AFTER note,
    ADD COLUMN final_date   DATE NULL DEFAULT NULL AFTER initial_date;

-- Índice para facilitar queries de "itens em atraso" no futuro
CREATE INDEX idx_gt_task_item_dates ON gt_task_item (initial_date, final_date);
