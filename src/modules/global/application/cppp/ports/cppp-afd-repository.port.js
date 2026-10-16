/**
 * @fileoverview Porta do espelho do relógio (`cppp_afd_records`).
 *
 * Compartilhada pela coleta (que grava) e pela análise (que lê), por isso mora
 * em `ports/` com o prefixo da suite.
 *
 * ⚠️ O único método de escrita é `insertRecords`. Não acrescente update nem
 * delete aqui — o banco recusa por trigger, e a porta não deve sugerir que
 * existe esse caminho. Correção de marcação é `CpppAdjustmentRepositoryPort`.
 *
 * @module modules/global/application/cppp/ports/cppp-afd-repository.port
 */

class CpppAfdRepositoryPort {
    /**
     * Fim do primeiro bloco contínuo de NSR do relógio (ver
     * `resolveCollectRequest`).
     * @param {number} deviceId
     * @returns {Promise<number|null>} `null` quando não há nada gravado.
     */
    lastContiguousNsr(deviceId) { throw new Error('Not implemented'); }

    /**
     * @param {number} deviceId @param {number} minNsr @param {number} maxNsr
     * @returns {Promise<Map<number, string>>} NSR → `raw_line` já gravada.
     */
    findRawLines(deviceId, minNsr, maxNsr) { throw new Error('Not implemented'); }

    /**
     * Grava registros NOVOS (o caso de uso já tirou os existentes).
     * @param {number} deviceId @param {number} runId
     * @param {import('../../../domain/cppp/afd/afd.parser').AfdRecord[]} records
     * @returns {Promise<number>} linhas gravadas.
     */
    insertRecords(deviceId, runId, records) { throw new Error('Not implemented'); }

    /**
     * Marcações (tipo 3) para a análise, todos os relógios.
     * @param {{from: string, to: string, cpf?: string|null}} filters
     * @returns {Promise<Array<{deviceId: number, nsr: number, cpf: string, day: string, time: string}>>}
     */
    findPunches(filters) { throw new Error('Not implemented'); }

    /**
     * Marcações de uma pessoa num dia, com o relógio de cada uma.
     * @param {string} cpf @param {string} day
     * @returns {Promise<object[]>}
     */
    findDayPunches(cpf, day) { throw new Error('Not implemented'); }

    /**
     * @param {number} deviceId @param {number} nsr
     * @returns {Promise<{deviceId: number, nsr: number, recordType: number, cpf: string|null, day: string}|null>}
     */
    findRecord(deviceId, nsr) { throw new Error('Not implemented'); }

    /**
     * Visão AFD (fiscal), paginada por NSR.
     * @param {{from: string, to: string, cpf?: string|null, deviceId?: number|null, limit: number, offset: number}} filters
     * @returns {Promise<{rows: object[], total: number}>}
     */
    listPunches(filters) { throw new Error('Not implemented'); }

    /**
     * Pessoas conhecidas do relógio: quem tem marcação ou cadastro (tipo 5).
     * @param {{search?: string|null, limit: number, offset: number}} filters
     * @returns {Promise<{rows: object[], total: number}>}
     */
    listEmployees(filters) { throw new Error('Not implemented'); }

    /**
     * Nome mais recente no cadastro do próprio relógio (tipo 5) — usado quando
     * o Protheus não encontra o identificador (PIS, por exemplo).
     * @param {string[]} cpfs
     * @returns {Promise<Map<string, {name: string|null, operation: string|null}>>}
     */
    clockNames(cpfs) { throw new Error('Not implemented'); }
}

module.exports = { CpppAfdRepositoryPort };
