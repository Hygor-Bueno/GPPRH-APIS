/**
 * @fileoverview Cálculo puro da lista de produção (visão mobile do log de vendas).
 *
 * Portado literal dos métodos privados de `EppLogSaleService` — lógica
 * replicada do PHP LogSaleMobile/qualityAdjust. Sem I/O: recebe os dados já
 * buscados (MySQL + Oracle) e só combina/consolida em memória.
 *
 * @module modules/global/domain/epp/log-sale/production-list.calculator
 */

/**
 * Para cada item de receita, multiplica QTDUNIDUTILIZADA pela quantidade
 * pedida do produto final correspondente.
 *
 * @param {object[]} pendingRows - Pedidos pendentes agregados por produto.
 * @param {object[]} receipeRows - Receitas técnicas Oracle dos produtos de menu.
 * @returns {object[]}
 */
function adjustReceipeQuantities(pendingRows, receipeRows) {
    const adjusted = [];
    for (const receipe of receipeRows) {
        const pending = pendingRows.find(r => r.epp_id_product == receipe.COD_PROD_FINAL);
        if (pending) {
            adjusted.push({
                ...receipe,
                QTDUNIDUTILIZADA: parseFloat(receipe.QTDUNIDUTILIZADA) * parseFloat(pending.quantity)
            });
        }
    }
    return adjusted;
}

/**
 * Consolida matérias-primas somando QTDUNIDUTILIZADA para o mesmo COD_PROD_MAT_PRIMA.
 *
 * @param {object[]} adjustedRows
 * @returns {object[]}
 */
function consolidateRawMaterials(adjustedRows) {
    const map = new Map();
    for (const row of adjustedRows) {
        const key = row.COD_PROD_MAT_PRIMA;
        if (!map.has(key)) {
            map.set(key, { ...row });
        } else {
            map.get(key).QTDUNIDUTILIZADA += row.QTDUNIDUTILIZADA;
        }
    }
    return Array.from(map.values());
}

/**
 * Constrói a lista final de produção:
 * - Produtos simples: usa quantidade do pedido + quantidade extra vinda de receitas de menus
 * - Matérias-primas de menus que não existem como produto simples no pedido: adiciona como novos itens
 *
 * @param {object[]} pendingRows
 * @param {object[]} consolidated
 * @param {Object<string, string>} descriptionMap
 * @returns {object[]}
 */
function buildFinalList(pendingRows, consolidated, descriptionMap) {
    const result = [];

    // Produtos simples (menu == 0)
    for (const item of pendingRows.filter(r => r.menu == 0)) {
        const rawMaterial = consolidated.find(r => r.COD_PROD_MAT_PRIMA == item.epp_id_product);
        const extraQty = rawMaterial ? parseFloat(rawMaterial.QTDUNIDUTILIZADA) : 0;
        result.push({
            epp_id_product: item.epp_id_product,
            quantity: parseFloat(item.quantity) + extraQty,
            menu: 0,
            description: descriptionMap[item.epp_id_product] || null,
        });
    }

    // Matérias-primas de menus não presentes nos produtos simples
    const simpleIds = pendingRows.filter(r => r.menu == 0).map(r => r.epp_id_product);
    for (const rm of consolidated) {
        if (!simpleIds.includes(rm.COD_PROD_MAT_PRIMA)) {
            result.push({
                epp_id_product: rm.COD_PROD_MAT_PRIMA,
                quantity: rm.QTDUNIDUTILIZADA,
                menu: 0,
                description: rm.DESCRICAO_MAT_PRIMA || null,
            });
        }
    }

    return result;
}

module.exports = { adjustReceipeQuantities, consolidateRawMaterials, buildFinalList };
