/**
 * @fileoverview Instâncias únicas dos casos de uso do CPPP no processo da API.
 *
 * Fogem da convenção "cada controller instancia o seu" pelo mesmo motivo do
 * `miepp-services`: o lançamento de ajuste devolve o dia recalculado, então
 * `CpppAdjustmentUseCases` depende de `CpppInconsistencyUseCases` — e as duas
 * precisam ler os mesmos repositórios com a mesma configuração.
 *
 * O cliente do relógio está aqui SÓ para o teste de conexão da tela de
 * cadastro (login + logout, timeout curto). A coleta continua sendo do worker
 * (`workers/cppp-afd-collector.js`): a API não tem rota que execute coleta,
 * só que a enfileire.
 *
 * @module modules/global/infrastructure/cppp/cppp-services
 */

const { cpppConfig } = require('../../../../config/cppp');

const { CpppCollectUseCases } = require('../../application/cppp/collect/cppp-collect.use-cases');
const { CpppInconsistencyUseCases } = require('../../application/cppp/inconsistency/cppp-inconsistency.use-cases');
const { CpppAdjustmentUseCases } = require('../../application/cppp/adjustment/cppp-adjustment.use-cases');

const { MysqlCpppAfdRepository } = require('./mysql-cppp-afd.repository');
const { MysqlCpppCollectRunRepository, MysqlCpppDeviceRepository } = require('./mysql-cppp-collect.repository');
const { MysqlCpppAdjustmentRepository } = require('./mysql-cppp-adjustment.repository');
const { FsCpppRawAfdStorage } = require('./fs-cppp-raw-afd.storage');
const { CpppAttachmentStorage } = require('./cppp-attachment.storage');
const { SqlServerCpppEmployeeDirectory } = require('./sqlserver-cppp-employee.directory');
const { ControlIdClockClient } = require('./controlid-clock.client');

const afd = new MysqlCpppAfdRepository();
const runs = new MysqlCpppCollectRunRepository();
const devices = new MysqlCpppDeviceRepository();
const adjustments = new MysqlCpppAdjustmentRepository();

const collectUseCases = new CpppCollectUseCases({
    runs,
    devices,
    afd,
    clock: new ControlIdClockClient({ config: cpppConfig }),
    rawStorage: new FsCpppRawAfdStorage({ root: cpppConfig.storageRoot }),
    config: cpppConfig,
});

const inconsistencyUseCases = new CpppInconsistencyUseCases({
    afd,
    adjustments,
    runs,
    directory: new SqlServerCpppEmployeeDirectory(),
    config: cpppConfig,
});

const adjustmentUseCases = new CpppAdjustmentUseCases({
    adjustments,
    afd,
    attachments: new CpppAttachmentStorage(),
    inconsistency: inconsistencyUseCases,
    config: cpppConfig,
});

module.exports = { collectUseCases, inconsistencyUseCases, adjustmentUseCases };
