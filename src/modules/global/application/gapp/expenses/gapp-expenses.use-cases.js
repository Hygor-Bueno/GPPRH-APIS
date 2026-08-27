/**
 * @fileoverview Casos de uso — Despesas GAPP.
 *
 * `user_id_fk`/`work_group_fk` nunca vêm do body — resolvidos via
 * `userRepository`. O reuso da gravação de seguro (tipo "Seguro") fica só a
 * nível de SQL cru dentro do adapter — este use-case NÃO recebe o port de
 * Insurance.
 *
 * @module modules/global/application/gapp/expenses/gapp-expenses.use-cases
 */

const { AppError } = require('../../../../../errors/app.error');
const { ExpenseType } = require('../../../domain/gapp/expenses/expense-type.enum');
const { pickTypeDetail } = require('../../../domain/gapp/expenses/expense-detail.selector');
const { resolveFuelDetail } = require('../../../domain/gapp/expenses/fuel-detail.calculator');
const { shapeExpenseDetail } = require('../../../domain/gapp/expenses/expense-detail.shaper');

class GappExpensesUseCases {
    /**
     * @param {Object} deps
     * @param {import('./ports/expenses-repository.port').ExpensesRepositoryPort} deps.repository
     * @param {import('../ports/gapp-user-repository.port').GappUserRepositoryPort} deps.userRepository
     */
    constructor({ repository, userRepository }) {
        this.repository = repository;
        this.userRepository = userRepository;
    }

    /**
     * @throws {AppError} 404 se o usuário autenticado não estiver no GAPP.
     */
    async _resolveGappUser(currentUser) {
        const gappUser = await this.userRepository.findAuthByAccessCode(currentUser?.id);
        if (!gappUser) {
            throw new AppError('Usuário autenticado não está cadastrado no GAPP (access_code não localizado)', 404);
        }
        return gappUser;
    }

    /**
     * Se `activeId` vier preenchido, garante que o ativo pertence ao
     * work_group_fk do usuário antes de aceitar o vínculo.
     * @throws {AppError} 404 se o ativo não existir ou for de outro grupo.
     */
    async _assertActiveOwnership(activeId, workGroupFk) {
        if (activeId == null) return;
        const active = await this.repository.findActiveWorkGroup(activeId);
        if (!active || active.work_group_fk !== workGroupFk) {
            throw new AppError('Ativo não encontrado no seu grupo de trabalho', 404);
        }
    }

    /**
     * Seleciona o detalhe correspondente ao tipo e, se for Combustível,
     * resolve `liter_value` quando ausente — pura orquestração de domínio,
     * sem I/O.
     */
    _resolveDetail(data, expTypeId) {
        const detail = pickTypeDetail(data);
        if (detail && Number(expTypeId) === ExpenseType.FUEL) {
            return resolveFuelDetail(detail, data.total_value);
        }
        return detail;
    }

    async create(data, currentUser) {
        const gappUser = await this._resolveGappUser(currentUser);
        await this._assertActiveOwnership(data.active_id_fk, gappUser.work_group_fk);

        const payload = { ...data, user_id_fk: gappUser.user_id };
        const detail = this._resolveDetail(data, data.exp_type_id_fk);

        return this.repository.createExpenseWithDetail(payload, data.exp_type_id_fk, detail, data.active_id_fk);
    }

    /**
     * `exp_type_id_fk` é definitivo — não pode ser alterado depois do
     * cadastro (trava de segurança; o front tem telas distintas por tipo).
     * @throws {AppError} 404 se a despesa não existir; 400 se tentar mudar o tipo.
     */
    async update(id, data, currentUser) {
        const gappUser = await this._resolveGappUser(currentUser);
        await this._assertActiveOwnership(data.active_id_fk, gappUser.work_group_fk);

        const current = await this.repository.findExpenseType(id);
        if (!current) throw new AppError('Despesa não encontrada', 404);
        if (Number(current.exp_type_id_fk) !== Number(data.exp_type_id_fk)) {
            throw new AppError("Não é possível alterar o tipo de uma despesa já registrada ('exp_type_id_fk')", 400);
        }

        const payload = { ...data, expen_id: id };
        const detail = this._resolveDetail(data, current.exp_type_id_fk);

        return this.repository.updateExpenseWithDetail(id, payload, current.exp_type_id_fk, detail, data.active_id_fk);
    }

    /**
     * Despesas de qualquer ativo, só com os campos genéricos. Restrito ao
     * work_group_fk do usuário.
     */
    async list(filters, currentUser) {
        const gappUser = await this._resolveGappUser(currentUser);
        const scopedFilters = { ...filters, work_group_fk: gappUser.work_group_fk };
        return this.repository.list(scopedFilters);
    }

    /**
     * Despesas restritas a ativos que são veículo. Restrito ao work_group_fk
     * do usuário.
     */
    async listVehicleExpenses(filters, currentUser) {
        const gappUser = await this._resolveGappUser(currentUser);
        const scopedFilters = { ...filters, work_group_fk: gappUser.work_group_fk };
        return this.repository.listVehicleExpenses(scopedFilters);
    }

    /**
     * Despesa com o detalhe do tipo aninhado. Restrito ao work_group_fk do
     * usuário.
     */
    async getById(id, currentUser) {
        const gappUser = await this._resolveGappUser(currentUser);
        const row = await this.repository.findExpenseById(id, gappUser.work_group_fk);
        if (!row) throw new AppError('Despesa não encontrada', 404);
        return shapeExpenseDetail(row);
    }
}

module.exports = { GappExpensesUseCases };
