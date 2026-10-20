/**
 * @fileoverview Portas dos colaboradores externos do CPPP: o relógio, o disco
 * do AFD bruto, o arquivo de anexo e o cadastro de funcionários do Protheus.
 *
 * Num arquivo só porque são quatro contratos de um ou dois métodos cada, todos
 * na mesma categoria ("o que está fora do MySQL da suite").
 *
 * @module modules/global/application/cppp/ports/cppp-external.ports
 */

/**
 * O relógio Control iD. Só LEITURA: não existe método de escrita, e não deve
 * existir — num REP-C a memória de registro é gravável uma única vez.
 */
class CpppClockClientPort {
    /**
     * Autentica, baixa o AFD e encerra a sessão.
     * @param {object} device - linha de `cppp_devices`.
     * @param {{initialNsr: number|null}} request - `null` = AFD integral.
     * @returns {Promise<Buffer>} o corpo da resposta, intocado.
     */
    fetchAfd(device, request) { throw new Error('Not implemented'); }

    /**
     * Só login + logout: confirma rede, TLS e credencial sem baixar nada.
     * @param {{base_url: string, code?: string}} device
     * @returns {Promise<{ok: true, elapsedMs: number}>}
     */
    testConnection(device) { throw new Error('Not implemented'); }
}

/** Onde o AFD bruto de cada coleta fica, byte a byte. */
class CpppRawAfdStoragePort {
    /**
     * @param {{deviceCode: string, runId: number, buffer: Buffer}} input
     * @returns {Promise<{relativePath: string, sha256: string, bytes: number}>}
     */
    save(input) { throw new Error('Not implemented'); }

    /**
     * Resolve o arquivo para download, conferindo o hash gravado na coleta.
     * @param {string} relativePath @param {string} expectedSha256
     * @returns {Promise<{absolutePath: string, fileName: string}>}
     */
    resolve(relativePath, expectedSha256) { throw new Error('Not implemented'); }
}

/** Anexo de ajuste (atestado em PDF/imagem). */
class CpppAttachmentStoragePort {
    /**
     * @param {Express.Multer.File} file @param {number} userId
     * @returns {Promise<{fileId: number, mimeType: string}>}
     */
    save(file, userId) { throw new Error('Not implemented'); }

    /** @param {number} fileId @returns {Promise<{absolutePath: string, fileName: string, mimeType: string}>} */
    resolve(fileId) { throw new Error('Not implemented'); }
}

/** Contrato do funcionário no Protheus, lido em tempo real. */
class CpppEmployeeDirectoryPort {
    /**
     * @param {string[]} identifiers - como o relógio grava (CPF ou PIS).
     * @returns {Promise<Map<string, object>>} só os encontrados.
     */
    findByIdentifiers(identifiers) { throw new Error('Not implemented'); }
}

module.exports = {
    CpppClockClientPort,
    CpppRawAfdStoragePort,
    CpppAttachmentStoragePort,
    CpppEmployeeDirectoryPort,
};
