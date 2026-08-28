/**
 * @fileoverview Controllers — venda de almoço por cupom fiscal.
 * @module modules/meal/controllers/meal-coupon.controller
 */

const { MealCouponUseCases } = require('../application/meal-coupon.use-cases');
const { MealCouponRepository } = require('../infrastructure/meal-coupon.repository');
const { respond } = require('../../../utils/respond');

const useCases = new MealCouponUseCases({
    repository: new MealCouponRepository(),
});

/** O operador sai do token. Nunca do corpo da requisição. */
function actorFrom(req) {
    return { userId: req.user?.id ?? null };
}

/**
 * O QR pode chegar como URL inteira ou como a chave nua.
 *
 * Aceitar os dois é o que evita que cada tela reimplemente o parse — e o parse
 * é justamente onde a tabela de posições errada que circulou levava a série e o
 * número para o lugar errado, sem erro nenhum aparecer.
 */
function qrFrom(req) {
    return req.body?.qr ?? req.body?.qr_url ?? req.body?.nfe_key ?? '';
}

function siteFrom(req) {
    return req.body?.site_code ?? req.body?.siteCode;
}

/**
 * `POST /gipp/meal/coupons/validate`
 *
 * Confere e mostra o que o cupom libera. **Não consome.**
 *
 * Sempre 200 quando a requisição está bem formada, mesmo com o cupom recusado —
 * o veredito vem em `valid` e `reason`. Mesma escolha de `/enroll/identify`:
 * cupom que não serve é caso normal de balcão, e transformar em 4xx faria a tela
 * tratar rotina como falha.
 */
async function postValidateCoupon(req, res) {
    const data = await useCases.validateCoupon({
        qr: qrFrom(req),
        siteCode: siteFrom(req),
    });

    return respond.ok(res, data);
}

/**
 * `POST /gipp/meal/coupons/redeem`
 *
 * Debita uma refeição do cupom e registra a refeição, numa transação só.
 *
 * Rota própria em vez de `POST /logs` com `diner_type = 3`, por três razões que
 * apontam para o mesmo lugar: o resgate precisa de transação, que o `/logs` não
 * tem; o cupom não pode entrar na fila offline de `/logs/sync`, onde o mesmo
 * cupom passaria duas vezes; e o caminho do `/logs` é crítico para o modo
 * offline do refeitório inteiro, que não vale a pena mexer para isto. Separando,
 * fica estruturalmente impossível um cupom cair na fila.
 */
async function postRedeemCoupon(req, res) {
    const data = await useCases.redeemCoupon(
        {
            qr: qrFrom(req),
            siteCode: siteFrom(req),
            mealType: req.body?.meal_type ?? req.body?.mealType,
            clientUuid: req.body?.client_uuid ?? req.body?.clientUuid,
        },
        actorFrom(req),
    );

    return respond.created(res, data);
}

module.exports = { postValidateCoupon, postRedeemCoupon };
