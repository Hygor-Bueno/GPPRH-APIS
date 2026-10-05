/**
 * @fileoverview Fragmento SQL para devolver DATETIME do MySQL como horário
 * local SEM fuso (`2026-10-02T11:40:26`).
 *
 * ⚠️  POR QUE ISTO EXISTE:
 * O MySQL grava DATETIME em horário local (-03). Desde 23/09/2026 o container
 * roda com `TZ: America/Sao_Paulo`, então o mysql2 entrega um `Date` correto e
 * o JSON sai em UTC real (`...T14:40:26.000Z` para 11:40 local).
 *
 * O front (e o app mobile) lê datas por `parseApiDate`, que tem a flag
 * `TIMESTAMP_Z_IS_ACTUALLY_LOCAL = true` e IGNORA o `Z`: o UTC real vira
 * 14:40 local e a tela fica 3h adiantada. A flag não pode simplesmente ser
 * desligada: os pools do SQL Server (GIPP/Protheus) usam `useUTC: true` do
 * `mssql` e continuam mandando hora local com `Z` falso.
 *
 * Sem fuso nenhum, a string é lida como hora local pelos dois caminhos que o
 * front usa — `parseApiDate` (com a flag em qualquer valor) e `new Date()`
 * (ISO sem offset é local pela especificação). Por isso NÃO usar `Z` aqui:
 * `Z` falso conserta quem usa `parseApiDate` e quebra quem usa `new Date()`
 * (o histórico do GTPP, por exemplo).
 *
 * Use só onde o consumidor exibe a data. Não resolver com `dateStrings: true`
 * no pool: `poolGlobal` é compartilhado, e o MIEPP depende de receber `Date`.
 * Colunas DATE e VARCHAR (ex.: `gt_message.date_time`) não precisam disto.
 *
 * @module modules/global/repositories/mysql/mysql-datetime.sql
 */

'use strict';

/**
 * `DATE_FORMAT(<column>, '%Y-%m-%dT%H:%i:%s') AS <alias>`
 *
 * @param {string} column  coluna qualificada, ex.: `r.created_at`
 * @param {string} [alias] nome na resposta; padrão é o nome da coluna
 * @returns {string}
 */
function localDateTime(column, alias = column.split('.').pop()) {
    return `DATE_FORMAT(${column}, '%Y-%m-%dT%H:%i:%s') AS ${alias}`;
}

module.exports = { localDateTime };
