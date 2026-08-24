/**
 * @fileoverview Recepção de imagem de rosto — multipart em memória.
 *
 * Separado do `upload.middleware.js` da casa por causa do LIMITE, e o limite tem
 * uma história: o container de reconhecimento recusava com 413 fotos que o multer
 * compartilhado tinha aceitado. Dois limites que discordam produzem erro no lugar
 * errado — a mensagem vem do serviço de rosto quando o problema era o tamanho
 * permitido na borda.
 *
 * Aqui os dois lados usam o MESMO número, e ele é maior porque a foto vem de
 * câmera de celular em resolução cheia: 5 MB é pouco para isso, e a camera-kit não
 * expõe controle de resolução de captura.
 *
 * `memoryStorage` como no middleware da casa, e por um motivo mais forte que
 * conveniência: imagem de rosto não pode tocar disco. É a promessa do documento
 * de LGPD — "as fotos são apagadas na hora, sem serem gravadas em nenhum lugar".
 * Um `diskStorage` aqui a tornaria falsa.
 *
 * @module modules/meal/infrastructure/face-upload.middleware
 */

const multer = require('multer');

/**
 * Teto por arquivo.
 *
 * Tem que ser >= ao `FACE_MAX_IMAGE_BYTES` do container, senão a borda recusa
 * antes e o operador vê um erro que não corresponde à causa. Os dois valores
 * moram no `docker-compose.yml` e devem ser mudados juntos.
 */
const MAX_FILE_BYTES = Number(process.env.FACE_MAX_IMAGE_BYTES || 12 * 1024 * 1024);

const faceUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: MAX_FILE_BYTES,
        // O cadastro manda até 5 fotos. Um a mais que isso não é uso legítimo.
        files: 5,
    },
});

module.exports = { faceUpload, MAX_FILE_BYTES };
