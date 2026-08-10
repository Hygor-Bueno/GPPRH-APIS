/**
 * @fileoverview Adapter Oracle — implementa `OracleProductRepositoryPort` (BPPP).
 *
 * Delega 1:1 para `repositories/oracle/bppp.oracle.queries.js`.
 *
 * @module modules/global/infrastructure/bppp/oracle-product.repository
 */

const { OracleProductRepositoryPort } = require('../../application/bppp/product/ports/oracle-product-repository.port');
const {
    findByPlu,
    findByEan,
    findByDescription,
    findByShopAndDepartment,
} = require('../../repositories/oracle/bppp.oracle.queries');

class OracleProductRepository extends OracleProductRepositoryPort {
    async findByPlu(shopId, plu) {
        return findByPlu(shopId, plu);
    }

    async findByEan(shopId, ean) {
        return findByEan(shopId, ean);
    }

    async findByDescription(shopId, pattern) {
        return findByDescription(shopId, pattern);
    }

    async findByShopAndDepartment(shopId, departmentId) {
        return findByShopAndDepartment(shopId, departmentId);
    }
}

module.exports = { OracleProductRepository };
