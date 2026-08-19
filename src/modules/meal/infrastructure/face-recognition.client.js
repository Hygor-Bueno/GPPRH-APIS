/**
 * @fileoverview Cliente do serviço de reconhecimento facial (container `face`).
 *
 * O serviço não publica porta no host: só é alcançável pela rede do compose, em
 * `http://face:8000`. Isso é o que sustenta a promessa de que o vetor não sai da
 * máquina — não há endereço externo para onde ele pudesse ir.
 *
 * Este cliente é fino de propósito. Ele não decide nada sobre identidade: o
 * `/verify` do serviço devolve um score, e quem compara com o limiar é o caso de
 * uso, com o número calibrado no piloto. Um cliente que já devolvesse
 * `match: true` esconderia essa decisão numa camada onde ninguém a procura.
 *
 * @module modules/meal/infrastructure/face-recognition.client
 */

const { AppError } = require('../../../errors/app.error');

const BASE_URL = process.env.FACE_SERVICE_URL || 'http://face:8000';

/**
 * Timeout por requisição.
 *
 * Reconhecimento em CPU leva algo entre 200 ms e 1,5 s por imagem. 8 s dá folga
 * para fila no container sem deixar o operador olhando a tela travada — com 300
 * pessoas na fila, esperar 30 s por um rosto é pior que cair para o QR.
 */
const TIMEOUT_MS = Number(process.env.FACE_TIMEOUT_MS || 8000);

/**
 * Chama o serviço e traduz a falha.
 *
 * A distinção que importa: **serviço fora do ar não é rosto que não bate.** O
 * primeiro é 503 e o operador cai para o QR; o segundo é resposta legítima com
 * score baixo. Confundir os dois faria o sistema recusar identidade por causa de
 * um container reiniciando.
 *
 * @private
 */
async function call(path, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let response;
    try {
        response = await fetch(`${BASE_URL}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
    } catch (error) {
        const aborted = error?.name === 'AbortError';
        throw new AppError(
            aborted
                ? 'O reconhecimento facial demorou demais. Use o QR Code.'
                : 'O reconhecimento facial está indisponível. Use o QR Code.',
            503,
            { code: aborted ? 'FACE_TIMEOUT' : 'FACE_UNAVAILABLE', details: error },
        );
    } finally {
        clearTimeout(timer);
    }

    let payload = null;
    try {
        payload = await response.json();
    } catch {
        /* resposta sem JSON — tratada abaixo pelo status */
    }

    if (response.ok) return payload;

    /**
     * 422 é o serviço dizendo que a IMAGEM não serve: nenhum rosto, ou mais de
     * um. Isso é erro do usuário e a mensagem dele é acionável ("aproxime o
     * rosto", "enquadre apenas uma pessoa"), então passa adiante como 422 em vez
     * de virar 500 genérico.
     */
    if (response.status === 422 || response.status === 400 || response.status === 413) {
        throw new AppError(
            payload?.detail || 'A imagem não serve para reconhecimento.',
            response.status === 422 ? 422 : 400,
            { code: 'FACE_IMAGE_REJECTED' },
        );
    }

    /**
     * 409 é divergência de `model_tag`: o vetor guardado é de um modelo e o
     * serviço roda outro. Não é falha transitória e reenviar não resolve — é
     * configuração errada, e o operador precisa cair para o QR enquanto alguém
     * arruma.
     */
    if (response.status === 409) {
        throw new AppError(
            payload?.detail
                || 'O rosto cadastrado é de uma versão anterior do reconhecimento. Use o QR Code.',
            409,
            { code: 'FACE_MODEL_MISMATCH' },
        );
    }

    throw new AppError(
        'O reconhecimento facial falhou. Use o QR Code.',
        503,
        { code: 'FACE_ERROR', details: payload },
    );
}

/**
 * Gera o vetor de cadastro a partir de uma imagem.
 *
 * @param {string} imageBase64
 * @returns {Promise<{embedding: string, model_tag: string, det_score: number, bbox: number[]}>}
 */
async function embed(imageBase64) {
    return call('/embed', { image: imageBase64 });
}

/**
 * Compara 1:1 e devolve o score.
 *
 * **Não devolve veredito.** O limiar é decisão do caso de uso, com o número
 * medido no piloto — nesta camada não existe um corte para consultar.
 *
 * @param {{imageBase64: string, referenceBase64: string, modelTag: string}} params
 * @returns {Promise<{score: number, model_tag: string, det_score: number}>}
 */
async function verify({ imageBase64, referenceBase64, modelTag }) {
    return call('/verify', {
        image: imageBase64,
        reference: referenceBase64,
        model_tag: modelTag,
    });
}

/** Sonda de disponibilidade — usada pela tela para esconder o modo facial. */
async function health() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);

    try {
        const response = await fetch(`${BASE_URL}/health`, { signal: controller.signal });
        if (!response.ok) return { available: false };

        const payload = await response.json();
        return {
            available: true,
            model_tag: payload.model_tag,
            model_loaded: payload.model_loaded,
        };
    } catch {
        return { available: false };
    } finally {
        clearTimeout(timer);
    }
}

module.exports = { embed, verify, health, BASE_URL };
