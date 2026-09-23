/**
 * @fileoverview Autenticação dos dispositivos (players) do miepp.
 *
 * ─── Por que isto NÃO toca no auth do módulo global ──────────────────────────
 * O `CLAUDE.md` proíbe acrescentar Bearer ao `auth.middleware`/
 * `auth-session.service`, e com razão: aquele caminho é a sessão por cookie dos
 * usuários, com refresh e troca de senha. O player não é usuário — não tem
 * sessão, não renova nada, e o token dele vale até ser revogado. São dois
 * mecanismos distintos, e este arquivo é o do dispositivo. Nenhum dos dois
 * enxerga o outro: o `req.device` daqui nunca vira `req.user`, e por isso um
 * token de player não alcança nenhuma rota administrativa.
 *
 * @module middlewares/miepp-device-auth.middleware
 */

const crypto = require('crypto');

const { MysqlMieppPlayerRepository } = require('../modules/global/infrastructure/miepp/mysql-miepp-player.repository');

const repository = new MysqlMieppPlayerRepository();

/**
 * Resposta única para qualquer falha de autenticação de device.
 *
 * Sempre a mesma mensagem, sem dizer se o player existe, se foi desativado ou
 * se o token expirou: o token é o único segredo, e qualquer diferença na
 * resposta transforma a rota num oráculo para descobrir players válidos.
 *
 * @param {import('express').Response} res
 */
function unauthorized(res) {
    return res.status(401).json({
        error: true,
        message: 'Token de dispositivo inválido ou revogado.',
    });
}

/**
 * Extrai o token de `Authorization: Bearer <token>`.
 *
 * @param {import('express').Request} req
 * @returns {string|null}
 */
function extractBearer(req) {
    const header = req.headers?.authorization;
    if (typeof header !== 'string') return null;

    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    return match ? match[1].trim() : null;
}

/**
 * Valida o token do dispositivo e popula `req.device`.
 *
 * O banco guarda apenas o SHA-256 do token, então a busca é pelo hash — o valor
 * em texto puro existe só no dispositivo.
 *
 * @type {import('express').RequestHandler}
 */
async function authenticateDevice(req, res, next) {
    try {
        const token = extractBearer(req);
        if (!token) return unauthorized(res);

        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const record = await repository.findDeviceTokenByHash(tokenHash);

        // A query já filtra revogado e expirado; aqui sobra o player desativado,
        // que o soft-delete deixa com token vivo até a revogação em cascata.
        if (!record || Number(record.player_active) !== 1) return unauthorized(res);

        req.device = {
            token_id: record.id,
            id: record.player_id,
            uuid: record.player_uuid,
            name: record.player_name,
            // Vem daqui, e não de uma consulta do caso de uso, porque o registro
            // de exibições (`POST /device/plays`) grava o local como SNAPSHOT em
            // cada evento — buscar o player de novo a cada lote seria uma ida ao
            // banco por requisição de cada tela, no mesmo servidor de dados que
            // já está apertado. `null` quando a tela não tem local cadastrado.
            location_id: record.player_location_id === null || record.player_location_id === undefined
                ? null
                : Number(record.player_location_id),
        };

        // Carimbo de uso sem bloquear a resposta: é telemetria de suporte
        // ("quando essa tela falou com a gente pela última vez?"), e uma falha
        // ao gravá-lo não pode derrubar o heartbeat de todas as telas.
        repository.touchDeviceToken(record.id).catch((error) => {
            console.error('[miepp] falha ao atualizar last_used_at do token:', error.message);
        });

        return next();
    } catch (error) {
        return next(error);
    }
}

module.exports = { authenticateDevice, extractBearer };
