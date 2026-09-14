/**
 * @fileoverview Testes de encadeamento de parâmetros do adapter de players.
 *
 * O `status` de um player é derivado em SQL (`PLAYER_STATUS_EXPRESSION`), e a
 * tolerância entra como o PRIMEIRO `?` da query — antes dos filtros. Um
 * deslocamento aqui não quebra nada visivelmente: a query roda, devolve linhas,
 * e o filtro passa a ler o parâmetro errado. Por isso a ordem é verificada
 * explicitamente, com o helper de banco trocado por mock.
 */

jest.mock('../meipp-mysql.helper', () => ({
    query: jest.fn(async () => []),
    execute: jest.fn(async () => ({ affectedRows: 1, insertId: 1 })),
    count: jest.fn(async () => 0),
    transaction: jest.fn(async (run) => run({ query: jest.fn(async () => [[]]) })),
    parseJsonColumn: (value) => value,
}));

const helper = require('../meipp-mysql.helper');
const { MysqlMeippPlayerRepository } = require('../mysql-meipp-player.repository');
const {
    SQL_LIST_PLAYERS,
    SQL_GET_PLAYER_BY_ID,
    SQL_GET_PLAYER_BY_UUID,
    SQL_COUNT_PLAYERS,
} = require('../../../repositories/mysql/meipp-player.queries');

const OFFLINE_MINUTES = 5;

/** @returns {MysqlMeippPlayerRepository} */
const makeRepository = () => new MysqlMeippPlayerRepository({ offlineAfterMinutes: OFFLINE_MINUTES });

beforeEach(() => jest.clearAllMocks());

describe('tolerância de offline como primeiro parâmetro', () => {
    it('list: [minutos, active, active, location, location, limit, offset]', async () => {
        await makeRepository().list({ active: 1, location_id: 3, limit: 50, offset: 0 });

        expect(helper.query).toHaveBeenCalledWith(
            SQL_LIST_PLAYERS,
            [OFFLINE_MINUTES, 1, 1, 3, 3, 50, 0]
        );
    });

    it('a contagem NÃO recebe os minutos — ela não seleciona status', async () => {
        await makeRepository().list({ active: 1, location_id: 3, limit: 50, offset: 0 });

        expect(helper.count).toHaveBeenCalledWith(SQL_COUNT_PLAYERS, [1, 1, 3, 3]);
    });

    it('findById: [minutos, id]', async () => {
        await makeRepository().findById(7);
        expect(helper.query).toHaveBeenCalledWith(SQL_GET_PLAYER_BY_ID, [OFFLINE_MINUTES, 7]);
    });

    it('findByUuid: [minutos, uuid]', async () => {
        await makeRepository().findByUuid('uuid-x');
        expect(helper.query).toHaveBeenCalledWith(SQL_GET_PLAYER_BY_UUID, [OFFLINE_MINUTES, 'uuid-x']);
    });
});

describe('quantidade de parâmetros bate com os placeholders da query', () => {
    // Guarda contra alguém acrescentar um `?` na query e esquecer o adapter (ou
    // o contrário) — o MySQL só reclamaria em produção.
    const countPlaceholders = (sql) => (sql.match(/\?/g) || []).length;

    it.each([
        ['SQL_LIST_PLAYERS', SQL_LIST_PLAYERS, 7],
        ['SQL_COUNT_PLAYERS', SQL_COUNT_PLAYERS, 4],
        ['SQL_GET_PLAYER_BY_ID', SQL_GET_PLAYER_BY_ID, 2],
        ['SQL_GET_PLAYER_BY_UUID', SQL_GET_PLAYER_BY_UUID, 2],
    ])('%s tem %i placeholders', (_name, sql, expected) => {
        expect(countPlaceholders(sql)).toBe(expected);
    });
});

describe('default da tolerância', () => {
    it('sem injeção, usa o valor do config/meipp', async () => {
        const { meippConfig } = require('../../../../../config/meipp');
        await new MysqlMeippPlayerRepository().findById(1);

        expect(helper.query).toHaveBeenCalledWith(
            SQL_GET_PLAYER_BY_ID,
            [meippConfig.offlineAfterMinutes, 1]
        );
    });
});
