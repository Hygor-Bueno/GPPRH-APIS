const SQL_LIST_OPERATOR = `SELECT * FROM global.gapp_operator`;

const SQL_INSERT_OPERTATOR = `INSERT INTO global.gapp_operator (name) VALUES (?)`;

const SQL_UPDATE_OPERATOR = `UPDATE global.gapp_operator SET name = ? WHERE operator_id = ?`;

module.exports = {
    SQL_LIST_OPERATOR,
    SQL_INSERT_OPERTATOR,
    SQL_UPDATE_OPERATOR
}