/**
 * @fileoverview Porta de `re_bookings`.
 *
 * As leituras de agenda vêm em DUAS consultas — detalhada e mascarada — e não
 * numa só com os campos apagados depois: a mascarada não lê as colunas
 * sensíveis do banco. O recorte entre as duas é o `scope` de
 * `booking-access.rules.detailScope`.
 *
 * @module modules/global/application/repp/booking/ports/booking-repository.port
 */

/**
 * @typedef {object} DetailScope
 * @property {boolean} all        dono do sistema: tudo detalhado.
 * @property {number[]} spaceIds  espaços que administra.
 * @property {?number} userId     reservas que criou também saem detalhadas.
 */

/**
 * @typedef {object} LockedTransaction
 * @property {Map<number, {id: number, active: boolean, setup_minutes: number}>} spaces
 *   os espaços travados (ausente = não existe), com a folga de organização
 *   lida sob a trava.
 * @property {(probe: {space_id: number, booking_date: string, start_time: string, end_time: string, exclude_id: number}) => Promise<{id: number, start_time: string, end_time: string}[]>} findConflicts
 *   reservas pendentes/aprovadas que cruzam o intervalo, por início (vazio =
 *   livre). O intervalo já chega alargado pela folga.
 * @property {(payload: object) => Promise<number>} insert  id criado.
 * @property {(id: number, payload: object) => Promise<number>} update
 *   linhas afetadas — 0 quando o status mudou desde a leitura.
 * @property {(id: number, payload: object) => Promise<number>} review
 *   pendente → aprovada/recusada; 0 quando já não está pendente.
 * @property {(id: number, payload: {canceled_by: number, cancel_reason: ?string}) => Promise<number>} cancel
 *   soft delete se ainda estiver pendente/aprovada; 0 caso contrário.
 * @property {(notice: {user_id: number, booking_id: number, action: string, by_user_id: number, payload: object}) => Promise<number>} insertNotification
 *   grava o aviso NA MESMA transação da ação — não existe ação concluída
 *   sem o aviso. Devolve o id (vai no `repp:event`).
 */

class BookingRepositoryPort {
    /**
     * Reservas pendentes/aprovadas do intervalo, com TODOS os campos, só do
     * escopo de detalhes. `[]` quando o escopo é vazio.
     * @param {{start: string, end: string, spaceId: ?number, scope: DetailScope}} filter
     * @returns {Promise<object[]>}
     */
    listDetailed(filter) { throw new Error('Not implemented'); }

    /**
     * Reservas pendentes/aprovadas do intervalo FORA do escopo de detalhes,
     * lendo só id, espaço, data, horário e status.
     * @param {{start: string, end: string, spaceId: ?number, scope: DetailScope}} filter
     * @returns {Promise<object[]>}
     */
    listMasked(filter) { throw new Error('Not implemented'); }

    /**
     * Pendentes de hoje em diante no escopo (`all` = todos os espaços), completas.
     * @param {{all: boolean, spaceIds: number[]}} scope
     * @returns {Promise<object[]>}
     */
    listPending(scope) { throw new Error('Not implemented'); }

    /**
     * O mínimo para decidir acesso: campos públicos + `created_by` (que NÃO
     * sai na resposta mascarada). Qualquer status.
     * @param {number} id @returns {Promise<object|null>}
     */
    findAccessRow(id) { throw new Error('Not implemented'); }

    /** Todos os campos, qualquer status. @param {number} id @returns {Promise<object|null>} */
    findDetailed(id) { throw new Error('Not implemented'); }

    /**
     * "Minhas reservas": as criadas por `userId`, em qualquer status, da mais
     * recente para a mais antiga, completas.
     * @param {{userId: number, statuses: ?string[], start: ?string, end: ?string,
     *          spaceId: ?number, limit: number, offset: number}} filter
     * @returns {Promise<{rows: object[], total: number}>}
     */
    listMine(filter) { throw new Error('Not implemented'); }

    /**
     * Abre transação, trava os espaços (`SELECT ... FOR UPDATE`, em ordem de
     * id — dois espaços na mesma edição não dão deadlock) e roda `work`.
     * Tudo que `work` gravar fica na mesma transação; exceção desfaz.
     *
     * @template T
     * @param {number[]} spaceIds
     * @param {(tx: LockedTransaction) => Promise<T>} work
     * @returns {Promise<T>}
     */
    runLocked(spaceIds, work) { throw new Error('Not implemented'); }
}

module.exports = { BookingRepositoryPort };
