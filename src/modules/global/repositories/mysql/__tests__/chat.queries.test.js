/**
 * @fileoverview Teste de regressão — formatação de data nas queries do chat.
 *
 * A coluna `cl_message.date` é DATETIME em horário local (-03). Se ela voltar
 * do driver como `Date`, o `JSON.stringify` da resposta converte para ISO em
 * UTC e uma mensagem das 09:00 chega ao cliente como `...T12:00:00.000Z`.
 * Essa correção já se perdeu uma vez em merge; o teste existe para travá-la.
 */

const {
    sqlGetConversations,
    sqlGetMessages,
    sqlGetMessageById
} = require('../chat.queries');

const DATE_FORMAT_PATTERN = /DATE_FORMAT\(\s*MAX\(m\.date\)\s*,\s*'%Y-%m-%d %H:%i:%s'\s*\)\s+AS\s+last_message_date/i;
const MESSAGE_DATE_PATTERN = /DATE_FORMAT\(\s*date\s*,\s*'%Y-%m-%d %H:%i:%s'\s*\)\s+AS\s+date/i;

describe('chat.queries — datas sem conversão de fuso', () => {
    it('sqlGetConversations formata last_message_date como string local', () => {
        expect(sqlGetConversations()).toMatch(DATE_FORMAT_PATTERN);
    });

    it('sqlGetMessages formata date como string local', () => {
        expect(sqlGetMessages(0)).toMatch(MESSAGE_DATE_PATTERN);
    });

    it('sqlGetMessageById formata date como string local', () => {
        expect(sqlGetMessageById()).toMatch(MESSAGE_DATE_PATTERN);
    });

    it('nenhuma query de leitura seleciona a coluna `date` crua', () => {
        const queries = [sqlGetConversations(), sqlGetMessages(0), sqlGetMessageById()];

        for (const sql of queries) {
            // `date` sozinho numa linha da lista do SELECT = coluna crua virando Date
            expect(sql).not.toMatch(/^\s*(m\.)?date\s*,?\s*$/m);
        }
    });
});
