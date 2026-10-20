/**
 * @fileoverview Que tipo de identificador o relógio gravou no campo "CPF".
 *
 * Puro.
 *
 * ─── O campo de 12 posições não é só CPF ─────────────────────────────────────
 * A Portaria 671 chama o campo do tipo 3 de CPF, mas ESTE relógio guarda CPF
 * ou PIS/NIS — boa parte do cadastro foi importada em 05/06/2026 por PIS.
 * Medido no AFD integral de 08/10/2026, 1.411 identificadores:
 *
 *   959 passam só no dígito de CPF
 *   307 passam só no dígito de PIS   (32 deles batem ponto hoje)
 *   120 passam nos dois
 *    25 não passam em nenhum          (só 2 com marcação: `12345678912`, `27685431835`)
 *
 * Por isso a análise exclui só o `invalido`. Excluir "CPF inválido", como o
 * desenho original sugeria, tiraria 32 pessoas reais da tela.
 *
 * O registro inválido FICA no espelho — filtrar na origem seria descartar uma
 * linha do AFD, que é registro fiscal.
 *
 * ⚠️ PIS não é encontrado no Protheus pela view atual (ela não expõe
 * `RA_PIS`); essas pessoas aparecem com o nome do cadastro do relógio (tipo 5)
 * e sem status de contrato. Ver `docs/cppp.md`, pontas soltas.
 *
 * O nome da coluna continua `cpf` (`cppp_afd_records.cpf`) porque é o nome do
 * campo no layout oficial.
 *
 * @module modules/global/domain/cppp/cpf.rules
 */

const IdentifierKind = Object.freeze({
    CPF: 'cpf',
    PIS: 'pis',
    // Passa nos dois dígitos. Tratado como CPF na busca do Protheus, que é a
    // única busca que existe.
    CPF_OU_PIS: 'cpf_ou_pis',
    INVALIDO: 'invalido',
});

const onlyDigits = (value) => String(value ?? '').replace(/\D/g, '');
const isRepeated = (digits) => /^(\d)\1{10}$/.test(digits);

/**
 * @param {string|null|undefined} cpf
 * @returns {boolean}
 */
function isValidCpf(cpf) {
    const digits = onlyDigits(cpf);
    if (digits.length !== 11 || isRepeated(digits)) return false;

    const checkDigit = (length) => {
        let sum = 0;
        for (let i = 0; i < length; i++) sum += Number(digits[i]) * (length + 1 - i);
        const rest = (sum * 10) % 11;
        return rest === 10 ? 0 : rest;
    };

    return checkDigit(9) === Number(digits[9]) && checkDigit(10) === Number(digits[10]);
}

/**
 * PIS/PASEP/NIS: pesos 3,2,9,8,7,6,5,4,3,2; dígito = 11 − (soma mod 11), e 0
 * quando dá 10 ou 11.
 *
 * @param {string|null|undefined} pis
 * @returns {boolean}
 */
function isValidPis(pis) {
    const digits = onlyDigits(pis);
    if (digits.length !== 11 || isRepeated(digits)) return false;

    const weights = [3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((total, weight, i) => total + Number(digits[i]) * weight, 0);
    const rest = 11 - (sum % 11);
    return (rest >= 10 ? 0 : rest) === Number(digits[10]);
}

/**
 * @param {string|null|undefined} identifier
 * @returns {string} um de `IdentifierKind`.
 */
function identifierKind(identifier) {
    const cpf = isValidCpf(identifier);
    const pis = isValidPis(identifier);
    if (cpf && pis) return IdentifierKind.CPF_OU_PIS;
    if (cpf) return IdentifierKind.CPF;
    if (pis) return IdentifierKind.PIS;
    return IdentifierKind.INVALIDO;
}

/** O identificador entra na análise e aceita ajuste? */
const isUsableIdentifier = (identifier) => identifierKind(identifier) !== IdentifierKind.INVALIDO;

module.exports = { IdentifierKind, isValidCpf, isValidPis, identifierKind, isUsableIdentifier };
