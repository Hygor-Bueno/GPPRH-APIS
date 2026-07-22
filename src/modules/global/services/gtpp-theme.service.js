/**
 * @fileoverview Serviço de temas GTPP.
 * @module modules/global/services/gtpp-theme.service
 */

'use strict';

const { poolGlobal } = require('../../../config/mysql');
const { AppError }   = require('../../../errors/app.error');
const {
    SQL_GET_ALL_THEMES,
    SQL_GET_THEME_BY_ID,
    SQL_GET_THEMES_BY_USER,
    SQL_INSERT_THEME,
    SQL_UPDATE_THEME,
    SQL_DELETE_THEME,
} = require('../repositories/mysql/gtpp.repository');

/**
 * Lista todos os temas cadastrados no sistema.
 */
async function getAllThemes() {
    try {
        const [rows] = await poolGlobal.execute(SQL_GET_ALL_THEMES);
        return rows;
    } catch (err) {
        throw new AppError('Erro ao buscar temas.', 500, err.code, err);
    }
}

/**
 * Retorna um tema pelo ID.
 * @param {number} themeId
 */
async function getThemeById(themeId) {
    try {
        const [[row]] = await poolGlobal.execute(SQL_GET_THEME_BY_ID, [themeId]);
        if (!row) throw new AppError('Tema não encontrado.', 404);
        return row;
    } catch (err) {
        if (err instanceof AppError) throw err;
        throw new AppError('Erro ao buscar tema.', 500, err.code, err);
    }
}

/**
 * Lista os temas de um usuário específico.
 * @param {number} userId
 */
async function getThemesByUser(userId) {
    try {
        const [rows] = await poolGlobal.execute(SQL_GET_THEMES_BY_USER, [userId]);
        return rows;
    } catch (err) {
        throw new AppError('Erro ao buscar temas do usuário.', 500, err.code, err);
    }
}

/**
 * Cria um novo tema.
 * @param {number} userId
 * @param {string} description
 */
async function createTheme(userId, description) {
    if (!description || !description.trim()) throw new AppError('A descrição é obrigatória.', 400);
    try {
        const [result] = await poolGlobal.execute(SQL_INSERT_THEME, [description.trim(), userId]);
        return { themeId: result.insertId };
    } catch (err) {
        throw new AppError('Erro ao criar tema.', 500, err.code, err);
    }
}

/**
 * Atualiza a descrição de um tema.
 * @param {number} themeId
 * @param {string} description
 */
async function updateTheme(themeId, description) {
    if (!description || !description.trim()) throw new AppError('A descrição é obrigatória.', 400);
    try {
        const [result] = await poolGlobal.execute(SQL_UPDATE_THEME, [description.trim(), themeId]);
        if (result.affectedRows === 0) throw new AppError('Tema não encontrado.', 404);
    } catch (err) {
        if (err instanceof AppError) throw err;
        throw new AppError('Erro ao atualizar tema.', 500, err.code, err);
    }
}

/**
 * Remove um tema permanentemente.
 * @param {number} themeId
 */
async function deleteTheme(themeId) {
    try {
        const [result] = await poolGlobal.execute(SQL_DELETE_THEME, [themeId]);
        if (result.affectedRows === 0) throw new AppError('Tema não encontrado.', 404);
    } catch (err) {
        if (err instanceof AppError) throw err;
        throw new AppError('Erro ao excluir tema.', 500, err.code, err);
    }
}

module.exports = {
    getAllThemes,
    getThemeById,
    getThemesByUser,
    createTheme,
    updateTheme,
    deleteTheme,
};
