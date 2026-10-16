/**
 * @fileoverview Porta de leitura de empresa, filial e centro de custo no
 * Protheus, para validar o que a reserva informa.
 *
 * Lê da fonte em tempo real — nada de tabela de apoio. A reserva guarda o
 * código e a descrição DO MOMENTO (registro de um fato), resolvidos aqui e
 * nunca aceitos do corpo da requisição.
 *
 * @module modules/global/application/repp/booking/ports/organization-directory.port
 */

class OrganizationDirectoryPort {
    /**
     * @param {{company_code: string, branch_code: string, cost_center_code: string}} codes
     * @returns {Promise<{
     *   company: ?{company_code: string, company_name: string},
     *   branch: ?{branch_code: string, branch_name: string},
     *   costCenter: ?{cost_center_code: string, cost_center_description: string},
     * }>} `null` em cada parte não encontrada. A filial só é encontrada se
     *   pertencer à empresa; o centro de custo, idem.
     */
    resolve(codes) { throw new Error('Not implemented'); }
}

module.exports = { OrganizationDirectoryPort };
