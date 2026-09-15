/**
 * @fileoverview Instâncias únicas dos serviços da suite miepp.
 *
 * Os repositórios seguem a convenção da casa — cada controller instancia os
 * seus. Estes três, não: `pairingService` é usado pelo controller de players
 * (que emite o código) e pelo de device (que o valida), e `mediaTokenService`
 * pelo de device (que assina a URL) e pela rota de entrega (que a verifica). A
 * assinatura de um lado precisa casar com a verificação do outro — uma
 * instância só torna isso impossível de divergir.
 *
 * Construir aqui é barato e não lê nada além do `config/miepp`: os serviços
 * aceitam segredo vazio no construtor e só reclamam no primeiro uso real, para
 * que um `.env` sem as chaves do miepp não derrube o boot do EPP, do GTPP ou
 * do GAPP, que sobem no mesmo processo.
 *
 * @module modules/global/infrastructure/miepp/miepp-services
 */

const { mieppConfig } = require('../../../../config/miepp');
const { MieppMediaTokenService } = require('./miepp-media-token.service');
const { MieppPairingCodeService } = require('./miepp-pairing-code.service');
const { MieppMediaStorageService } = require('./miepp-media-storage.service');

/** Assina e verifica as URLs de entrega de mídia. */
const mediaTokenService = new MieppMediaTokenService({
    secret: mieppConfig.mediaTokenSecret,
    baseUrl: mieppConfig.publicBaseUrl,
    ttlHours: mieppConfig.mediaTokenTtlHours,
});

/** Emite e valida os códigos de pareamento. */
const pairingService = new MieppPairingCodeService({
    secret: mieppConfig.pairingSecret,
    ttlMinutes: mieppConfig.pairingTtlMinutes,
});

/** Ponto de integração com o sistema `_files`. */
const mediaStorage = new MieppMediaStorageService();

module.exports = { mediaTokenService, pairingService, mediaStorage };
