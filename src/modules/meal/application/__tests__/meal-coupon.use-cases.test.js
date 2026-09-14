const {
    MealCouponUseCases,
    REASON,
    DEFAULT_MEAL_SEQPRODUTO,
    DEFAULT_LIST_LIMIT,
    mealsFromQuantity,
} = require('../meal-coupon.use-cases');
const { DINER_TYPE, IDENTIFIED_BY, MEAL_TYPE } = require('../../domain/meal.enums');

// Chave real de producao: CNPJ 60479680001252, serie 101, nNF 371116, tpEmis 1.
const KEY = '35260860479680001252651010003711161934272357';
const URL = `https://www.nfce.fazenda.sp.gov.br/qrcode?p=${KEY}|2|1|1|8692A67`;

// Contingencia: serie 107, nNF 384153, tpEmis 9.
const KEY_CONTINGENCY = '35260860479680001252651070003841539820368945';

const SEQPRODUTO = 4071;
const TODAY = new Date(2026, 7, 26, 12, 30); // 26/08/2026, meio-dia e meia
const UUID = '3f1a7c9e-2b4d-4a6f-8c1e-9d0b5a7f3c21';

function makeRepo(overrides = {}) {
    return {
        // Vem do SYS_COMPANY do Protheus, em tempo real. Nao ha cadastro de
        // lojas do lado do refeitorio.
        findPosSiteByCnpj: jest.fn().mockResolvedValue({
            cnpj: '60479680001252',
            site_code: '0202',
            label: 'Peg Pese Interlagos',
        }),
        findCouponInConsinco: jest.fn().mockResolvedValue({
            nroempresa: 1,
            dtamovimento: new Date(2026, 7, 26),
            seqproduto: SEQPRODUTO,
            quantidade: 1,
            vlritem: 26.9,
        }),
        getCouponBalance: jest.fn().mockResolvedValue(null),
        redeemCouponWithMealLog: jest.fn().mockResolvedValue({
            coupon: { id: 1, seq: 1 },
            log: { id: 900 },
        }),
        ...overrides,
    };
}

// Fase 1 vai ao ar com a trava de data DESLIGADA, entao esse e o padrao aqui.
// Os testes da trava ligada passam enforceDate: true de proposito.
function makeUseCases(repo, options = {}) {
    return new MealCouponUseCases({
        repository: repo,
        seqProduto: SEQPRODUTO,
        enforceDate: false,
        lookbackDays: 90,
        now: () => TODAY,
        ...options,
    });
}

describe('produto do almoco', () => {
    it('usa 69988 como padrao quando nao ha env var', () => {
        // Valor fixo do produto em uso. Trocar aqui sem trocar no Consinco faz
        // todo cupom voltar 'no-meal-item'.
        expect(DEFAULT_MEAL_SEQPRODUTO).toBe(69988);
    });

    it('filtra o almoco pelo seqproduto configurado', async () => {
        // Cupom com almoco + Coca-Cola: so o almoco chega a query, porque o
        // filtro esta no ON do LEFT JOIN.
        const repo = makeRepo();
        await makeUseCases(repo).validateCoupon({ qr: URL, siteCode: '0202' });

        expect(repo.findCouponInConsinco).toHaveBeenCalledWith(
            expect.objectContaining({ seqproduto: SEQPRODUTO }),
        );
    });
});

describe('mealsFromQuantity', () => {
    it('conta uma refeicao por unidade', () => {
        expect(mealsFromQuantity(1)).toBe(1);
        expect(mealsFromQuantity(4)).toBe(4);
    });

    it('trata quantidade fracionaria como UMA refeicao', () => {
        // Produto por peso: 0,487 kg e o prato de uma pessoa, nao meia refeicao.
        // 2,5 kg tambem e de uma pessoa — peso nao e contagem.
        expect(mealsFromQuantity(0.487)).toBe(1);
        expect(mealsFromQuantity(2.5)).toBe(1);
    });

    it('nunca devolve menos de uma refeicao', () => {
        for (const value of [0, -3, null, undefined, NaN, 'abc']) {
            expect(mealsFromQuantity(value)).toBe(1);
        }
    });
});

describe('validateCoupon — caminho feliz', () => {
    it('aceita cupom do dia, da loja certa, com o produto travado', async () => {
        const repo = makeRepo();
        const r = await makeUseCases(repo).validateCoupon({ qr: URL, siteCode: '0202' });

        expect(r.valid).toBe(true);
        expect(r.reason).toBe(REASON.OK);
        expect(r.nfe_key).toBe(KEY);
        expect(r.meals_authorized).toBe(1);
        expect(r.meals_remaining).toBe(1);
    });

    it('consulta o Consinco com os campos extraidos nas posicoes certas', async () => {
        const repo = makeRepo();
        await makeUseCases(repo).validateCoupon({ qr: URL, siteCode: '0202' });

        // Se os offsets da chave regredirem, serie vira '526' e numerodf vira
        // 510100037 — e a query nunca acha nada em producao.
        expect(repo.findCouponInConsinco).toHaveBeenCalledWith(
            expect.objectContaining({
                // CNPJ, nao nroempresa: o cupom nao carrega numero de loja, e
                // GE_EMPRESA faz a traducao dentro do proprio Consinco.
                cnpj: '60479680001252',
                serie: '101',
                numerodf: 371116,
                seqproduto: SEQPRODUTO,
            }),
        );
    });

    it('devolve o valor pago, para o relatorio de receita', async () => {
        const r = await makeUseCases(makeRepo()).validateCoupon({ qr: URL, siteCode: '0202' });
        expect(r.item_value).toBe(26.9);
    });

    it('com a trava de data ligada, a janela cobre so ontem e hoje', async () => {
        // Ontem precisa entrar: sem ele, "cupom de ontem" volta como "nao
        // existe", que e a mesma resposta de uma chave inventada.
        const repo = makeRepo();
        await makeUseCases(repo, { enforceDate: true })
            .validateCoupon({ qr: URL, siteCode: '0202' });

        const { from, to } = repo.findCouponInConsinco.mock.calls[0][0];
        expect(from).toEqual(new Date(2026, 7, 25));
        expect(to).toEqual(new Date(2026, 7, 27));
    });

    it('com a trava desligada, a janela abre ate o alcance configurado', async () => {
        // A janela nao e "validade do cupom": e o alcance da BUSCA, e existe
        // para o indice de DTAMOVIMENTO continuar em seek.
        const repo = makeRepo();
        await makeUseCases(repo).validateCoupon({ qr: URL, siteCode: '0202' });

        const { from } = repo.findCouponInConsinco.mock.calls[0][0];
        expect(from).toEqual(new Date(2026, 4, 28)); // 90 dias antes de 26/08
    });

    it('aceita cupom em contingencia que esta no Consinco', async () => {
        const repo = makeRepo({
            findCouponInConsinco: jest.fn().mockResolvedValue({
                dtamovimento: new Date(2026, 7, 26),
                seqproduto: SEQPRODUTO,
                quantidade: 1,
            }),
        });

        const r = await makeUseCases(repo).validateCoupon({
            qr: KEY_CONTINGENCY,
            siteCode: '0202',
        });

        expect(r.valid).toBe(true);
        expect(r.is_contingency).toBe(true);
        expect(r.tp_emis).toBe('9');
    });
});

describe('validateCoupon — trava de data (fase 1 desligada)', () => {
    function repoWithCouponFrom(date) {
        return makeRepo({
            findCouponInConsinco: jest.fn().mockResolvedValue({
                nroempresa: 1,
                dtamovimento: date,
                seqproduto: SEQPRODUTO,
                quantidade: 1,
            }),
        });
    }

    it('aceita cupom de outro dia, mas marca is_today: false', async () => {
        // Decisao de produto da fase 1. O que fica exposto e o cupom
        // DESCARTADO: nota de almoco jogada no lixo vira refeicao gratis para
        // quem recolher. `is_today` e o gancho para a tela ao menos avisar.
        const r = await makeUseCases(repoWithCouponFrom(new Date(2026, 6, 12)))
            .validateCoupon({ qr: URL, siteCode: '0202' });

        expect(r.valid).toBe(true);
        expect(r.is_today).toBe(false);
        expect(r.coupon_date).toBe('2026-07-12');
    });

    it('marca is_today: true no cupom do dia', async () => {
        const r = await makeUseCases(repoWithCouponFrom(new Date(2026, 7, 26)))
            .validateCoupon({ qr: URL, siteCode: '0202' });

        expect(r.valid).toBe(true);
        expect(r.is_today).toBe(true);
    });

    it('a trava liga so por configuracao, sem mexer em codigo', async () => {
        const r = await makeUseCases(repoWithCouponFrom(new Date(2026, 6, 12)),
            { enforceDate: true }).validateCoupon({ qr: URL, siteCode: '0202' });

        expect(r.valid).toBe(false);
        expect(r.reason).toBe(REASON.NOT_TODAY);
    });
});

describe('validateCoupon — saldo de N almocos', () => {
    it('libera 4 almocos quando o cupom tem quantidade 4', async () => {
        const repo = makeRepo({
            findCouponInConsinco: jest.fn().mockResolvedValue({
                dtamovimento: new Date(2026, 7, 26),
                seqproduto: SEQPRODUTO,
                quantidade: 4,
            }),
        });

        const r = await makeUseCases(repo).validateCoupon({ qr: URL, siteCode: '0202' });

        expect(r.meals_authorized).toBe(4);
        expect(r.meals_remaining).toBe(4);
        expect(r.message).toMatch(/Restam 4 de 4/);
    });

    it('desconta o que ja foi servido', async () => {
        const repo = makeRepo({
            getCouponBalance: jest.fn().mockResolvedValue({
                meals_authorized: 4,
                meals_redeemed: 3,
            }),
        });

        const r = await makeUseCases(repo).validateCoupon({ qr: URL, siteCode: '0202' });

        expect(r.valid).toBe(true);
        expect(r.meals_remaining).toBe(1);
    });

    it('recusa quando o saldo acabou', async () => {
        const repo = makeRepo({
            getCouponBalance: jest.fn().mockResolvedValue({
                meals_authorized: 4,
                meals_redeemed: 4,
            }),
        });

        const r = await makeUseCases(repo).validateCoupon({ qr: URL, siteCode: '0202' });

        expect(r.valid).toBe(false);
        expect(r.reason).toBe(REASON.EXHAUSTED);
        expect(r.meals_remaining).toBe(0);
    });

    it('mantem o saldo concedido no primeiro resgate quando o ERP muda depois', async () => {
        // Cupom iniciado com 4; o Consinco agora diz 2. Encolher o saldo com
        // gente na fila seria pior que honrar o que ja foi prometido.
        const repo = makeRepo({
            findCouponInConsinco: jest.fn().mockResolvedValue({
                dtamovimento: new Date(2026, 7, 26),
                seqproduto: SEQPRODUTO,
                quantidade: 2,
            }),
            getCouponBalance: jest.fn().mockResolvedValue({
                meals_authorized: 4,
                meals_redeemed: 2,
            }),
        });

        const r = await makeUseCases(repo).validateCoupon({ qr: URL, siteCode: '0202' });

        expect(r.meals_authorized).toBe(4);
        expect(r.meals_remaining).toBe(2);
    });
});

describe('validateCoupon — recusas', () => {
    it('recusa QR ilegivel sem consultar banco nenhum', async () => {
        const repo = makeRepo();
        const r = await makeUseCases(repo).validateCoupon({ qr: 'lixo', siteCode: '0202' });

        expect(r.valid).toBe(false);
        expect(r.reason).toBe(REASON.UNREADABLE);
        expect(repo.findPosSiteByCnpj).not.toHaveBeenCalled();
        expect(repo.findCouponInConsinco).not.toHaveBeenCalled();
    });

    it('recusa CNPJ que nao e do grupo antes de ir ao Oracle', async () => {
        const repo = makeRepo({ findPosSiteByCnpj: jest.fn().mockResolvedValue(null) });
        const r = await makeUseCases(repo).validateCoupon({ qr: URL, siteCode: '0202' });

        expect(r.reason).toBe(REASON.UNKNOWN_STORE);
        expect(repo.findCouponInConsinco).not.toHaveBeenCalled();
    });

    // Nao existe recusa por "loja desabilitada": nao ha cadastro de lojas. Loja
    // que nao vende almoco ja e barrada porque o produto nao aparece no cupom
    // (no-meal-item), e quem pode servir e decidido pela permissao MEAL_SERVE.

    it('recusa cupom de outra loja e diz de qual e', async () => {
        const repo = makeRepo();
        const r = await makeUseCases(repo).validateCoupon({ qr: URL, siteCode: '0104' });

        expect(r.reason).toBe(REASON.WRONG_STORE);
        // Com duas filiais chamadas Interlagos, "loja errada" sem nome nao ajuda.
        expect(r.message).toMatch(/Peg Pese Interlagos/);
        expect(repo.findCouponInConsinco).not.toHaveBeenCalled();
    });

    it('recusa cupom que nao esta no Consinco', async () => {
        const repo = makeRepo({ findCouponInConsinco: jest.fn().mockResolvedValue(null) });
        const r = await makeUseCases(repo).validateCoupon({ qr: URL, siteCode: '0202' });

        expect(r.reason).toBe(REASON.NOT_FOUND);
    });

    it('com a trava ligada, recusa cupom de ontem e diz a data', async () => {
        const repo = makeRepo({
            findCouponInConsinco: jest.fn().mockResolvedValue({
                nroempresa: 1,
                dtamovimento: new Date(2026, 7, 25),
                seqproduto: SEQPRODUTO,
                quantidade: 1,
            }),
        });

        const r = await makeUseCases(repo, { enforceDate: true })
            .validateCoupon({ qr: URL, siteCode: '0202' });

        expect(r.reason).toBe(REASON.NOT_TODAY);
        expect(r.message).toMatch(/25\/08\/2026/);
        expect(r.is_today).toBe(false);
    });

    it('recusa cupom sem o item de almoco', async () => {
        // LEFT JOIN: a venda existe, o almoco nao esta nela.
        const repo = makeRepo({
            findCouponInConsinco: jest.fn().mockResolvedValue({
                dtamovimento: new Date(2026, 7, 26),
                seqproduto: null,
                quantidade: null,
            }),
        });

        const r = await makeUseCases(repo).validateCoupon({ qr: URL, siteCode: '0202' });
        expect(r.reason).toBe(REASON.NO_MEAL_ITEM);
    });

    it('exige a loja da sessao com 4 digitos', async () => {
        const uc = makeUseCases(makeRepo());
        await expect(uc.validateCoupon({ qr: URL, siteCode: 'Interlagos' }))
            .rejects.toThrow(/4 dígitos/);
    });

    it('recusa a operacao inteira quando o produto nao esta configurado', async () => {
        const uc = new MealCouponUseCases({
            repository: makeRepo(), seqProduto: null, now: () => TODAY,
        });

        await expect(uc.validateCoupon({ qr: URL, siteCode: '0202' }))
            .rejects.toMatchObject({ statusCode: 503 });
    });
});

describe('redeemCoupon', () => {
    it('grava refeicao de cupom com os codigos certos', async () => {
        const repo = makeRepo();

        await makeUseCases(repo).redeemCoupon(
            { qr: URL, siteCode: '0202', clientUuid: UUID },
            { userId: 42 },
        );

        const [coupon, log] = repo.redeemCouponWithMealLog.mock.calls[0];

        expect(log).toMatchObject({
            diner_type: DINER_TYPE.COUPON,
            identified_by: IDENTIFIED_BY.COUPON,
            meal_type: MEAL_TYPE.LUNCH,
            site_code: '0202',
            client_uuid: UUID,
            operator_user_id: 42,
        });
        expect(coupon).toMatchObject({
            nfe_key: KEY,
            meals_authorized: 1,
            site_code: '0202',
            seqproduto: SEQPRODUTO,
            tp_emis: '1',
        });
    });

    it('reconfere o cupom antes de gravar', async () => {
        // A tela chamou validate ha alguns segundos. Nesses segundos o outro
        // terminal pode ter servido a ultima refeicao do cupom.
        const repo = makeRepo({
            getCouponBalance: jest.fn().mockResolvedValue({
                meals_authorized: 1, meals_redeemed: 1,
            }),
        });

        await expect(
            makeUseCases(repo).redeemCoupon(
                { qr: URL, siteCode: '0202', clientUuid: UUID }, { userId: 42 },
            ),
        ).rejects.toMatchObject({ statusCode: 409 });

        expect(repo.redeemCouponWithMealLog).not.toHaveBeenCalled();
    });

    it('leva a causa da recusa no code, que e o que atravessa o middleware', () => {
        // `details` fica no servidor; so `message`, `code` e `fields` saem. Sem
        // isto o front teria que casar em texto de mensagem.
        const cases = [
            [{ getCouponBalance: jest.fn().mockResolvedValue({ meals_authorized: 1, meals_redeemed: 1 }) },
                'COUPON_EXHAUSTED'],
            [{ findCouponInConsinco: jest.fn().mockResolvedValue(null) },
                'COUPON_NOT_FOUND'],
            [{ findPosSiteByCnpj: jest.fn().mockResolvedValue(null) },
                'COUPON_UNKNOWN_STORE'],
        ];

        return Promise.all(cases.map(([overrides, expected]) =>
            expect(
                makeUseCases(makeRepo(overrides)).redeemCoupon(
                    { qr: URL, siteCode: '0202', clientUuid: UUID }, {},
                ),
            ).rejects.toMatchObject({ statusCode: 409, code: expected })));
    });

    it('exige client_uuid valido', async () => {
        const uc = makeUseCases(makeRepo());

        await expect(uc.redeemCoupon({ qr: URL, siteCode: '0202', clientUuid: 'abc' }, {}))
            .rejects.toThrow(/client_uuid/);
        await expect(uc.redeemCoupon({ qr: URL, siteCode: '0202' }, {}))
            .rejects.toThrow(/client_uuid/);
    });

    it('recusa meal_type invalido', async () => {
        const uc = makeUseCases(makeRepo());

        await expect(
            uc.redeemCoupon({ qr: URL, siteCode: '0202', clientUuid: UUID, mealType: 9 }, {}),
        ).rejects.toThrow(/meal_type inválido/);
    });

    it('assume almoco quando meal_type nao vem', async () => {
        const repo = makeRepo();
        await makeUseCases(repo).redeemCoupon(
            { qr: URL, siteCode: '0202', clientUuid: UUID }, {},
        );

        const [, log] = repo.redeemCouponWithMealLog.mock.calls[0];
        expect(log.meal_type).toBe(MEAL_TYPE.LUNCH);
    });
});
// ─── Conferencia e estorno ────────────────────────────────────────────────────

function makeAdminRepo(overrides = {}) {
    return makeRepo({
        listCoupons: jest.fn().mockResolvedValue({ total: 0, rows: [] }),
        deleteCouponById: jest.fn().mockResolvedValue({
            coupon: { id: 7, nfe_key: KEY, seq: 1, meal_log_id: 900 },
            meal_log_deleted: true,
        }),
        ...overrides,
    });
}

describe('listCoupons', () => {
    it('exige recorte: sem chave e sem periodo, recusa', async () => {
        // Nao e formalidade: os indices sao (nfe_key) e (service_date,
        // site_code). Sem um dos dois a consulta varre a tabela inteira.
        await expect(makeUseCases(makeAdminRepo()).listCoupons({}))
            .rejects.toThrow(/nfe_key/);
    });

    it('recusa chave que nao tem 44 digitos', async () => {
        await expect(makeUseCases(makeAdminRepo()).listCoupons({ nfeKey: '123' }))
            .rejects.toThrow(/44 dígitos/);
    });

    it('a chave tem precedencia sobre o periodo', async () => {
        const repo = makeAdminRepo();
        await makeUseCases(repo).listCoupons({
            nfeKey: KEY, dateFrom: '2026-08-01', dateTo: '2026-08-02',
        });

        // Quem procura um cupom quer o historico dele inteiro, nao a intersecao
        // com o periodo que sobrou na tela.
        expect(repo.listCoupons).toHaveBeenCalledWith(
            expect.objectContaining({ nfeKey: KEY, dateFrom: null, dateTo: null }),
        );
    });

    it('recusa periodo maior que o teto', async () => {
        await expect(makeUseCases(makeAdminRepo()).listCoupons({
            dateFrom: '2026-01-01', dateTo: '2026-12-31',
        })).rejects.toThrow(/período máximo/);
    });

    it('recusa date_from depois de date_to', async () => {
        await expect(makeUseCases(makeAdminRepo()).listCoupons({
            dateFrom: '2026-08-10', dateTo: '2026-08-01',
        })).rejects.toThrow(/date_from/);
    });

    it('recusa limit acima do teto', async () => {
        await expect(makeUseCases(makeAdminRepo()).listCoupons({
            dateFrom: '2026-08-01', dateTo: '2026-08-02', limit: 5000,
        })).rejects.toThrow(/limit/);
    });

    it('limit invalido cai no padrao em vez de derrubar a consulta', async () => {
        const repo = makeAdminRepo();
        await makeUseCases(repo).listCoupons({
            dateFrom: '2026-08-01', dateTo: '2026-08-02', limit: 'abc',
        });

        expect(repo.listCoupons).toHaveBeenCalledWith(
            expect.objectContaining({ limit: DEFAULT_LIST_LIMIT, offset: 0 }),
        );
    });

    it('has_more diz se a pagina acabou', async () => {
        const repo = makeAdminRepo({
            listCoupons: jest.fn().mockResolvedValue({
                total: 30, rows: [{ id: 1 }, { id: 2 }],
            }),
        });

        const page = await makeUseCases(repo).listCoupons({
            nfeKey: KEY, limit: 2, offset: 10,
        });

        expect(page).toMatchObject({ total: 30, count: 2, has_more: true });
    });
});

describe('deleteCoupon', () => {
    it('recusa id que nao e inteiro positivo', async () => {
        const repo = makeAdminRepo();

        await expect(makeUseCases(repo).deleteCoupon('abc', {}))
            .rejects.toThrow(/id do resgate/);
        await expect(makeUseCases(repo).deleteCoupon(0, {}))
            .rejects.toThrow(/id do resgate/);

        expect(repo.deleteCouponById).not.toHaveBeenCalled();
    });

    it('id inexistente e 404, nao sucesso silencioso', async () => {
        // Duas pessoas no mesmo relatorio e caso real: a segunda tem que ver a
        // lista mudar, e nao um "ok" para algo que ja nao estava la.
        const repo = makeAdminRepo({ deleteCouponById: jest.fn().mockResolvedValue(null) });

        await expect(makeUseCases(repo).deleteCoupon(7, {}))
            .rejects.toMatchObject({ statusCode: 404, code: 'COUPON_NOT_FOUND' });
    });

    it('devolve o que foi apagado, e se a refeicao foi junto', async () => {
        const repo = makeAdminRepo();
        const out = await makeUseCases(repo).deleteCoupon('7', { userId: 42 });

        expect(repo.deleteCouponById).toHaveBeenCalledWith(7);
        expect(out).toMatchObject({
            deleted: true,
            meal_log_deleted: true,
            coupon: { id: 7, nfe_key: KEY },
        });
    });
});
