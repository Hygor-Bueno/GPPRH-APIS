const { MealEnrollUseCases } = require('../meal-enroll.use-cases');

/**
 * Estes testes existem por causa de um bug real, em 19/08/2026: `identifyByFace`
 * chamava `trimOrNull`, que só existia no OUTRO arquivo de casos de uso. O
 * `node --check` não pega isso — `ReferenceError` de função ausente só aparece
 * quando a linha executa — e o sintoma em produção foi o operador tocando
 * "Identificar por rosto" e recebendo falha genérica.
 *
 * A lição que estes testes travam: **exercitar cada caminho de saída pelo menos
 * uma vez**, mesmo os de validação de argumento. Um caso de uso que nunca é
 * chamado em teste nenhum é código que só roda em produção.
 */

/**
 * Stubs minimos: nenhum teste aqui toca banco nem container.
 *
 * `identifyScope` e sempre EXPLICITO, nunca herdado do padrao do modulo. O
 * padrao le MEAL_FACE_IDENTIFY_SCOPE do ambiente, e teste que depende de env
 * passa ou falha conforme a maquina — pior que nao existir.
 */
function build({ candidates = [], embed, diner = null, scope = 'site' } = {}) {
    const repository = {
        findIdentifyCandidates: jest.fn().mockResolvedValue(candidates),
        findDiner: jest.fn().mockResolvedValue(diner),
        saveBiometric: jest.fn().mockResolvedValue({ saved: true }),
    };

    const faceClient = {
        embed: embed
            ?? jest.fn().mockResolvedValue({
                embedding: Buffer.alloc(2048).toString('base64'),
                model_tag: 'insightface-buffalo_l-w600k_r50',
                det_score: 0.9,
                bbox: [0, 0, 1, 1],
            }),
    };

    return {
        useCases: new MealEnrollUseCases({ repository, faceClient, identifyScope: scope }),
        repository,
        faceClient,
    };
}

/** Vetor unitário sintético: 1 na posição `index`, 0 no resto. */
function unitVector(index) {
    const array = new Float32Array(512);
    array[index] = 1;
    return Buffer.from(array.buffer);
}

function embedReturning(buffer) {
    return jest.fn().mockResolvedValue({
        embedding: buffer.toString('base64'),
        model_tag: 'insightface-buffalo_l-w600k_r50',
        det_score: 0.9,
        bbox: [0, 0, 1, 1],
    });
}

describe('identifyByFace — validacao de argumento', () => {
    // Era exatamente aqui que o ReferenceError estourava.
    it('recusa loja ausente sem estourar ReferenceError', async () => {
        const { useCases } = build();
        await expect(useCases.identifyByFace(undefined, 'abc')).rejects.toThrow(/loja/i);
    });

    it('recusa loja com formato errado', async () => {
        const { useCases } = build();
        await expect(useCases.identifyByFace('202', 'abc')).rejects.toThrow(/4 dígitos/i);
        await expect(useCases.identifyByFace('INTERLAGOS', 'abc')).rejects.toThrow(/4 dígitos/i);
    });

    it('aceita loja valida e nao chama o banco antes de gerar o vetor', async () => {
        const { useCases, faceClient, repository } = build();
        await expect(useCases.identifyByFace('0202', 'abc')).rejects.toThrow(/Nenhum rosto/i);

        // O embed vem ANTES da consulta: sem model_tag não há como filtrar
        // candidatos comparáveis.
        expect(faceClient.embed).toHaveBeenCalledTimes(1);
        expect(repository.findIdentifyCandidates).toHaveBeenCalledWith(
            '0202',
            'insightface-buffalo_l-w600k_r50',
            'site',
        );
    });
});

/**
 * O recorte por loja virou MODO, e o padrao do codigo continua sendo `site`.
 * Subir a API em outro ambiente sem configurar nada nao pode abrir a busca para
 * a base inteira por acidente — o modo arriscado exige ato explicito.
 */
describe('identifyByFace — abrangencia da busca', () => {
    const DA_LOJA = {
        company_code: '02', employee_id: '000123', branch_code: '0202',
        embedding: unitVector(0), model_tag: 'insightface-buffalo_l-w600k_r50',
    };

    const DE_OUTRA_LOJA = {
        company_code: '02', employee_id: '000999', branch_code: '0301',
        embedding: unitVector(0), model_tag: 'insightface-buffalo_l-w600k_r50',
    };

    const DINER = {
        employee_name: 'MARIA', employee_full_name: 'MARIA DA SILVA',
        cost_center: '1001', cost_center_description: 'LOJA',
        is_terminated: 0, terminated_at: null, meals_today: 0,
    };

    it('site: pede o recorte ao repositorio, como sempre fez', async () => {
        const { useCases, repository } = build({
            scope: 'site',
            embed: embedReturning(unitVector(0)),
            candidates: [DA_LOJA],
            diner: { ...DA_LOJA, ...DINER },
        });

        const result = await useCases.identifyByFace('0202', 'abc');

        expect(repository.findIdentifyCandidates)
            .toHaveBeenCalledWith('0202', 'insightface-buffalo_l-w600k_r50', 'site');
        expect(result.status).toBe('matched');
        expect(result.identify_scope).toBe('site');
    });

    it('global: identifica alguem de outra loja', async () => {
        // No piloto sao cinco rostos, e quem ainda nao comeu naquela loja seria
        // invisivel no recorte — que no piloto e todo mundo.
        const { useCases, repository } = build({
            scope: 'global',
            embed: embedReturning(unitVector(0)),
            candidates: [DE_OUTRA_LOJA],
            diner: { ...DE_OUTRA_LOJA, ...DINER },
        });

        const result = await useCases.identifyByFace('0202', 'abc');

        expect(repository.findIdentifyCandidates)
            .toHaveBeenCalledWith('0202', 'insightface-buffalo_l-w600k_r50', 'global');
        expect(result.status).toBe('matched');
        expect(result.diner.branch_code).toBe('0301');
        expect(result.identify_scope).toBe('global');
    });

    it('candidates_compared reflete o tamanho real nos dois modos', async () => {
        // E o numero que mostra quando a conta do recorte volta a valer.
        const tres = [DA_LOJA, DE_OUTRA_LOJA, {
            ...DE_OUTRA_LOJA, employee_id: '000777', embedding: unitVector(9),
        }];

        const { useCases } = build({
            scope: 'global',
            embed: embedReturning(unitVector(0)),
            candidates: tres,
            diner: { ...DA_LOJA, ...DINER },
        });

        const result = await useCases.identifyByFace('0202', 'abc');
        expect(result.candidates_compared).toBe(3);
    });

    it('global: a mensagem de galeria vazia nao fala em loja', async () => {
        const { useCases } = build({ scope: 'global', candidates: [] });

        await expect(useCases.identifyByFace('0202', 'abc'))
            .rejects.toThrow(/Nenhum rosto cadastrado ainda/);
    });

    it('site: a mensagem de galeria vazia continua falando em loja', async () => {
        const { useCases } = build({ scope: 'site', candidates: [] });

        await expect(useCases.identifyByFace('0202', 'abc'))
            .rejects.toThrow(/nesta loja/);
    });

    it('global ainda exige a loja: o contrato da rota nao muda com o modo', async () => {
        const { useCases } = build({ scope: 'global' });

        await expect(useCases.identifyByFace(undefined, 'abc')).rejects.toThrow(/loja/i);
        await expect(useCases.identifyByFace('202', 'abc')).rejects.toThrow(/4 dígitos/i);
    });
});

describe('identifyByFace — decisao', () => {
    const KEY = { company_code: '02', employee_id: '000123', branch_code: '0203' };

    it('identifica quando ha um candidato claramente acima do corte', async () => {
        const probe = unitVector(0);
        const { useCases } = build({
            embed: embedReturning(probe),
            candidates: [{ ...KEY, embedding: unitVector(0), model_tag: 'insightface-buffalo_l-w600k_r50' }],
            diner: {
                ...KEY,
                employee_name: 'MARIA',
                employee_full_name: 'MARIA DA SILVA',
                cost_center: '1001',
                cost_center_description: 'LOJA',
                is_terminated: 0,
                terminated_at: null,
                meals_today: 0,
            },
        });

        const result = await useCases.identifyByFace('0202', 'abc');

        expect(result.status).toBe('matched');
        expect(result.score).toBeCloseTo(1, 5);
        expect(result.diner.employee_name).toBe('MARIA');
    });

    it('nao identifica quando ninguem passa do corte', async () => {
        const { useCases } = build({
            embed: embedReturning(unitVector(0)),
            candidates: [{ ...KEY, embedding: unitVector(7), model_tag: 'insightface-buffalo_l-w600k_r50' }],
        });

        const result = await useCases.identifyByFace('0202', 'abc');

        expect(result.status).toBe('no-match');
        expect(result.score).toBeCloseTo(0, 5);
    });

    /**
     * A trava da margem. Dois vetores quase idênticos ao da foto: os dois passam
     * do corte, e escolher o maior seria escolher no ruído — o erro que lança a
     * refeição no centro de custo de outra pessoa.
     */
    it('devolve ambiguous quando o segundo colocado esta perto do primeiro', async () => {
        const near = new Float32Array(512);
        near[0] = 0.9999;
        near[1] = Math.sqrt(1 - 0.9999 ** 2);

        const { useCases } = build({
            embed: embedReturning(unitVector(0)),
            candidates: [
                { ...KEY, embedding: unitVector(0), model_tag: 'insightface-buffalo_l-w600k_r50' },
                {
                    company_code: '02',
                    employee_id: '000456',
                    branch_code: '0203',
                    embedding: Buffer.from(near.buffer),
                    model_tag: 'insightface-buffalo_l-w600k_r50',
                },
            ],
        });

        const result = await useCases.identifyByFace('0202', 'abc');

        expect(result.status).toBe('ambiguous');
        expect(result.runner_up_score).toBeGreaterThan(result.threshold);
        expect(result.margin).toBeLessThan(result.required_margin);
    });

    it('avisa que o limiar e provisorio enquanto nao houver calibracao', async () => {
        const previous = process.env.MEAL_FACE_THRESHOLD;
        delete process.env.MEAL_FACE_THRESHOLD;

        const { useCases } = build({
            embed: embedReturning(unitVector(0)),
            candidates: [{ ...KEY, embedding: unitVector(9), model_tag: 'insightface-buffalo_l-w600k_r50' }],
        });

        const result = await useCases.identifyByFace('0202', 'abc');
        expect(result.threshold_is_provisional).toBe(true);

        if (previous !== undefined) process.env.MEAL_FACE_THRESHOLD = previous;
    });
});

describe('enrollDirect — validacao de argumento', () => {
    it('exige o aceite da propria pessoa', async () => {
        const { useCases } = build();

        await expect(
            useCases.enrollDirect(
                { companyCode: '02', employeeId: '000123', branchCode: '0203' },
                { images: ['a', 'b', 'c'], consentAccepted: false },
                { userId: 1 },
            ),
        ).rejects.toThrow(/aceite o termo/i);
    });

    it('exige de 3 a 5 capturas', async () => {
        const { useCases } = build();
        const key = { companyCode: '02', employeeId: '000123', branchCode: '0203' };

        await expect(
            useCases.enrollDirect(key, { images: ['a'], consentAccepted: true }, {}),
        ).rejects.toThrow(/3 a 5/);

        await expect(
            useCases.enrollDirect(
                key,
                { images: ['a', 'b', 'c', 'd', 'e', 'f'], consentAccepted: true },
                {},
            ),
        ).rejects.toThrow(/3 a 5/);
    });

    it('recusa chave incompleta', async () => {
        const { useCases } = build();

        await expect(
            useCases.enrollDirect(
                { companyCode: '02', employeeId: '000123' },
                { images: ['a', 'b', 'c'], consentAccepted: true },
                {},
            ),
        ).rejects.toThrow(/empresa|filial/i);
    });
});
