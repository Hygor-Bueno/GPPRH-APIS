/**
 * @fileoverview Casos de uso — identificadores do ativo GAPP (patrimônio e
 * número de série), na tabela `gapp_active_identifiers`.
 *
 * - Só ativos do `work_group_fk` do usuário autenticado (nunca do body).
 * - Um identificador (tipo + valor) pertence a um único ativo.
 * - Cada ativo tem no máximo um principal; o primeiro cadastrado já nasce
 *   principal e, se o principal for removido, o mais antigo assume.
 *
 * @module modules/global/application/gapp/active-identifier/gapp-active-identifier.use-cases
 */

const { AppError } = require('../../../../../errors/app.error');

const IDENTIFIER_TYPES = Object.freeze(['PATRIMONIO', 'SERIAL']);
const MAX_IDENTIFIER_LENGTH = 150;
/** Teto de identificadores enviados junto com o cadastro do ativo. */
const MAX_IDENTIFIERS_ON_CREATE = 20;

const identifierKey = ({ type, value }) => `${type}|${value.toUpperCase()}`;

/** Lista do cadastro do ativo novo: cada item válido e nenhum repetido entre si. */
function normalizeIdentifierList(list) {
    if (!Array.isArray(list)) return { error: "O campo 'identifiers' deve ser uma lista." };
    if (list.length > MAX_IDENTIFIERS_ON_CREATE) return { error: `Envie no máximo ${MAX_IDENTIFIERS_ON_CREATE} identificadores.` };
    const items = [];
    for (const raw of list) {
        const { value, error } = normalizeIdentifier(raw);
        if (error) return { error };
        if (items.some(item => identifierKey(item) === identifierKey(value))) return { error: `Identificador repetido na lista: ${value.value}.` };
        items.push(value);
    }
    return { items };
}

/**
 * Tipo da lista e valor sem espaços nas pontas.
 * @returns {{ value?: { type: string, value: string, isPrimary: boolean }, error?: string }}
 */
function normalizeIdentifier(data = {}) {
    if (!IDENTIFIER_TYPES.includes(data.identifier_type)) {
        return { error: "O campo 'identifier_type' deve ser PATRIMONIO (patrimônio) ou SERIAL (número de série)." };
    }
    const value = String(data.identifier_value ?? '').trim();
    if (!value) return { error: `Informe o número de ${data.identifier_type === 'SERIAL' ? 'série' : 'patrimônio'}.` };
    if (value.length > MAX_IDENTIFIER_LENGTH) {
        return { error: `O identificador deve ter no máximo ${MAX_IDENTIFIER_LENGTH} caracteres.` };
    }
    const isPrimary = data.is_primary === true || Number(data.is_primary) === 1;
    return { value: { type: data.identifier_type, value, isPrimary } };
}

class GappActiveIdentifierUseCases {
    /**
     * @param {Object} deps
     * @param {import('./ports/active-identifier-repository.port').ActiveIdentifierRepositoryPort} deps.repository
     * @param {import('../ports/gapp-user-repository.port').GappUserRepositoryPort} deps.userRepository
     */
    constructor({ repository, userRepository }) {
        this.repository = repository;
        this.userRepository = userRepository;
    }

    /** @private 404 se o usuário não está no GAPP ou o ativo não é do grupo dele. */
    async _scopedActiveId(activeId, currentUser) {
        const gappUser = await this.userRepository.findAuthByAccessCode(currentUser?.id);
        if (!gappUser) throw new AppError('Usuário autenticado não está cadastrado no GAPP (access_code não localizado)', 404);
        const id = Number(activeId);
        if (!(await this.repository.activeInGroup(id, gappUser.work_group_fk))) throw new AppError('Ativo não encontrado', 404);
        return id;
    }

    /** @private 409 quando o tipo + valor já pertence a outro ativo (ou já está neste). */
    async _assertAvailable(activeId, { type, value }) {
        const owner = await this.repository.findByValue(type, value);
        if (!owner) return;
        const sameAsset = Number(owner.active_id_fk) === activeId;
        throw new AppError(sameAsset ? 'Este identificador já está cadastrado neste ativo.' : `Este identificador já está cadastrado no ativo #${owner.active_id_fk}.`, 409, {
            code: 'GAPP_ACTIVE_IDENTIFIER_IN_USE',
            details: { active_id: owner.active_id_fk },
        });
    }

    /**
     * Cadastro do ativo novo: valida a lista ANTES de gravar o ativo, para uma
     * recusa (formato, repetido, já usado em outro ativo) não deixar ativo criado.
     * @returns {Promise<object[]>} itens prontos para `addToNewAsset`
     */
    async prepareForNewAsset(list) {
        if (list == null) return [];
        const { items, error } = normalizeIdentifierList(list);
        if (error) throw new AppError(error, 400);
        for (const item of items) await this._assertAvailable(0, item);
        return items;
    }

    /** Grava a lista já validada no ativo recém-criado; principal = o marcado, ou o primeiro. */
    async addToNewAsset(activeId, items) {
        if (!items.length) return;
        const ids = [];
        for (const item of items) ids.push((await this.repository.insert(activeId, item.type, item.value)).insertId);
        const primary = Math.max(0, items.findIndex(item => item.isPrimary));
        await this.repository.setPrimary(ids[primary], activeId);
    }

    async list(activeId, currentUser) {
        const id = await this._scopedActiveId(activeId, currentUser);
        return this.repository.listByActive(id);
    }

    /** Cadastra e devolve a lista atualizada. O primeiro do ativo já é o principal. */
    async create(activeId, data, currentUser) {
        const id = await this._scopedActiveId(activeId, currentUser);
        const { value, error } = normalizeIdentifier(data);
        if (error) throw new AppError(error, 400);
        await this._assertAvailable(id, value);

        const isFirst = (await this.repository.listByActive(id)).length === 0;
        const { insertId } = await this.repository.insert(id, value.type, value.value);
        if (isFirst || value.isPrimary) await this.repository.setPrimary(insertId, id);
        return this.repository.listByActive(id);
    }

    async setPrimary(activeId, identifierId, currentUser) {
        const id = await this._scopedActiveId(activeId, currentUser);
        const identifier = await this.repository.findById(Number(identifierId), id);
        if (!identifier) throw new AppError('Identificador não encontrado.', 404);
        await this.repository.setPrimary(identifier.identifier_id, id);
        return this.repository.listByActive(id);
    }

    /** Remove; se era o principal, o mais antigo que sobrou assume. */
    async remove(activeId, identifierId, currentUser) {
        const id = await this._scopedActiveId(activeId, currentUser);
        const { deleted } = await this.repository.delete(Number(identifierId), id);
        if (!deleted) throw new AppError('Identificador não encontrado.', 404);

        const remaining = await this.repository.listByActive(id);
        if (remaining.length && !remaining.some(row => Number(row.is_primary) === 1)) {
            await this.repository.setPrimary(remaining[0].identifier_id, id);
            return this.repository.listByActive(id);
        }
        return remaining;
    }
}

module.exports = { GappActiveIdentifierUseCases, normalizeIdentifier, normalizeIdentifierList, IDENTIFIER_TYPES };
