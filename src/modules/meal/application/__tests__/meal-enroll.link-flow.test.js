const jwt = require('jsonwebtoken');
const { MealEnrollUseCases } = require('../meal-enroll.use-cases');

/**
 * A travessia completa do link: emitir -> abrir -> conferir -> cadastrar.
 *
 * Estes testes existem por causa de um bug de 19/08/2026 que nenhum teste
 * anterior pegava, porque cada passo era testável sozinho e todos passavam. O
 * token era assinado com `{ ...key }`, e `key` está em camelCase — mas
 * `confirmIdentity` e `enroll` leem snake_case. Resultado: o link abria, a pessoa
 * ACERTAVA a data de nascimento (gastando uma tentativa real e irrecuperável), e
 * só então o cadastro falhava pedindo "empresa e filial" que ela nunca digitou.
 *
 * A lição: passo isolado que passa não prova que a corrente funciona. Onde há
 * dado atravessando fronteira serializada — JWT, fila, fila offline — o teste tem
 * que percorrer a travessia inteira.
 */

const SECRET = 'segredo-de-teste';
const KEY = { company_code: '02', employee_id: '001981', branch_code: '0209' };

const DINER = {
    ...KEY,
    employee_name: 'HYGOR AZEVEDO BUENO',
    employee_full_name: 'HYGOR AZEVEDO BUENO',
    cost_center: '19907',
    cost_center_description: 'TI',
    is_terminated: 0,
    terminated_at: null,
    meals_today: 0,
};

function build({ birthDate = '19900312', tokenRow } = {}) {
    const state = { attempts: 0, consumed: false, burned: null, saved: null };

    const repository = {
        findDiner: jest.fn().mockResolvedValue(DINER),
        insertToken: jest.fn().mockResolvedValue({}),
        burnOpenTokenFor: jest.fn().mockResolvedValue(1),

        findToken: jest.fn().mockImplementation(async () => ({
            jti: 'db34d66a-4353-477c-8373-a7ada6d3be86',
            ...KEY,
            expires_at: '2026-08-26T19:53:17.000Z',
            attempts: state.attempts,
            consumed_at: state.consumed ? new Date() : null,
            burned_at: state.burned ? new Date() : null,
            burned_reason: state.burned,
            is_expired: 0,
            employee_name: DINER.employee_name,
            employee_full_name: DINER.employee_full_name,
            is_terminated: 0,
            birth_date_raw: birthDate,
            ...tokenRow,
        })),

        spendAttempt: jest.fn().mockImplementation(async () => {
            if (state.attempts >= 3) return null;
            state.attempts += 1;
            return state.attempts;
        }),

        burnToken: jest.fn().mockImplementation(async (_jti, reason) => {
            state.burned = reason;
            return 1;
        }),

        completeEnrollment: jest.fn().mockImplementation(async payload => {
            state.saved = payload;
            state.consumed = true;
            return { enrolled: true };
        }),
    };

    /**
     * Vetor unitário sintético, e não `Buffer.alloc(2048)`.
     *
     * Um buffer de zeros tem norma zero, e `_averageVectors` recusa isso — com
     * razão: gravar vetor degenerado produziria scores sem significado. A primeira
     * versão deste stub usava zeros e o teste falhou, o que serviu de prova de que
     * a guarda funciona.
     */
    const unit = new Float32Array(512);
    unit[0] = 1;

    const faceClient = {
        embed: jest.fn().mockResolvedValue({
            embedding: Buffer.from(unit.buffer).toString('base64'),
            model_tag: 'insightface-buffalo_l-w600k_r50',
            det_score: 0.9,
            bbox: [0, 0, 1, 1],
        }),
    };

    return {
        useCases: new MealEnrollUseCases({ repository, faceClient }),
        repository,
        state,
    };
}

beforeAll(() => {
    process.env.MEAL_ENROLL_SECRET = SECRET;
});

describe('travessia do link — emitir ate cadastrar', () => {
    it('o token emitido carrega a chave em snake_case', async () => {
        const { useCases } = build();

        const invite = await useCases.issueInvite(
            { companyCode: '02', employeeId: '001981', branchCode: '0209' },
            { userId: 148 },
        );

        const payload = jwt.verify(invite.token, SECRET);

        // Era exatamente aqui que o bug morava: camelCase no token, snake_case
        // em quem lê.
        expect(payload.company_code).toBe('02');
        expect(payload.employee_id).toBe('001981');
        expect(payload.branch_code).toBe('0209');
        expect(payload.purpose).toBe('meal-enroll');
    });

    it('atravessa emitir -> abrir -> conferir -> cadastrar, com a chave intacta', async () => {
        const { useCases, state } = build({ birthDate: '19900312' });

        const invite = await useCases.issueInvite(
            { companyCode: '02', employeeId: '001981', branchCode: '0209' },
            { userId: 148 },
        );

        const opened = await useCases.openInvite(invite.token);
        expect(opened.valid).toBe(true);
        // Abrir NAO revela nada da pessoa — e a defesa contra o oraculo.
        expect(opened).not.toHaveProperty('employee_name');

        const confirmed = await useCases.confirmIdentity(invite.token, '12/03/1990');
        expect(confirmed.employee_name).toBe('HYGOR AZEVEDO BUENO');

        await useCases.enroll(confirmed.confirmed_token, {
            images: ['a', 'b', 'c'],
            consentAccepted: true,
            ip: '10.10.10.5',
        });

        // A chave chegou inteira ao outro lado da travessia.
        expect(state.saved.companyCode).toBe('02');
        expect(state.saved.employeeId).toBe('001981');
        expect(state.saved.branchCode).toBe('0209');

        // consent_at e enrolled_at do MESMO instante — a correcao dos dois
        // relogios do CK_meal_biometric_consent_before_enroll.
        expect(state.saved.consentAt.getTime()).toBe(state.saved.enrolledAt.getTime());
    });

    it('aceita token legado em camelCase, para nao invalidar convite no celular de alguem', async () => {
        const { useCases } = build();

        const legacy = jwt.sign(
            {
                companyCode: '02',
                employeeId: '001981',
                branchCode: '0209',
                purpose: 'meal-enroll',
                jti: 'db34d66a-4353-477c-8373-a7ada6d3be86',
            },
            SECRET,
            { expiresIn: '7d' },
        );

        const confirmed = await useCases.confirmIdentity(legacy, '19900312');
        const payload = jwt.verify(confirmed.confirmed_token, SECRET);

        expect(payload.company_code).toBe('02');
        expect(payload.employee_id).toBe('001981');
        expect(payload.branch_code).toBe('0209');
    });
});

describe('conferencia de identidade', () => {
    it('recusa data errada e informa quantas tentativas sobram', async () => {
        const { useCases } = build({ birthDate: '19900312' });

        const invite = await useCases.issueInvite(
            { companyCode: '02', employeeId: '001981', branchCode: '0209' },
            { userId: 148 },
        );

        await expect(useCases.confirmIdentity(invite.token, '01/01/1980'))
            .rejects.toThrow(/2 tentativas/);
    });

    it('queima o convite na terceira tentativa errada', async () => {
        const { useCases, state } = build({ birthDate: '19900312' });

        const invite = await useCases.issueInvite(
            { companyCode: '02', employeeId: '001981', branchCode: '0209' },
            { userId: 148 },
        );

        await expect(useCases.confirmIdentity(invite.token, '01/01/1980')).rejects.toThrow();
        await expect(useCases.confirmIdentity(invite.token, '02/02/1981')).rejects.toThrow();
        await expect(useCases.confirmIdentity(invite.token, '03/03/1982'))
            .rejects.toThrow(/esgotadas/i);

        expect(state.burned).toBe('attempts_exhausted');
    });

    /**
     * RA_NASC vazio: a pessoa não tem como acertar. Queimar e mandar ao RH é
     * melhor que deixá-la gastando tentativas contra uma pergunta sem resposta.
     */
    it('queima o convite quando o Protheus nao tem a data de nascimento', async () => {
        const { useCases, state } = build({ birthDate: '' });

        const invite = await useCases.issueInvite(
            { companyCode: '02', employeeId: '001981', branchCode: '0209' },
            { userId: 148 },
        );

        await expect(useCases.confirmIdentity(invite.token, '12/03/1990'))
            .rejects.toThrow(/não está no cadastro/i);

        expect(state.burned).toBe('birth_date_missing');
    });

    it('aceita a data nos dois formatos que a pessoa pode digitar', async () => {
        for (const informed of ['12/03/1990', '1990-03-12', '12031990', '19900312']) {
            const { useCases } = build({ birthDate: '19900312' });
            const invite = await useCases.issueInvite(
                { companyCode: '02', employeeId: '001981', branchCode: '0209' },
                { userId: 148 },
            );

            const confirmed = await useCases.confirmIdentity(invite.token, informed);
            expect(confirmed.confirmed).toBe(true);
        }
    });
});

describe('cadastro pelo link', () => {
    it('exige o aceite do termo', async () => {
        const { useCases } = build();
        const invite = await useCases.issueInvite(
            { companyCode: '02', employeeId: '001981', branchCode: '0209' },
            { userId: 148 },
        );
        const confirmed = await useCases.confirmIdentity(invite.token, '19900312');

        await expect(
            useCases.enroll(confirmed.confirmed_token, {
                images: ['a', 'b', 'c'],
                consentAccepted: false,
            }),
        ).rejects.toThrow(/consentimento/i);
    });

    it('avisa que a primeira refeicao ainda exige o cracha', async () => {
        const { useCases } = build();
        const invite = await useCases.issueInvite(
            { companyCode: '02', employeeId: '001981', branchCode: '0209' },
            { userId: 148 },
        );
        const confirmed = await useCases.confirmIdentity(invite.token, '19900312');

        const result = await useCases.enroll(confirmed.confirmed_token, {
            images: ['a', 'b', 'c'],
            consentAccepted: true,
        });

        expect(result.first_meal_requires_qr).toBe(true);
    });

    it('recusa o token de conferencia depois de o link ja ter sido usado', async () => {
        const { useCases, state } = build();
        const invite = await useCases.issueInvite(
            { companyCode: '02', employeeId: '001981', branchCode: '0209' },
            { userId: 148 },
        );
        const confirmed = await useCases.confirmIdentity(invite.token, '19900312');

        await useCases.enroll(confirmed.confirmed_token, {
            images: ['a', 'b', 'c'],
            consentAccepted: true,
        });
        expect(state.consumed).toBe(true);

        await expect(
            useCases.enroll(confirmed.confirmed_token, {
                images: ['a', 'b', 'c'],
                consentAccepted: true,
            }),
        ).rejects.toThrow(/já foi usado/i);
    });
});
