/**
 * @fileoverview Casos de uso — Temas GTPP.
 *
 * @module modules/global/application/gtpp/theme/gtpp-theme.use-cases
 */

const { AppError } = require('../../../../../errors/app.error');

class GtppThemeUseCases {
    /** @param {{repository: import('./ports/theme-repository.port').ThemeRepositoryPort}} deps */
    constructor({ repository }) {
        this.repository = repository;
    }

    async getAllThemes() {
        return this.repository.findAll();
    }

    /** @throws {AppError} 404 se não encontrado. */
    async getThemeById(themeId) {
        const theme = await this.repository.findById(themeId);
        if (!theme) throw new AppError('Tema não encontrado.', 404);
        return theme;
    }

    async getThemesByUser(userId) {
        return this.repository.findByUser(userId);
    }

    async createTheme(userId, description) {
        if (!description || !description.trim()) throw new AppError('A descrição é obrigatória.', 400);
        const { insertId } = await this.repository.insert(description.trim(), userId);
        return { themeId: insertId };
    }

    /** @throws {AppError} 404 se não encontrado. */
    async updateTheme(themeId, description) {
        if (!description || !description.trim()) throw new AppError('A descrição é obrigatória.', 400);
        const { updated } = await this.repository.update(themeId, description.trim());
        if (updated === 0) throw new AppError('Tema não encontrado.', 404);
    }

    /** @throws {AppError} 404 se não encontrado. */
    async deleteTheme(themeId) {
        const { deleted } = await this.repository.remove(themeId);
        if (deleted === 0) throw new AppError('Tema não encontrado.', 404);
    }
}

module.exports = { GtppThemeUseCases };
