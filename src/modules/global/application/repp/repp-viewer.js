/**
 * @fileoverview Resolve quem está consultando — anônimo, logado, administrador
 * de espaço ou dono do sistema — para os casos de uso de espaço e de reserva.
 *
 * @module modules/global/application/repp/repp-viewer
 */

const { buildViewer } = require('../../domain/repp/booking-access.rules');

/**
 * @param {import('./ports/repp-space-repository.port').ReppSpaceRepositoryPort} spaceRepository
 * @param {object|null} user - `req.user`; `null`/`undefined` = anônimo.
 */
async function resolveViewer(spaceRepository, user) {
    if (!user?.id) return buildViewer(null);
    const managed = await spaceRepository.findManagedSpaceIds(Number(user.id));
    return buildViewer(user, managed);
}

module.exports = { resolveViewer };
