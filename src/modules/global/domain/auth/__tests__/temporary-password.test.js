const {
    generateTemporaryPassword,
    TEMP_PASSWORD_LENGTH,
    TEMP_ALPHABET,
} = require('../temporary-password');

describe('generateTemporaryPassword', () => {
    it('deve gerar senha com o comprimento definido', () => {
        expect(generateTemporaryPassword()).toHaveLength(TEMP_PASSWORD_LENGTH);
    });

    it('deve gerar uma senha diferente a cada chamada', () => {
        // É o que separa este desenho de uma senha padrão compartilhada:
        // vazar a senha de um usuário não compromete os demais.
        const geradas = new Set(Array.from({ length: 200 }, () => generateTemporaryPassword()));
        expect(geradas.size).toBe(200);
    });

    it('não deve usar caracteres ambíguos', () => {
        // 0/O/o, 1/I/l, 5/S/s e i geram erro de digitação quando a senha é lida
        // de um papel ou ditada por telefone.
        const amostra = Array.from({ length: 200 }, () => generateTemporaryPassword()).join('');
        expect(amostra).not.toMatch(/[0Oo1Il5Ssi]/);
    });

    it('deve usar todo o alfabeto ao longo de várias gerações', () => {
        // Se a geração ficasse presa a um subconjunto, a entropia real seria
        // menor do que o comprimento sugere.
        const amostra = Array.from({ length: 500 }, () => generateTemporaryPassword()).join('');
        expect(new Set(amostra).size).toBe(TEMP_ALPHABET.length);
    });
});
