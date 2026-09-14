/**
 * @fileoverview Instâncias únicas dos serviços da suite meipp.
 *
 * Os repositórios seguem a convenção da casa — cada controller instancia os
 * seus. Estes três, não: `pairingService` é usado pelo controller de players
 * (que emite o código) e pelo de device (que o valida), e `mediaTokenService`
 * pelo de device (que assina a URL) e pela rota de entrega (que a verifica). A
 * assinatura de um lado precisa casar com a verificação do outro — uma
 * instância só torna isso impossível de divergir.
 *
 * Construir aqui é barato e não lê nada além do `config/meipp`: os serviços
 * aceitam segredo vazio no construtor e só reclamam no primeiro uso real, para
 * que um `.env` sem as chaves do meipp não derrube o boot do EPP, do GTPP ou
 * do GAPP, que sobem no mesmo processo.
 *
 * @module modules/global/infrastructure/meipp/meipp-services
 */

const { meippConfig } = require('../../../../config/meipp');
const { MeippMediaTokenService } = require('./meipp-media-token.service');
const { MeippPairingCodeService } = require('./meipp-pairing-code.service');
const { MeippMediaStorageService } = require('./meipp-media-storage.service');

/** Assina e verifica as URLs de entrega de mídia. */
const mediaTokenService = new MeippMediaTokenService({
    secret: meippConfig.mediaTokenSecret,
    baseUrl: meippConfig.publicBaseUrl,
    ttlHours: meippConfig.mediaTokenTtlHours,
});

/** Emite e valida os códigos de pareamento. */
const pairingService = new MeippPairingCodeService({
    secret: meippConfig.pairingSecret,
    ttlMinutes: meippConfig.pairingTtlMinutes,
});

/** Ponto de integração com o sistema `_files`. */
const mediaStorage = new MeippMediaStorageService();

module.exports = { mediaTokenService, pairingService, mediaStorage };
