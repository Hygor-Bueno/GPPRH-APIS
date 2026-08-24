/**
 * @fileoverview Controllers do autocadastro facial e da verificação 1:1.
 * @module modules/meal/controllers/meal-enroll.controller
 */

const { MealEnrollUseCases } = require('../application/meal-enroll.use-cases');
const { SqlServerMealEnrollRepository } = require('../infrastructure/sqlserver-meal-enroll.repository');
const faceClient = require('../infrastructure/face-recognition.client');
const { respond } = require('../../../utils/respond');

const useCases = new MealEnrollUseCases({
    repository: new SqlServerMealEnrollRepository(),
    faceClient,
});

/**
 * IP de origem do consentimento.
 *
 * `req.ip` já resolve `X-Forwarded-For` porque o app roda com
 * `trust proxy = 1` — sem isso todo consentimento ficaria registrado com o IP do
 * Apache, o que é o mesmo que não registrar.
 */
function originIp(req) {
    return req.ip ?? req.socket?.remoteAddress ?? null;
}

/**
 * Imagens da requisição, sempre em base64, vindas de qualquer um dos dois
 * caminhos.
 *
 * **multipart** é o caminho do app. O `capture()` da camera-kit devolve URI de
 * arquivo, e o `FormData` do React Native monta a parte multipart a partir dela
 * sem ler o conteúdo para a memória do JS — o que importa quando são cinco fotos
 * num telefone modesto. O multer da casa usa `memoryStorage()`, então o arquivo
 * também não toca disco do lado do servidor: entra como Buffer, vira base64 aqui
 * e segue para o container. É o que sustenta "as imagens são descartadas sem
 * tocar disco" ponta a ponta.
 *
 * **base64 em JSON** é o caminho do navegador, no autocadastro por link: lá a
 * imagem já está em memória como data URL, e montar multipart seria trabalho
 * para desfazer depois.
 *
 * O prefixo `data:image/...;base64,` é removido: navegador manda com, e o
 * container recusa base64 inválido.
 */
function imagesFrom(req) {
    if (Array.isArray(req.files) && req.files.length > 0) {
        return req.files.map(file => file.buffer.toString('base64'));
    }

    if (req.file?.buffer) {
        return [req.file.buffer.toString('base64')];
    }

    const raw = req.body?.images ?? req.body?.image;
    const list = Array.isArray(raw) ? raw : (raw ? [raw] : []);

    return list.map(value => String(value).replace(/^data:image\/[a-zA-Z+]+;base64,/, ''));
}

// ─── Emissão (RH, autenticado) ────────────────────────────────────────────────

/** `POST /gipp/meal/enroll/invites` */
async function postInvite(req, res) {
    const { company_code, employee_id, branch_code, reissue } = req.body ?? {};

    const data = await useCases.issueInvite(
        {
            companyCode: company_code,
            employeeId: employee_id,
            branchCode: branch_code,
            reissue: reissue === true || reissue === 'true',
        },
        { userId: req.user?.id ?? null },
    );

    return respond.created(res, data);
}

// ─── Autocadastro (a pessoa, sem sessão) ──────────────────────────────────────

/**
 * `GET /gipp/meal/enroll/:token`
 *
 * Devolve apenas que o link vale e o que ele pede. **Nenhum dado da pessoa** —
 * nome só sai depois da conferência, senão o endpoint volta a ser um oráculo.
 */
async function getInvite(req, res) {
    const data = await useCases.openInvite(req.params.token);
    return respond.ok(res, data);
}

/** `POST /gipp/meal/enroll/:token/confirm` */
async function postConfirm(req, res) {
    const data = await useCases.confirmIdentity(req.params.token, req.body?.birth_date);
    return respond.ok(res, data);
}

/**
 * `POST /gipp/meal/enroll/complete`
 *
 * O token de conferência vai no corpo, não na URL: ele é credencial de vida
 * curta, e URL vaza para log de acesso do Apache e para histórico do navegador.
 */
async function postComplete(req, res) {
    const { confirmed_token, consent_accepted, consent_version } = req.body ?? {};

    const data = await useCases.enroll(confirmed_token, {
        images: imagesFrom(req),
        consentAccepted: consent_accepted === true || consent_accepted === 'true',
        consentVersion: consent_version,
        ip: originIp(req),
    });

    return respond.created(res, data);
}

/**
 * `POST /gipp/meal/enroll/direct`
 *
 * Cadastro presencial, no aparelho do operador. Sem link, sem navegador.
 *
 * O consentimento continua sendo da pessoa: quem toca "concordo" é ela, na tela,
 * depois de ler o termo — o operador passa o aparelho. O `consent_accepted` que
 * chega aqui representa esse toque, não a opinião do operador.
 */
async function postDirectEnroll(req, res) {
    const { company_code, employee_id, branch_code, consent_accepted, consent_version } =
        req.body ?? {};

    const data = await useCases.enrollDirect(
        { companyCode: company_code, employeeId: employee_id, branchCode: branch_code },
        {
            images: imagesFrom(req),
            consentAccepted: consent_accepted === true || consent_accepted === 'true',
            consentVersion: consent_version,
            ip: originIp(req),
        },
        { userId: req.user?.id ?? null },
    );

    return respond.created(res, data);
}

// ─── Verificação e revogação (operador e RH, autenticado) ─────────────────────

/**
 * `POST /gipp/meal/enroll/verify`
 *
 * Compara 1:1 e devolve veredito. Não registra refeição — quem registra é
 * `POST /gipp/meal/logs` com `identified_by = 3`. Separar as duas coisas permite
 * ao app conferir o rosto e só então gravar, sem gravar refeição de rosto
 * recusado.
 */
async function postVerify(req, res) {
    const { company_code, employee_id, branch_code } = req.body ?? {};
    const [image] = imagesFrom(req);

    if (!image) {
        return respond.ok(res, { match: false, error: 'Nenhuma imagem recebida.' });
    }

    const data = await useCases.verifyFace(
        { companyCode: company_code, employeeId: employee_id, branchCode: branch_code },
        image,
    );

    return respond.ok(res, data);
}

/**
 * `POST /gipp/meal/enroll/identify`
 *
 * Rosto sozinho, sem crachá — 1:N dentro da loja.
 *
 * Devolve `status`: `matched`, `no-match` ou `ambiguous`. Sempre 200, porque
 * nenhum dos três é erro de requisição — transformar "não reconheci" em 4xx faria
 * o app tratar caso normal como falha.
 */
async function postIdentify(req, res) {
    const { site_code } = req.body ?? {};
    const [image] = imagesFrom(req);

    if (!image) {
        return respond.ok(res, { status: 'no-match', error: 'Nenhuma imagem recebida.' });
    }

    const data = await useCases.identifyByFace(site_code, image);
    return respond.ok(res, data);
}

/** `GET /gipp/meal/enroll/status/:company/:branch/:employee` */
async function getStatus(req, res) {
    const { company, branch, employee } = req.params;

    const data = await useCases.getStatus({
        companyCode: company,
        branchCode: branch,
        employeeId: employee,
    });

    return respond.ok(res, data);
}

/**
 * `DELETE /gipp/meal/enroll/status/:company/:branch/:employee`
 *
 * Revoga. Marca `revoked_at`; o expurgo elimina depois. É o exercício do direito
 * de eliminação, e por isso não pede justificativa nenhuma.
 */
async function deleteEnrollment(req, res) {
    const { company, branch, employee } = req.params;

    const data = await useCases.revoke({
        companyCode: company,
        branchCode: branch,
        employeeId: employee,
    });

    return respond.ok(res, data);
}

/** `GET /gipp/meal/enroll/health` — a tela usa para esconder o modo facial. */
async function getFaceHealth(req, res) {
    return respond.ok(res, await faceClient.health());
}

module.exports = {
    postInvite,
    postDirectEnroll,
    getInvite,
    postConfirm,
    postComplete,
    postIdentify,
    postVerify,
    getStatus,
    deleteEnrollment,
    getFaceHealth,
};
