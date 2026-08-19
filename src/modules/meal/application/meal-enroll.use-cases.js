/**
 * @fileoverview Casos de uso do autocadastro facial e da verificação 1:1.
 *
 * O fluxo do plano, em quatro passos, e o motivo de cada um:
 *
 *   1. **Link assinado individual.** Com link genérico o endpoint viraria um
 *      oráculo: qualquer um manda combinações de matrícula e data de nascimento e
 *      recebe um nome de volta — vazamento de dado pessoal construído de
 *      propósito. Com token por pessoa, sem token válido não há resposta nenhuma.
 *
 *   2. **Um dado de confirmação — data de nascimento.** Nenhum número de
 *      documento. Pedir CPF e RG para autorizar almoço esbarra no princípio da
 *      necessidade (art. 6º, III), e de todo modo não são segredo: o adversário
 *      real é um colega, que já sabe seu aniversário. O que protege é o token,
 *      não a pergunta.
 *
 *   3. **O nome só sai DEPOIS de a data bater.** Devolver antes reintroduziria o
 *      oráculo por dentro.
 *
 *   4. **Consentimento no próprio fluxo**, carimbado e versionado.
 *
 * O que este módulo NUNCA faz: guardar imagem, devolver vetor para fora, ou
 * decidir identidade sem limiar explícito.
 *
 * @module modules/meal/application/meal-enroll.use-cases
 */

const { randomUUID } = require('crypto');
const jwt = require('jsonwebtoken');
const { AppError } = require('../../../errors/app.error');
const { BadRequestError } = require('../../../errors/bad-request.error');
const { COMPANY_CODE_PATTERN, EMPLOYEE_ID_PATTERN, SITE_CODE_PATTERN } =
    require('../domain/meal-log.rules');

/** Validade do convite. 7 dias, como o plano definiu. */
const INVITE_TTL_DAYS = Number(process.env.MEAL_ENROLL_TTL_DAYS || 7);

/**
 * Validade do comprovante de conferência.
 *
 * O `confirm` devolve um segundo token, de vida curta, que o `enroll` exige. Sem
 * ele o cadastro seria alcançável direto com o link — pulando a conferência de
 * identidade, que é a única barreira entre "recebi um link" e "gravei meu rosto
 * como sendo de outra pessoa".
 *
 * 10 minutos: cabe capturar 3 a 5 ângulos com calma, e não cabe deixar a aba
 * aberta no celular emprestado até amanhã.
 */
const CONFIRMED_TTL_MINUTES = Number(process.env.MEAL_ENROLL_CONFIRMED_TTL_MIN || 10);

/** Tentativas de conferência antes de o convite morrer. */
const MAX_ATTEMPTS = 3;

/** Quantas capturas o cadastro aceita. */
const MIN_IMAGES = 3;
const MAX_IMAGES = 5;

/**
 * Limiar de similaridade para aceitar um rosto.
 *
 * ⚠️ ESTE NÚMERO É PROVISÓRIO E TEM QUE SER CALIBRADO NO PILOTO.
 *
 * O limiar não sai de paper: ele depende da câmera do aparelho, da luz do
 * refeitório e das fotos da própria empresa. O que a etapa 6 deve entregar não é
 * uma tela funcionando — é este número, medido com 15 a 20 voluntários, com taxa
 * de falso aceite e falso rejeite em vários cortes.
 *
 * 0,50 é deliberadamente CONSERVADOR para similaridade de cosseno em ArcFace.
 * Erra para o lado de recusar rosto legítimo, e recusar cai no QR — que é
 * incômodo. O erro na outra direção é o sistema afirmar identidade errada sobre
 * uma pessoa, e esse não tem desfazer.
 */
const MATCH_THRESHOLD = Number(process.env.MEAL_FACE_THRESHOLD || 0.5);

/** Como a identidade foi provada. Espelha CK_meal_biometric_verified_by. */
const VERIFIED_BY = Object.freeze({
    SIGNED_LINK: 1,
    IN_PERSON: 2,
    FIRST_MEAL_QR: 3,
});

function secret() {
    const value = process.env.MEAL_ENROLL_SECRET
        || process.env.JWT_ACCESS_SECRET;

    if (!value) {
        throw new AppError(
            'Assinatura do link de autocadastro não configurada.',
            500,
            { code: 'MEAL_ENROLL_SECRET_MISSING' },
        );
    }
    return value;
}

/** Data plausível de nascimento: ano entre 1900 e hoje, mês e dia reais. */
function isRealBirthDate(year, month, day) {
    const y = Number(year);
    const m = Number(month);
    const d = Number(day);
    const thisYear = new Date().getFullYear();

    if (y < 1900 || y > thisYear) return false;
    if (m < 1 || m > 12) return false;
    if (d < 1 || d > 31) return false;

    // Rejeita 31 de fevereiro e companhia.
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y
        && date.getUTCMonth() === m - 1
        && date.getUTCDate() === d;
}

/**
 * Normaliza para `YYYYMMDD`, o formato que o Protheus usa em `RA_NASC`.
 *
 * Aceita as duas ordens porque o campo da tela é livre e a pessoa digita como
 * está acostumada: `12/03/1985` e `1985-03-12` chegam aqui como oito dígitos e
 * significam a mesma data.
 *
 * A desambiguação é por **validade da data inteira**, não por comparar os quatro
 * primeiros dígitos com 1900. Essa heurística mais simples parece funcionar e
 * quebra em silêncio: `31121985` tem `3112` nos quatro primeiros, que é maior que
 * 1900, e seria lido como ano 3112 — errando todo aniversário de dia 20 em
 * diante. Quem nasceu em 31/12 receberia "data não confere" três vezes e perderia
 * o convite.
 */
function normalizeBirthDate(value) {
    const digits = String(value ?? '').replace(/\D/g, '');

    if (digits.length !== 8) return null;

    const asIso = {
        y: digits.slice(0, 4), m: digits.slice(4, 6), d: digits.slice(6, 8),
    };
    const asBr = {
        d: digits.slice(0, 2), m: digits.slice(2, 4), y: digits.slice(4, 8),
    };

    const isoOk = isRealBirthDate(asIso.y, asIso.m, asIso.d);
    const brOk = isRealBirthDate(asBr.y, asBr.m, asBr.d);

    /* Ambíguo de verdade não existe: um dos dois lados sempre tem o ano no lugar
       errado, e ano fora de 1900..hoje reprova. Se os dois passassem, ISO ganha —
       é o formato que o Protheus guarda. */
    if (isoOk) return `${asIso.y}${asIso.m}${asIso.d}`;
    if (brOk) return `${asBr.y}${asBr.m}${asBr.d}`;

    return null;
}

class MealEnrollUseCases {
    /**
     * @param {{
     *   repository: object,
     *   faceClient: typeof import('../infrastructure/face-recognition.client'),
     * }} deps
     */
    constructor({ repository, faceClient }) {
        this.repository = repository;
        this.face = faceClient;
    }

    // ─── Emissão (RH, app interno) ──────────────────────────────────────────

    /**
     * Emite o convite e devolve o link.
     *
     * @param {{companyCode: string, employeeId: string, branchCode: string, reissue?: boolean}} target
     * @param {{userId: number}} actor
     */
    async issueInvite(target, actor) {
        const key = this._validateKey(target);

        const diner = await this.repository.findDiner(key, null);
        if (!diner) {
            throw new AppError(
                'Matrícula não encontrada no Protheus.',
                404,
                { code: 'DINER_NOT_FOUND' },
            );
        }

        if (diner.is_terminated) {
            throw new AppError(
                `${diner.employee_name} está desligado. Convite não emitido.`,
                409,
                { code: 'DINER_TERMINATED' },
            );
        }

        /* Reemitir queima o anterior primeiro. Sem isso o índice único filtrado
           recusa, e a mensagem do banco não diz o que fazer. */
        if (target.reissue) {
            await this.repository.burnOpenTokenFor(key, 'reissued');
        }

        const jti = randomUUID();
        const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86400_000);

        try {
            await this.repository.insertToken({
                jti,
                ...key,
                expiresAt,
                issuedBy: actor.userId,
            });
        } catch (error) {
            if (error?.code === 'DUPLICATE_OPEN_TOKEN') {
                throw new AppError(
                    `${diner.employee_name} já tem um convite em aberto. `
                    + 'Reenvie o mesmo link, ou emita de novo com reissue = true.',
                    409,
                    { code: 'INVITE_ALREADY_OPEN' },
                );
            }
            throw error;
        }

        const token = jwt.sign(
            { ...key, purpose: 'meal-enroll', jti },
            secret(),
            { expiresIn: `${INVITE_TTL_DAYS}d` },
        );

        return {
            jti,
            token,
            expires_at: expiresAt.toISOString(),
            employee_name: diner.employee_name,
            /* O link completo é montado por quem envia: a URL base depende de
               onde o autocadastro está publicado, e isso é configuração de
               ambiente, não regra de negócio. */
            path: `/meal/enroll/${token}`,
        };
    }

    // ─── Autocadastro (a pessoa, celular dela) ──────────────────────────────

    /**
     * Abre o convite.
     *
     * **Não devolve o nome.** Devolve apenas que o link é válido e o que ele
     * pede. Qualquer dado da pessoa aqui reintroduziria o oráculo que o token
     * individual existe para fechar.
     */
    async openInvite(rawToken) {
        const { record } = await this._loadOpenToken(rawToken);

        return {
            valid: true,
            requires: 'birth_date',
            attempts_left: MAX_ATTEMPTS - record.attempts,
            expires_at: record.expires_at,
            consent_version: process.env.MEAL_CONSENT_VERSION || 'refeitorio-facial-v1',
        };
    }

    /**
     * Confere a identidade e, só então, devolve o nome.
     *
     * A tentativa é gasta ANTES da comparação, e de propósito: se fosse gasta
     * depois, uma requisição interrompida no meio não contaria, e três
     * tentativas viraria "três tentativas que eu deixei terminar".
     */
    async confirmIdentity(rawToken, birthDate) {
        const { record, payload } = await this._loadOpenToken(rawToken);

        const informed = normalizeBirthDate(birthDate);
        if (!informed) {
            throw new BadRequestError('Informe a data de nascimento completa (dia, mês e ano).');
        }

        const attemptsUsed = await this.repository.spendAttempt(record.jti);
        if (attemptsUsed === null) {
            throw new AppError('Este link não aceita mais tentativas.', 410, {
                code: 'INVITE_BURNED',
            });
        }

        const stored = String(record.birth_date_raw ?? '').trim();

        if (!stored) {
            /* RA_NASC vazio: a pessoa não tem como acertar, então o link não
               serve. Queimar e mandar para o RH é melhor que deixá-la tentando. */
            await this.repository.burnToken(record.jti, 'birth_date_missing');
            throw new AppError(
                'Sua data de nascimento não está no cadastro. Procure o RH para cadastrar o rosto presencialmente.',
                409,
                { code: 'BIRTH_DATE_MISSING' },
            );
        }

        if (stored !== informed) {
            const left = MAX_ATTEMPTS - attemptsUsed;

            if (left <= 0) {
                await this.repository.burnToken(record.jti, 'attempts_exhausted');
                throw new AppError(
                    'Tentativas esgotadas. Procure o RH para receber um link novo.',
                    410,
                    { code: 'INVITE_BURNED' },
                );
            }

            throw new AppError(
                `Data de nascimento não confere. Você tem ${left} `
                + `${left === 1 ? 'tentativa' : 'tentativas'}.`,
                401,
                { code: 'BIRTH_DATE_MISMATCH', details: { attempts_left: left } },
            );
        }

        /* Comprovante de conferência, curto. O `enroll` exige — sem ele o
           cadastro seria alcançável direto com o link, pulando esta barreira. */
        const confirmedToken = jwt.sign(
            {
                company_code: payload.company_code,
                employee_id: payload.employee_id,
                branch_code: payload.branch_code,
                purpose: 'meal-enroll-confirmed',
                jti: record.jti,
            },
            secret(),
            { expiresIn: `${CONFIRMED_TTL_MINUTES}m` },
        );

        return {
            confirmed: true,
            confirmed_token: confirmedToken,
            employee_name: record.employee_full_name || record.employee_name,
            consent_version: process.env.MEAL_CONSENT_VERSION || 'refeitorio-facial-v1',
            expires_in_minutes: CONFIRMED_TTL_MINUTES,
        };
    }

    /**
     * Grava o cadastro.
     *
     * As imagens chegam, viram vetor no container `face` e morrem aqui — nenhuma
     * delas é escrita em disco, em log ou em resposta. A média dos vetores é o
     * que fica.
     *
     * @param {string} confirmedToken
     * @param {{images: string[], consentAccepted: boolean, consentVersion?: string, ip?: string}} input
     */
    async enroll(confirmedToken, input) {
        const payload = this._verifyToken(confirmedToken, 'meal-enroll-confirmed');
        const key = {
            companyCode: payload.company_code,
            employeeId: payload.employee_id,
            branchCode: payload.branch_code,
        };

        if (!input.consentAccepted) {
            throw new BadRequestError(
                'O cadastro do rosto exige o aceite do termo de consentimento.',
            );
        }

        const images = Array.isArray(input.images) ? input.images : [];
        if (images.length < MIN_IMAGES || images.length > MAX_IMAGES) {
            throw new BadRequestError(
                `Envie de ${MIN_IMAGES} a ${MAX_IMAGES} capturas do rosto.`,
            );
        }

        /* O token de conferência aponta para um convite específico. Se ele já foi
           consumido ou queimado no intervalo, o cadastro não vale. */
        const record = await this.repository.findToken(payload.jti);
        if (!record || record.consumed_at || record.burned_at) {
            throw new AppError('Este link já foi usado.', 410, { code: 'INVITE_USED' });
        }

        const vectors = [];
        let modelTag = null;

        for (const image of images) {
            const result = await this.face.embed(image);
            vectors.push(Buffer.from(result.embedding, 'base64'));
            modelTag = result.model_tag;
        }

        const embedding = this._averageVectors(vectors);

        await this.repository.completeEnrollment({
            ...key,
            jti: payload.jti,
            embedding,
            modelTag,
            enrollVerifiedBy: VERIFIED_BY.SIGNED_LINK,
            consentAt: new Date(),
            consentVersion:
                input.consentVersion
                || process.env.MEAL_CONSENT_VERSION
                || 'refeitorio-facial-v1',
            consentIp: input.ip ?? null,
        });

        return {
            enrolled: true,
            model_tag: modelTag,
            captures_used: vectors.length,
            /* O plano: a PRIMEIRA refeição por rosto ainda exige o QR. O
               operador confirma uma vez, e só depois o rosto vale sozinho. É o
               backstop contra um cadastro errado passar despercebido. */
            first_meal_requires_qr: true,
        };
    }

    // ─── Verificação 1:1 (operador, app interno) ────────────────────────────

    /**
     * Compara o rosto de quem está no balcão com o vetor guardado.
     *
     * Devolve `match` porque AQUI é o lugar de decidir: o limiar é regra de
     * negócio, não detalhe de infraestrutura. O container devolve score; esta
     * camada é a única que conhece o corte.
     */
    async verifyFace({ companyCode, employeeId, branchCode }, imageBase64) {
        const key = this._validateKey({ companyCode, employeeId, branchCode });

        const stored = await this.repository.findBiometricForVerify(key);
        if (!stored) {
            throw new AppError(
                'Esta pessoa não tem rosto cadastrado, ou revogou o cadastro. Use o QR Code.',
                404,
                { code: 'BIOMETRIC_NOT_FOUND' },
            );
        }

        const result = await this.face.verify({
            imageBase64,
            referenceBase64: Buffer.from(stored.embedding).toString('base64'),
            modelTag: stored.model_tag,
        });

        return {
            match: result.score >= MATCH_THRESHOLD,
            score: result.score,
            threshold: MATCH_THRESHOLD,
            /* Devolvido junto para o piloto poder registrar score real por
               tentativa e recalibrar o corte com dado, em vez de nova medição. */
            threshold_is_provisional: !process.env.MEAL_FACE_THRESHOLD,
            model_tag: result.model_tag,
            det_score: result.det_score,
        };
    }

    /** Revoga o cadastro facial. Direito do titular, sem justificar. */
    async revoke({ companyCode, employeeId, branchCode }) {
        const key = this._validateKey({ companyCode, employeeId, branchCode });

        const affected = await this.repository.revokeBiometric(key);

        return {
            revoked: affected > 0,
            /* Marca, não apaga: o expurgo leva na execução seguinte. Deixa
               rastro auditável de que a revogação foi respeitada. */
            message: affected > 0
                ? 'Cadastro facial revogado. O vetor será eliminado no próximo expurgo.'
                : 'Não havia cadastro facial ativo para esta pessoa.',
        };
    }

    /** Situação do cadastro. Nunca devolve o vetor. */
    async getStatus({ companyCode, employeeId, branchCode }) {
        const key = this._validateKey({ companyCode, employeeId, branchCode });
        const row = await this.repository.findBiometricStatus(key);

        if (!row) return { enrolled: false };

        return {
            enrolled: !row.revoked_at,
            revoked_at: row.revoked_at,
            enrolled_at: row.enrolled_at,
            model_tag: row.model_tag,
            enroll_verified_by: row.enroll_verified_by,
            consent_at: row.consent_at,
            consent_version: row.consent_version,
        };
    }

    // ─── Internos ───────────────────────────────────────────────────────────

    /** @private */
    _validateKey({ companyCode, employeeId, branchCode }) {
        const key = {
            companyCode: String(companyCode ?? '').trim(),
            employeeId: String(employeeId ?? '').trim().padStart(6, '0'),
            branchCode: String(branchCode ?? '').trim(),
        };

        if (!COMPANY_CODE_PATTERN.test(key.companyCode)
            || !EMPLOYEE_ID_PATTERN.test(key.employeeId)
            || !SITE_CODE_PATTERN.test(key.branchCode)) {
            throw new BadRequestError(
                'Informe empresa (2 dígitos), matrícula e filial (4 dígitos).',
            );
        }

        return key;
    }

    /** @private */
    _verifyToken(rawToken, expectedPurpose) {
        let payload;
        try {
            payload = jwt.verify(String(rawToken ?? ''), secret());
        } catch (error) {
            const expired = error?.name === 'TokenExpiredError';
            throw new AppError(
                expired
                    ? 'Este link expirou. Procure o RH para receber um novo.'
                    : 'Link inválido.',
                expired ? 410 : 401,
                { code: expired ? 'INVITE_EXPIRED' : 'INVITE_INVALID' },
            );
        }

        if (payload.purpose !== expectedPurpose) {
            throw new AppError('Link inválido.', 401, { code: 'INVITE_INVALID' });
        }

        return payload;
    }

    /** @private */
    async _loadOpenToken(rawToken) {
        const payload = this._verifyToken(rawToken, 'meal-enroll');
        const record = await this.repository.findToken(payload.jti);

        if (!record) {
            throw new AppError('Link inválido.', 401, { code: 'INVITE_INVALID' });
        }
        if (record.consumed_at) {
            throw new AppError('Este link já foi usado.', 410, { code: 'INVITE_USED' });
        }
        if (record.burned_at) {
            throw new AppError(
                'Este link não é mais válido. Procure o RH.',
                410,
                { code: 'INVITE_BURNED', details: { reason: record.burned_reason } },
            );
        }
        if (record.is_expired) {
            throw new AppError('Este link expirou. Procure o RH.', 410, {
                code: 'INVITE_EXPIRED',
            });
        }

        return { record, payload };
    }

    /**
     * Média dos vetores das capturas, renormalizada.
     *
     * Três a cinco ângulos dão um vetor mais estável que um só — variação de pose
     * e luz se cancela na média. A renormalização é obrigatória: a média de
     * vetores unitários não é unitária, e gravar sem normalizar produziria scores
     * incomparáveis com os das outras pessoas, sem nenhum sintoma visível.
     *
     * @private
     */
    _averageVectors(buffers) {
        const dim = 512;
        const sum = new Float32Array(dim);

        for (const buffer of buffers) {
            if (buffer.length !== dim * 4) {
                throw new AppError(
                    'O serviço de reconhecimento devolveu vetor de tamanho inesperado.',
                    502,
                    { code: 'FACE_BAD_VECTOR' },
                );
            }
            const view = new Float32Array(
                buffer.buffer, buffer.byteOffset, dim,
            );
            for (let i = 0; i < dim; i += 1) sum[i] += view[i];
        }

        let norm = 0;
        for (let i = 0; i < dim; i += 1) norm += sum[i] * sum[i];
        norm = Math.sqrt(norm);

        if (!Number.isFinite(norm) || norm === 0) {
            throw new AppError('Não foi possível consolidar as capturas.', 502, {
                code: 'FACE_BAD_VECTOR',
            });
        }

        for (let i = 0; i < dim; i += 1) sum[i] /= norm;

        return Buffer.from(sum.buffer, sum.byteOffset, dim * 4);
    }
}

module.exports = {
    MealEnrollUseCases,
    MATCH_THRESHOLD,
    VERIFIED_BY,
    INVITE_TTL_DAYS,
    MAX_ATTEMPTS,
    normalizeBirthDate,
};
