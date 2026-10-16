/**
 * @fileoverview Porta do cadastro de relógios (`cppp_devices`).
 *
 * Relógio é cadastrado pela tela (nome, IP, ativo). Não existe exclusão: o
 * espelho do AFD referencia o relógio para sempre — desativar é o caminho.
 * A senha nunca passa por aqui (é única, no `.env`).
 *
 * @module modules/global/application/cppp/ports/cppp-device-repository.port
 */

class CpppDeviceRepositoryPort {
    /** @returns {Promise<object[]>} relógios ativos, com `base_url`. */
    listActive() { throw new Error('Not implemented'); }

    /** @param {number} id @returns {Promise<object|null>} */
    findById(id) { throw new Error('Not implemented'); }

    /** @param {string} repNumber @returns {Promise<object|null>} */
    findByRepNumber(repNumber) { throw new Error('Not implemented'); }

    /** @returns {Promise<object[]>} todos, cada um com a última coleta e a última bem-sucedida. */
    listWithLastRun() { throw new Error('Not implemented'); }

    /**
     * @param {{code: string, name: string, baseUrl: string, repNumber?: string|null, active?: boolean}} device
     * @param {number} userId
     * @returns {Promise<number>} id.
     * @throws {AppError} 409 quando código, IP ou REP já estão em outro cadastro.
     */
    insert(device, userId) { throw new Error('Not implemented'); }

    /**
     * Atualização parcial (só os campos presentes).
     * @param {number} id @param {object} fields @param {number} userId
     * @throws {AppError} 409 quando IP ou REP já estão em outro cadastro.
     */
    update(id, fields, userId) { throw new Error('Not implemented'); }

    /** @param {number} id @returns {Promise<boolean>} o relógio já tem linhas no espelho? */
    hasRecords(id) { throw new Error('Not implemented'); }

    /**
     * Grava o REP aprendido na primeira coleta — só se ainda estiver vazio.
     * @param {number} id @param {string} repNumber
     */
    setRepNumberIfEmpty(id, repNumber) { throw new Error('Not implemented'); }
}

module.exports = { CpppDeviceRepositoryPort };
