/**
 * @fileoverview Casos de uso do ajuste de ponto: lançar, cancelar, listar e
 * abrir o anexo.
 *
 * Ajuste vale assim que é lançado (decisão de 08/10/2026), com autoria
 * obrigatória. A resposta de lançar e de cancelar já traz o DIA recalculado —
 * a tela tira a ocorrência da lista com essa resposta, sem recarregar tudo.
 *
 * @module modules/global/application/cppp/adjustment/cppp-adjustment.use-cases
 */

const { AppError } = require('../../../../../errors/app.error');
const { normalizePagination, paginated, optionalFlag } = require('../../../domain/shared/pagination.rules');
const { AdjustmentType, AfdRecordType, values } = require('../../../domain/cppp/cppp.enums');
const { normalizeAdjustment } = require('../../../domain/cppp/adjustment/adjustment.rules');
const { toApiAdjustment } = require('../../../domain/cppp/adjustment/adjustment.shaper');
const { localDate, isDate } = require('../../../domain/cppp/date.rules');

/** Atestado e declaração chegam em papel: PDF ou foto. */
const ACCEPTED_ATTACHMENT = (mime) => mime === 'application/pdf' || String(mime).startsWith('image/');

class CpppAdjustmentUseCases {
    /**
     * @param {object} deps
     * @param {import('../ports/cppp-adjustment-repository.port').CpppAdjustmentRepositoryPort} deps.adjustments
     * @param {import('../ports/cppp-afd-repository.port').CpppAfdRepositoryPort} deps.afd
     * @param {import('../ports/cppp-external.ports').CpppAttachmentStoragePort} deps.attachments
     * @param {{day: Function}} deps.inconsistency - para devolver o dia recalculado.
     * @param {{maxPeriodDays: number}} deps.config
     * @param {() => Date} [deps.now]
     */
    constructor({ adjustments, afd, attachments, inconsistency, config, now = () => new Date() }) {
        this.adjustments = adjustments;
        this.afd = afd;
        this.attachments = attachments;
        this.inconsistency = inconsistency;
        this.config = config;
        this.now = now;
    }

    /**
     * @param {{input: object, file?: Express.Multer.File, actor: {id: number}}} params
     * @returns {Promise<{adjustment: object, day: object}>}
     */
    async create({ input, file = null, actor }) {
        const authorId = this._requireActor(actor);

        const adjustment = normalizeAdjustment(input, {
            today: localDate(this.now()),
            maxPeriodDays: this.config.maxPeriodDays,
        });

        if (adjustment.type === AdjustmentType.DESCONSIDERAR_LEITURA) {
            await this._assertReading(adjustment);
        }

        // Primeira barreira pelo tipo declarado pelo cliente, antes de gravar
        // qualquer coisa; a segunda é o tipo detectado pelos bytes, no retorno.
        if (file && !ACCEPTED_ATTACHMENT(file.mimetype)) {
            throw new AppError(`O anexo precisa ser PDF ou imagem (recebido: ${file.mimetype}).`, 400);
        }

        let attachmentFileId = null;
        if (file) {
            const stored = await this.attachments.save(file, authorId);
            if (!ACCEPTED_ATTACHMENT(stored.mimeType)) {
                throw new AppError(`O anexo precisa ser PDF ou imagem (conteúdo detectado: ${stored.mimeType}).`, 400);
            }
            attachmentFileId = stored.fileId;
        }

        const id = await this.adjustments.insert({ ...adjustment, attachmentFileId }, authorId);
        if (id === null) {
            throw new AppError('Essa leitura já está desconsiderada por outro ajuste ativo.', 409, {
                code: 'CPPP_READING_ALREADY_DISREGARDED',
            });
        }

        return {
            adjustment: toApiAdjustment(await this.adjustments.findById(id)),
            day: await this.inconsistency.day(adjustment.cpf, adjustment.workDate),
        };
    }

    /**
     * Desfaz um ajuste lançado por engano. Nada é apagado: o ajuste fica, com
     * quem cancelou, quando e por quê.
     */
    async cancel({ id, reason, actor }) {
        const authorId = this._requireActor(actor);
        const text = String(reason ?? '').trim();
        if (text.length < 3 || text.length > 500) {
            throw new AppError('O motivo do cancelamento é obrigatório (3 a 500 caracteres).', 400);
        }

        const adjustment = await this.adjustments.findById(Number(id));
        if (!adjustment) throw new AppError('Ajuste não encontrado.', 404);
        if (adjustment.canceledAt) throw new AppError('Este ajuste já foi cancelado.', 409);

        const canceled = await this.adjustments.cancel(adjustment.id, authorId, text);
        if (!canceled) throw new AppError('Este ajuste já foi cancelado.', 409);

        return {
            adjustment: toApiAdjustment(await this.adjustments.findById(adjustment.id)),
            day: await this.inconsistency.day(adjustment.cpf, adjustment.workDate),
        };
    }

    async list(query = {}) {
        const pagination = normalizePagination(query);
        const type = query.type || null;
        if (type && !values(AdjustmentType).includes(type)) {
            throw new AppError(`'type' deve ser um destes: ${values(AdjustmentType).join(', ')}.`, 400);
        }
        for (const field of ['from', 'to']) {
            if (query[field] && !isDate(query[field])) throw new AppError(`'${field}' deve estar no formato AAAA-MM-DD.`, 400);
        }

        const { rows, total } = await this.adjustments.list({
            cpf: query.cpf ? String(query.cpf).replace(/\D/g, '') : null,
            from: query.from || null,
            to: query.to || null,
            type,
            includeCanceled: optionalFlag(query.include_canceled) === 1,
            ...pagination,
        });
        return paginated(rows.map(toApiAdjustment), total, pagination);
    }

    /** @returns {Promise<{absolutePath: string, fileName: string, mimeType: string}>} */
    async attachment(id) {
        const adjustment = await this.adjustments.findById(Number(id));
        if (!adjustment) throw new AppError('Ajuste não encontrado.', 404);
        if (!adjustment.attachmentFileId) throw new AppError('Este ajuste não tem anexo.', 404);
        return this.attachments.resolve(adjustment.attachmentFileId);
    }

    /**
     * A leitura a desconsiderar existe, é marcação, é desta pessoa e deste dia.
     * Desconsiderar o NSR errado tiraria a batida de OUTRA pessoa da folha.
     */
    async _assertReading(adjustment) {
        const record = await this.afd.findRecord(adjustment.deviceId, adjustment.nsr);
        if (!record) throw new AppError('Leitura não encontrada no espelho do relógio.', 404);
        if (record.recordType !== AfdRecordType.MARCACAO) {
            throw new AppError('Só marcação de ponto (tipo 3) pode ser desconsiderada.', 400);
        }
        if (record.cpf !== adjustment.cpf || record.day !== adjustment.workDate) {
            throw new AppError('A leitura informada não é desta pessoa neste dia.', 400);
        }
    }

    _requireActor(actor) {
        const id = Number(actor?.id);
        if (!Number.isInteger(id) || id < 1) {
            throw new AppError('Sessão sem usuário identificado — ajuste exige autoria.', 401);
        }
        return id;
    }
}

module.exports = { CpppAdjustmentUseCases, ACCEPTED_ATTACHMENT };
