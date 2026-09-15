/**
 * @fileoverview Casos de uso — venda de almoço a prestador por cupom fiscal.
 *
 * O prestador de serviço compra o almoço no caixa como compra qualquer produto,
 * e o cupom da compra é o que libera a refeição no balcão. Não há matrícula, não
 * há centro de custo, e a refeição é receita — por isso `DINER_TYPE.COUPON` e
 * não `GROUP`.
 *
 * ── Por que este módulo NÃO funciona offline ────────────────────────────────
 *
 * O resto do refeitório foi construído para servir com a rede caída: cache de
 * comensais, fila em `/logs/sync`. O cupom não entra nesse desenho, e a decisão
 * é deliberada. Validar exige o Consinco (a venda existe?) e o saldo (já foi
 * usado?), e nenhum dos dois tem resposta local. Enfileirar significaria servir
 * sem saber, e a fila é exatamente onde o mesmo cupom passa duas vezes — é o
 * cenário que a tabela de saldo existe para impedir. Quando a rede cai, o modo
 * cupom some da tela, do mesmo jeito que o modo facial some quando o container
 * de reconhecimento morre.
 *
 * @module modules/meal/application/meal-coupon.use-cases
 */

const { AppError } = require('../../../errors/app.error');
const { BadRequestError } = require('../../../errors/bad-request.error');
const { readNfceQr } = require('../domain/nfce-key');
const { DINER_TYPE, MEAL_TYPE, MEAL_TYPES, IDENTIFIED_BY } = require('../domain/meal.enums');

/**
 * Código do produto "almoço" no Consinco (`MFL_DFITEM.SEQPRODUTO`).
 *
 * O valor fixo é o produto em uso hoje. Ter um default aqui não contradiz a
 * cautela de "nunca adivinhar o produto": o perigo seria um default GENÉRICO,
 * que aceitaria qualquer item como almoço. Este é o código específico, e ele
 * está no código para o módulo funcionar sem depender de alguém lembrar de
 * configurar — a env var continua existindo porque recadastro de produto não
 * pode exigir deploy.
 *
 * É este código que separa o almoço do resto do cupom: quem compra almoço e
 * refrigerante na mesma nota tem o refrigerante ignorado, porque o filtro está
 * no `ON` do `LEFT JOIN` em `meal-coupon.queries.js` (Oracle).
 */
const DEFAULT_MEAL_SEQPRODUTO = 69988;

const MEAL_SEQPRODUTO = process.env.MEAL_COUPON_SEQPRODUTO
    ? Number(process.env.MEAL_COUPON_SEQPRODUTO)
    : DEFAULT_MEAL_SEQPRODUTO;

/**
 * Quantas refeições a quantidade do item representa.
 *
 * ⚠️ Ainda não foi confirmado se o almoço é vendido por UNIDADE ou por PESO, e
 * a diferença muda o significado do campo. Esta função é correta nas duas
 * hipóteses, o que evita ter que escolher errado:
 *
 *   · Quantidade INTEIRA (1, 4) → produto por unidade. Cada unidade é uma
 *     refeição, que é o caso da equipe de quatro comprando num cupom só.
 *
 *   · Quantidade FRACIONÁRIA (0,487) → produto por peso, e peso não é contagem:
 *     0,487 kg é o prato de UMA pessoa, não meia refeição. Vale 1.
 *
 * O buraco que sobra é peso em quilo exato (3,000 kg para uma pessoa vira 3
 * refeições). É bem menor que o de tratar todo peso como contagem, e fecha de
 * vez quando a dúvida unidade-vs-peso for respondida.
 */
function mealsFromQuantity(quantidade) {
    const qty = Number(quantidade);

    if (!Number.isFinite(qty) || qty <= 0) return 1;
    if (!Number.isInteger(qty)) return 1;

    return Math.trunc(qty);
}

/**
 * Recusar cupom que não é do dia.
 *
 * **Desligado na fase 1, por decisão de produto.** Ligue com
 * `MEAL_COUPON_ENFORCE_DATE=1` na fase 2 — sem deploy.
 *
 * ⚠️ O que fica exposto enquanto estiver desligado: o risco NÃO é o prestador
 * guardar o próprio cupom para usar depois. É **cupom descartado**. Nota fiscal
 * de almoço vai para o lixo o dia inteiro, e qualquer uma que contenha o
 * produto travado vira uma refeição grátis para quem a recolher. O controle de
 * uso único limita a uma vez POR CUPOM, e o estoque de cupons antigos é grande.
 *
 * A data continua sendo lida e devolvida em `coupon_date`, e `is_today` diz se
 * o cupom é de hoje. Com a trava desligada a tela ainda consegue avisar o
 * operador — recusar é o que não acontece.
 */
const ENFORCE_DATE = ['1', 'true', 'True'].includes(
    String(process.env.MEAL_COUPON_ENFORCE_DATE ?? ''),
);

/**
 * Quantos dias para trás procurar o cupom no Consinco, com a trava de data
 * desligada.
 *
 * Não é o mesmo que "cupom vale por 90 dias": é o alcance da BUSCA. Cupom mais
 * antigo que isso volta `not-found`, e a janela existe porque `DTAMOVIMENTO` é
 * a primeira coluna do índice — busca sem recorte vira varredura da tabela de
 * documentos fiscais inteira, que é a maior do ERP. 90 dias acompanha o teto de
 * 92 já usado pelos relatórios do módulo, pela mesma razão.
 *
 * Com a trava LIGADA nada disso importa e a janela encolhe para 1 dia: só
 * precisa enxergar ontem, para distinguir "cupom de ontem" de "cupom que não
 * existe".
 */
const LOOKBACK_DAYS = Number(process.env.MEAL_COUPON_LOOKBACK_DAYS || 90);

const DAY_MS = 86400000;

/** `M0_CODFIL`: quatro dígitos. */
const SITE_CODE_PATTERN = /^[0-9]{4}$/;

/** Recorte máximo da consulta, em dias. Igual ao dos relatórios do módulo. */
const MAX_LIST_SPAN_DAYS = 92;

/** Página padrão e teto da consulta de resgates. */
const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 500;

const DATE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

/** Chave de acesso da NFC-e: 44 dígitos, sem máscara. */
const NFE_KEY_PATTERN = /^[0-9]{44}$/;

const UUID_PATTERN =
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Motivos de recusa.
 *
 * Código estável para a tela decidir o que fazer, junto de um texto que o
 * operador consegue ler em voz alta para quem está na frente dele. Os dois
 * andam juntos porque a tela precisa distinguir "tente de novo" de "vá ao
 * caixa", e texto não serve para isso.
 */
const REASON = Object.freeze({
    OK: 'ok',
    UNREADABLE: 'unreadable',
    UNKNOWN_STORE: 'unknown-store',
    WRONG_STORE: 'wrong-store',
    NOT_FOUND: 'not-found',
    NOT_TODAY: 'not-today',
    NO_MEAL_ITEM: 'no-meal-item',
    EXHAUSTED: 'exhausted',
});

function toCivilDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/** Meia-noite local do dia de `date`. */
function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function trimOrNull(value) {
    if (typeof value !== 'string') return value ?? null;
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
}

class MealCouponUseCases {
    /**
     * @param {{repository: import('./ports/meal-coupon-repository.port').MealCouponRepositoryPort,
     *          seqProduto?: number, now?: () => Date}} deps
     */
    constructor({
        repository,
        seqProduto = MEAL_SEQPRODUTO,
        enforceDate = ENFORCE_DATE,
        lookbackDays = LOOKBACK_DAYS,
        now = () => new Date(),
    }) {
        this.repository = repository;
        this.seqProduto = seqProduto;
        this.enforceDate = enforceDate;
        this.lookbackDays = lookbackDays;
        this.now = now;
    }

    /**
     * Confere o cupom e devolve o que ele libera. **Não consome.**
     *
     * Mesma divisão que o reconhecimento facial já usa (`/enroll/verify` confere,
     * `/logs` grava), e pelo mesmo motivo: o operador precisa ver "2 almoços,
     * restam 2" antes de servir o primeiro prato.
     *
     * Sempre resolve — nunca lança por cupom recusado. Cupom ruim é caso normal
     * de operação, não erro de requisição, e transformar em 4xx faria a tela
     * tratar rotina como falha.
     *
     * @param {{qr: string, siteCode: string}} input
     * @returns {Promise<object>}
     */
    async validateCoupon({ qr, siteCode }) {
        const site = trimOrNull(siteCode);

        if (!site || !SITE_CODE_PATTERN.test(site)) {
            throw new BadRequestError('Informe a loja com 4 dígitos (ex.: 0202).');
        }

        if (!this.seqProduto) {
            /* 503 e não 500: é configuração ausente, o operador não causou e não
               resolve, e a saída dele é o mesmo caminho de sempre — o caixa. */
            throw new AppError(
                'A venda de almoço por cupom não está configurada nesta instalação.',
                503,
                { code: 'COUPON_PRODUCT_NOT_CONFIGURED' },
            );
        }

        // ─── Portões 1 e 2: a chave, sem tocar em banco ─────────────────────
        const read = readNfceQr(qr);

        if (read.errors.length > 0) {
            return this._refuse(REASON.UNREADABLE, read.errors[0], { nfe_key: read.key });
        }

        // ─── Portão 3: de qual loja é este cupom ────────────────────────────
        const pos = await this.repository.findPosSiteByCnpj(read.cnpj);

        if (!pos) {
            return this._refuse(
                REASON.UNKNOWN_STORE,
                'Esse cupom não é de uma loja do grupo.',
                { nfe_key: read.key },
            );
        }

        if (pos.site_code !== site) {
            /* Comprou numa loja e tenta almoçar em outra. A mensagem nomeia a
               loja de origem porque, com duas filiais chamadas Interlagos, "loja
               errada" sem nome não ajuda ninguém. */
            return this._refuse(
                REASON.WRONG_STORE,
                `Esse cupom é da ${pos.label} e só vale lá.`,
                { nfe_key: read.key },
            );
        }

        // ─── Portões 4 e 5: a venda existe, e tem almoço? ───────────────────
        const today = startOfDay(this.now());
        const tomorrow = new Date(today.getTime() + DAY_MS);

        /* Com a trava de data LIGADA, um dia para trás basta — e é preciso: com
           a janela colada em hoje, o cupom de ontem volta zero linhas e vira
           "não existe", mesma resposta de uma chave inventada. São coisas
           diferentes, uma é engano e a outra é tentativa.

           Com a trava DESLIGADA a janela é o alcance da busca, e existe só para
           o índice de DTAMOVIMENTO continuar em seek. */
        const lookback = this.enforceDate ? 1 : this.lookbackDays;
        const from = new Date(today.getTime() - lookback * DAY_MS);

        /* O CNPJ vai direto: `GE_EMPRESA` resolve o `nroempresa` do lado do
           Consinco. Copiar esse número para uma tabela nossa criaria uma cópia
           que envelhece em silêncio se o ERP mudar. */
        const doc = await this.repository.findCouponInConsinco({
            cnpj: read.cnpj,
            serie: read.serie,
            numerodf: read.nNF,
            seqproduto: this.seqProduto,
            from,
            to: tomorrow,
        });

        if (!doc) {
            return this._refuse(
                REASON.NOT_FOUND,
                'Esse cupom não foi encontrado. Confira no caixa.',
                { nfe_key: read.key },
            );
        }

        const couponDate = toCivilDate(new Date(doc.dtamovimento));
        const isToday = couponDate === toCivilDate(today);

        /* A recusa por data está atrás de `enforceDate` porque a fase 1 vai ao ar
           sem ela. Mesmo desligada, `is_today` e `coupon_date` saem na resposta:
           a tela consegue avisar o operador que o cupom é de outro dia, o que é
           bem melhor que a informação sumir junto com a trava. */
        if (!isToday && this.enforceDate) {
            return this._refuse(
                REASON.NOT_TODAY,
                `Esse cupom é de ${couponDate.split('-').reverse().join('/')} e só vale no dia da compra.`,
                { nfe_key: read.key, coupon_date: couponDate, is_today: false },
            );
        }

        if (doc.seqproduto === null || doc.seqproduto === undefined) {
            return this._refuse(
                REASON.NO_MEAL_ITEM,
                'Esse cupom não tem almoço na lista de itens.',
                { nfe_key: read.key, coupon_date: couponDate },
            );
        }

        // ─── Portão 6: quanto sobrou ────────────────────────────────────────
        const authorized = mealsFromQuantity(doc.quantidade);
        const balance = await this.repository.getCouponBalance(read.key);

        /* `meals_authorized` sai do banco quando já houve resgate, e do Consinco
           só no primeiro. Um cupom já iniciado não muda de saldo se a quantidade
           mudar no ERP no meio da fila. */
        const authorizedNow = balance ? balance.meals_authorized : authorized;
        const redeemed = balance ? Number(balance.meals_redeemed) : 0;
        const remaining = authorizedNow - redeemed;

        const detail = {
            nfe_key: read.key,
            site_code: pos.site_code,
            site_label: pos.label,
            coupon_date: couponDate,
            /* `false` só chega aqui com a trava desligada. É o gancho para a
               tela destacar "cupom de 12/07" em vez de servir sem ninguém ver. */
            is_today: isToday,
            seqproduto: doc.seqproduto,
            /* Valor pago. Não valida nada — é o dado que o relatório de receita
               precisa e que o rateio de centro de custo não sabe produzir. */
            item_value: doc.vlritem ?? null,
            tp_emis: read.tpEmis,
            is_contingency: read.isContingency,
            meals_authorized: authorizedNow,
            meals_redeemed: redeemed,
            meals_remaining: Math.max(0, remaining),
        };

        if (remaining <= 0) {
            return {
                ...detail,
                valid: false,
                reason: REASON.EXHAUSTED,
                message: authorizedNow === 1
                    ? 'Esse cupom já foi usado.'
                    : `Esse cupom já teve os ${authorizedNow} almoços servidos.`,
            };
        }

        return {
            ...detail,
            valid: true,
            reason: REASON.OK,
            message: remaining === 1
                ? 'Cupom válido. Libera 1 almoço.'
                : `Cupom válido. Restam ${remaining} de ${authorizedNow} almoços.`,
        };
    }

    /**
     * Serve uma refeição contra o cupom.
     *
     * Reconfere tudo antes de gravar em vez de confiar no `validateCoupon` que a
     * tela chamou. Entre a conferência e o toque no botão passam segundos, e é
     * nesses segundos que o outro terminal serve a última refeição do cupom.
     *
     * @param {{qr: string, siteCode: string, mealType?: number, clientUuid: string}} input
     * @param {{userId: ?number}} actor
     */
    async redeemCoupon({ qr, siteCode, mealType, clientUuid }, actor = {}) {
        const uuid = trimOrNull(clientUuid);

        if (!uuid || !UUID_PATTERN.test(uuid)) {
            throw new BadRequestError(
                'client_uuid é obrigatório: é o que impede o reenvio de duplicar a refeição.',
            );
        }

        const type = mealType === undefined || mealType === null
            ? MEAL_TYPE.LUNCH
            : Number(mealType);

        if (!MEAL_TYPES.includes(type)) {
            throw new BadRequestError(`meal_type inválido: use ${MEAL_TYPES.join(', ')}.`);
        }

        const check = await this.validateCoupon({ qr, siteCode });

        if (!check.valid) {
            /* 409 e não 400: a requisição está correta, o cupom é que não serve.
               A tela distingue pela CAUSA, não pelo status.

               A causa viaja em `code` e não em `details` porque o
               `error.middleware` só serializa `message`, `code` e `fields` —
               `details` fica no servidor de propósito, já que às vezes carrega o
               erro original inteiro. Sem isto o cliente teria que casar em texto
               de mensagem, que muda a cada revisão de copy. */
            throw new AppError(check.message, 409, {
                code: `COUPON_${check.reason.toUpperCase().replace(/-/g, '_')}`,
                details: { reason: check.reason, nfe_key: check.nfe_key },
            });
        }

        const serviceDate = toCivilDate(this.now());

        return this.repository.redeemCouponWithMealLog(
            {
                nfe_key: check.nfe_key,
                meals_authorized: check.meals_authorized,
                site_code: check.site_code,
                coupon_date: check.coupon_date,
                service_date: serviceDate,
                seqproduto: check.seqproduto,
                tp_emis: check.tp_emis,
                operator_user_id: actor.userId ?? null,
            },
            {
                diner_type: DINER_TYPE.COUPON,
                identified_by: IDENTIFIED_BY.COUPON,
                meal_type: type,
                site_code: check.site_code,
                service_date: serviceDate,
                client_uuid: uuid,
                operator_user_id: actor.userId ?? null,
            },
        );
    }

    /**
     * Os resgates já gravados, com recorte.
     *
     * ── Por que o recorte é obrigatório ─────────────────────────────────────
     *
     * Ou a chave do cupom, ou o par de datas. Não é formulário chato: a tabela
     * tem uma linha por refeição servida e só cresce, e os dois índices que
     * existem são (`nfe_key`) e (`service_date`, `site_code`). Consulta sem
     * nenhum dos dois é varredura da tabela inteira — mesma razão que já obriga
     * `date_from`/`date_to` nos relatórios.
     *
     * A chave tem precedência sobre as datas quando vêm as duas: quem procura
     * um cupom específico quer o histórico dele, não a interseção com o período
     * que sobrou na tela.
     *
     * @param {{nfeKey?: string, dateFrom?: string, dateTo?: string,
     *          siteCode?: string, limit?: number|string, offset?: number|string}} filters
     */
    async listCoupons(filters = {}) {
        const key = trimOrNull(filters.nfeKey);
        const from = trimOrNull(filters.dateFrom);
        const to = trimOrNull(filters.dateTo);
        const site = trimOrNull(filters.siteCode);

        if (key && !NFE_KEY_PATTERN.test(key)) {
            /* Só a chave nua. Aqui não passa QR: `readNfceQr` existe para o
               balcão, onde vale gastar o parse e o dígito verificador em cima do
               que a câmera leu. Esta rota é de conferência, e quem a chama já
               tem a chave — veio da resposta de `/coupons/validate` ou desta
               própria lista. */
            throw new BadRequestError('nfe_key tem que ter 44 dígitos, sem pontuação.');
        }

        if (!key) {
            if (!from || !to) {
                throw new BadRequestError(
                    'Informe nfe_key, ou o período com date_from e date_to (YYYY-MM-DD).',
                );
            }

            if (!DATE_PATTERN.test(from) || !DATE_PATTERN.test(to)) {
                throw new BadRequestError('Datas no formato YYYY-MM-DD.');
            }

            if (from > to) {
                throw new BadRequestError('date_from não pode ser depois de date_to.');
            }

            const spanDays =
                (Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / DAY_MS;

            if (spanDays > MAX_LIST_SPAN_DAYS) {
                throw new BadRequestError(
                    `O período máximo é de ${MAX_LIST_SPAN_DAYS} dias. Peça por partes.`,
                );
            }
        }

        if (site && !SITE_CODE_PATTERN.test(site)) {
            throw new BadRequestError('site_code tem que ter 4 dígitos (ex.: 0202).');
        }

        const limit = this._positiveInt(filters.limit, DEFAULT_LIST_LIMIT);
        const offset = this._positiveInt(filters.offset, 0, { allowZero: true });

        if (limit > MAX_LIST_LIMIT) {
            throw new BadRequestError(`limit máximo é ${MAX_LIST_LIMIT}.`);
        }

        const page = await this.repository.listCoupons({
            nfeKey: key,
            /* A chave manda: com ela, o período sai do caminho para o histórico
               do cupom aparecer inteiro. */
            dateFrom: key ? null : from,
            dateTo: key ? null : to,
            siteCode: site,
            limit,
            offset,
        });

        return {
            filters: {
                nfe_key: key,
                date_from: key ? null : from,
                date_to: key ? null : to,
                site_code: site,
                limit,
                offset,
            },
            total: page.total,
            count: page.rows.length,
            /* `has_more` pronto para a tela não recalcular — e para "acabou"
               significar a mesma coisa em todas elas. */
            has_more: offset + page.rows.length < page.total,
            rows: page.rows,
        };
    }

    /**
     * Estorna um resgate pelo id.
     *
     * ⚠️ **É exclusão de verdade, e leva a refeição junto.** Duas coisas somem:
     *   a linha de saldo (`meal_coupon`) e a refeição que ela gerou
     *   (`meal_log`). Não é zelo do adapter — é o que mantém as duas contas
     *   verdadeiras. Apagar só o saldo devolveria o cupom para uso enquanto o
     *   almoço continua contado no relatório do dia: o mesmo prato contado duas
     *   vezes, e pago por ninguém.
     *
     * Não existe `is_active = 0` aqui, ao contrário do `diner_group`. O saldo do
     * cupom é contado por LINHA e a unicidade é (`nfe_key`, `seq`) — linha
     * inativa continuaria segurando a vaga, que é exatamente o que o estorno
     * precisa devolver.
     *
     * Por isso a rota é de `MEAL_MANAGE` e não de `MEAL_SERVE`: servir se
     * desfaz, apagar histórico não.
     *
     * @param {number|string} id
     * @param {{userId: ?number}} actor
     */
    async deleteCoupon(id, actor = {}) {
        const couponId = this._positiveInt(id, null);

        if (!couponId) {
            throw new BadRequestError('id do resgate tem que ser um número inteiro positivo.');
        }

        const result = await this.repository.deleteCouponById(couponId);

        if (!result) {
            /* 404 e não 204: a tela precisa distinguir "apaguei" de "já não
               estava lá" — duas pessoas no mesmo relatório é caso real, e a
               segunda tem que ver a lista mudar, não um sucesso silencioso. */
            throw new AppError('Resgate de cupom não encontrado.', 404, {
                code: 'COUPON_NOT_FOUND',
            });
        }

        /* Único rastro que sobra: as linhas foram embora e o módulo não tem
           tabela de auditoria. Quem apagou, o quê, e quando. */
        console.warn('[meal-coupon] estorno', {
            coupon_id: result.coupon.id,
            nfe_key: result.coupon.nfe_key,
            seq: result.coupon.seq,
            meal_log_id: result.coupon.meal_log_id,
            meal_log_deleted: result.meal_log_deleted,
            by_user_id: actor.userId ?? null,
            at: this.now().toISOString(),
        });

        return {
            deleted: true,
            coupon: result.coupon,
            meal_log_deleted: result.meal_log_deleted,
            message: result.meal_log_deleted
                ? 'Resgate excluído. A refeição correspondente também foi removida.'
                : 'Resgate excluído.',
        };
    }

    /**
     * Inteiro vindo de query string, com padrão.
     *
     * Valor inválido cai no padrão em vez de recusar a requisição: `limit=abc`
     * não é ataque nem engano que mude o resultado, e recusar deixaria a tela
     * sem lista por causa de um campo que ela nem mostra.
     * @private
     */
    _positiveInt(value, fallback, { allowZero = false } = {}) {
        if (value === undefined || value === null || value === '') return fallback;

        const parsed = Number(value);

        if (!Number.isInteger(parsed)) return fallback;
        if (parsed < 0 || (!allowZero && parsed === 0)) return fallback;

        return parsed;
    }

    /** @private */
    _refuse(reason, message, extra = {}) {
        return { valid: false, reason, message, ...extra };
    }
}

module.exports = {
    MealCouponUseCases,
    REASON,
    MEAL_SEQPRODUTO,
    DEFAULT_MEAL_SEQPRODUTO,
    ENFORCE_DATE,
    LOOKBACK_DAYS,
    MAX_LIST_SPAN_DAYS,
    DEFAULT_LIST_LIMIT,
    MAX_LIST_LIMIT,
    mealsFromQuantity,
};
