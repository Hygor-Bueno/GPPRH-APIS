/**
 * @fileoverview Casos de uso dos moldes de termo de ativo (gapp_asset_term_template).
 *
 * O molde é o texto do termo com campos dinâmicos (`@nome@`, `@imei@`...) e
 * marcações simples de formatação. Aqui só se configura o molde; a geração do
 * termo a partir dele é o próximo passo.
 *
 * - Cada molde vale para um tipo de ativo; um tipo pode ter mais de um molde
 *   (ex.: um por empresa, com a razão social no próprio texto).
 * - Campo que não existe para o tipo é recusado (400) — senão o termo sairia
 *   com `@campo@` impresso no lugar do dado.
 * - Não há exclusão: molde fora de uso é inativado (`status_template = 0`),
 *   porque termos gerados poderão apontar para ele.
 *
 * @module modules/global/application/gapp/asset-term-template/gapp-asset-term-template.use-cases
 */

const { AppError } = require('../../../../../errors/app.error');
const {
    ASSET_TYPES, ASSET_TYPE_VALUES, FIELD_GROUPS, unknownFieldKeys,
} = require('../../../domain/gapp/asset-term/term-template.fields');

const STATUS_ACTIVE = 1;

class GappAssetTermTemplateUseCases {
    /** @param {{ repository: import('./ports/asset-term-template-repository.port').AssetTermTemplateRepositoryPort }} deps */
    constructor({ repository }) {
        this.repository = repository;
    }

    /** Catálogo de tipos e campos dinâmicos (usado pela tela e pela geração). */
    getFields() {
        return { asset_types: ASSET_TYPES, groups: FIELD_GROUPS };
    }

    async listTemplates(filters = {}) {
        return this.repository.list(filters);
    }

    async getTemplateById(id) {
        const template = await this.repository.findById(Number(id));
        if (!template) throw new AppError('Molde não encontrado.', 404, { code: 'GAPP_ASSET_TERM_TEMPLATE_NOT_FOUND' });
        return template;
    }

    async createTemplate(data, userId) {
        const fields = this._normalize(data);
        await this._validate(fields, 0);
        const { insertId } = await this.repository.insert({ ...fields, user_id: userId });
        return this.getTemplateById(insertId);
    }

    async updateTemplate(id, data, userId) {
        const current = await this.getTemplateById(id);
        // O que não vier mantém o valor atual
        const fields = this._normalize({ ...current, ...this._defined(data) });
        await this._validate(fields, current.asset_term_template_id);
        await this.repository.update(current.asset_term_template_id, { ...fields, user_id: userId });
        return this.getTemplateById(current.asset_term_template_id);
    }

    /** @private Só as chaves enviadas (undefined/null não sobrescrevem o atual). */
    _defined(data = {}) {
        return Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined && value !== null));
    }

    /** @private */
    _normalize(data) {
        return {
            name: String(data.name ?? '').trim(),
            asset_type: data.asset_type,
            content: String(data.content ?? '').replace(/\r\n/g, '\n').trim(),
            status_template: data.status_template === undefined ? STATUS_ACTIVE : Number(data.status_template),
        };
    }

    /** @private Regras que o schema da rota não cobre (tipo, campos dinâmicos, nome único). */
    async _validate(fields, ignoreId) {
        if (!fields.name) throw new AppError('Informe o nome do molde.', 400);
        if (!ASSET_TYPE_VALUES.includes(fields.asset_type)) {
            throw new AppError(`Tipo de ativo inválido. Use: ${ASSET_TYPE_VALUES.join(', ')}.`, 400);
        }
        if (!fields.content) throw new AppError('O conteúdo do molde não pode ficar vazio.', 400);

        const unknown = unknownFieldKeys(fields.content, fields.asset_type);
        if (unknown.length) {
            throw new AppError(
                `Campos que não existem para este tipo de ativo: ${unknown.map(key => `@${key}@`).join(', ')}.`,
                400,
                { code: 'GAPP_ASSET_TERM_TEMPLATE_UNKNOWN_FIELDS', details: unknown },
            );
        }
        if (await this.repository.nameExists(fields.name, fields.asset_type, ignoreId)) {
            throw new AppError('Já existe um molde com este nome para este tipo de ativo.', 409, {
                code: 'GAPP_ASSET_TERM_TEMPLATE_NAME_TAKEN',
            });
        }
    }
}

module.exports = { GappAssetTermTemplateUseCases };
