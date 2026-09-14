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

/**
 * `GET /gipp/meal/coupons`
 *
 * O que já foi resgatado. É a tela de conferência do RH, e a origem dos ids que
 * o estorno consome.
 *
 * Filtros: `nfe_key` **ou** o par `date_from`/`date_to` — um dos dois é
 * obrigatório, e o motivo é o índice, não o formulário (ver `listCoupons`).
 * Opcionais: `site_code`, `limit` (padrão 100, teto 500) e `offset`.
 *
 * Aceita snake_case e camelCase pelo mesmo motivo das rotas de cupom já
 * existentes: o app e o painel web não escrevem no mesmo estilo, e fazer a
 * rota ceder é mais barato que padronizar duas bases de tela.
 */
async function getCoupons(req, res) {
    const q = req.query ?? {};

    const data = await useCases.listCoupons({
        nfeKey: q.nfe_key ?? q.nfeKey,
        dateFrom: q.date_from ?? q.dateFrom,
        dateTo: q.date_to ?? q.dateTo,
        siteCode: q.site_code ?? q.siteCode,
        limit: q.limit,
        offset: q.offset,
    });

    return respond.ok(res, data);
}

/**
 * `DELETE /gipp/meal/coupons/:id`
 *
 * Estorna um resgate: apaga a linha de `meal_coupon` E a refeição de `meal_log`
 * que ela gerou, numa transação só. O saldo do cupom volta a ficar disponível.
 *
 * Responde **200 com o que foi apagado**, não 204. O corpo é o que a tela usa
 * para confirmar em cima do fato — "cupom ...1934, 1 de 2 almoços, estornado" —
 * em vez de repetir o que estava na linha antes de sumir. `meal_log_deleted`
 * diz se a refeição foi junto.
 *
 * O operador do estorno sai do token, como em todo o módulo. Ele vai para o log
 * do servidor: as linhas somem e não há tabela de auditoria no refeitório.
 */
async function deleteCoupon(req, res) {
    const data = await useCases.deleteCoupon(req.params.id, actorFrom(req));
    return respond.ok(res, data);
}

module.exports = { postValidateCoupon, postRedeemCoupon, getCoupons, deleteCoupon };
