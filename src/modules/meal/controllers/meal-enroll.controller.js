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
    const { confirmed_token, images, consent_accepted, consent_version } = req.body ?? {};

    const data = await useCases.enroll(confirmed_token, {
        images,
        consentAccepted: consent_accepted === true || consent_accepted === 'true',
        consentVersion: consent_version,
        ip: originIp(req),
    });

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
    const { company_code, employee_id, branch_code, image } = req.body ?? {};

    const data = await useCases.verifyFace(
        { companyCode: company_code, employeeId: employee_id, branchCode: branch_code },
        image,
    );

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
    getInvite,
    postConfirm,
    postComplete,
    postVerify,
    getStatus,
    deleteEnrollment,
    getFaceHealth,
};
