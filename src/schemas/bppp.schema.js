/**
 * @fileoverview Schemas de validação — módulo BPPP (Busca de Preço).
 * @module schemas/bppp.schema
 */

/**
 * Query da busca de produto: `shop_id` + exatamente um critério.
 * A exclusividade entre os critérios é validada no caso de uso
 * (`BpppProductUseCases.searchProducts`), pois depende de regra de negócio.
 */
const searchProductQuerySchema = {
    shop_id:     { type: 'number', required: true, min: 1 },
    plu:         { type: 'number', min: 1 },
    id:          { type: 'number', min: 1 },   // alias legado de `plu`
    ean:         { type: 'string', minLength: 1,  maxLength: 20, pattern: /^\d+$/ },
    description: { type: 'string', minLength: 3,  maxLength: 60 },
};

module.exports = { searchProductQuerySchema };
