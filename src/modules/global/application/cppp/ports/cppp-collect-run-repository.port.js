/**
 * @fileoverview Porta das coletas (`cppp_collect_runs`) — fila e histórico.
 *
 * Compartilhada pela coleta e pela análise (que lê a última coleta
 * bem-sucedida para saber até que dia os dados estão completos).
 *
 * @module modules/global/application/cppp/ports/cppp-collect-run-repository.port
 */

class CpppCollectRunRepositoryPort {
    /**
     * Enfileira uma coleta.
     * @param {{deviceId: number, trigger: string, requestedBy: number|null}} input
     * @returns {Promise<number|null>} id; `null` quando o relógio já tem coleta
     *          viva (o banco garante no máximo uma por relógio).
     */
    enqueue(input) { throw new Error('Not implemented'); }

    /** @param {number} id @returns {Promise<object|null>} */
    findById(id) { throw new Error('Not implemented'); }

    /** @param {number} deviceId @returns {Promise<object|null>} coleta `queued`/`running`. */
    findActive(deviceId) { throw new Error('Not implemented'); }

    /**
     * @param {{deviceId?: number|null, status?: string|null, limit: number, offset: number}} filters
     * @returns {Promise<{rows: object[], total: number}>}
     */
    list(filters) { throw new Error('Not implemented'); }

    /** @returns {Promise<object|null>} a coleta `queued` mais antiga. */
    nextQueued() { throw new Error('Not implemented'); }

    /**
     * `queued` → `running`, só se ainda estiver `queued`.
     * @param {number} id @returns {Promise<boolean>}
     */
    claim(id) { throw new Error('Not implemented'); }

    /** @param {number} id @param {string} requestedFrom */
    setRequestedFrom(id, requestedFrom) { throw new Error('Not implemented'); }

    /**
     * Encerra a coleta com o resultado.
     * @param {number} id
     * @param {object} result - `status`, contagens, `trailerCheck`, arquivo bruto, `error`, `warnings`.
     */
    finish(id, result) { throw new Error('Not implemented'); }

    /**
     * Marca como `failed` as coletas `running` há mais que `minutes`.
     * @param {number} minutes @returns {Promise<number>} quantas.
     */
    failStuck(minutes) { throw new Error('Not implemented'); }

    /** @param {number} deviceId @returns {Promise<string|null>} `YYYY-MM-DDTHH:MM:SS` local. */
    lastScheduledAt(deviceId) { throw new Error('Not implemented'); }

    /**
     * Última coleta bem-sucedida de cada relógio ATIVO.
     * @returns {Promise<Array<{deviceId: number, lastSuccessAt: string|null}>>}
     */
    lastSuccessByDevice() { throw new Error('Not implemented'); }
}

module.exports = { CpppCollectRunRepositoryPort };
