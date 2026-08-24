/**
 * @fileoverview Domínio — códigos do controle de refeitório.
 *
 * Os valores espelham exatamente as constraints de `GIPP.dbo.meal_log`
 * (`CK_meal_log_diner`, `CK_meal_log_meal_type`, `CK_meal_log_identified_by`),
 * criadas em `refeitorio_etapa1_deploy.sql`. Trocar um número aqui sem trocar a
 * constraint lá produz um `INSERT` recusado pelo banco — o que é o
 * comportamento desejado, mas o lugar certo de mudar é nos dois.
 *
 * @module modules/meal/domain/meal.enums
 */

/** Quem comeu: uma matrícula do Protheus ou um balde sem matrícula. */
const DINER_TYPE = Object.freeze({
    EMPLOYEE: 1,
    GROUP: 2,
});

/** Qual refeição. */
const MEAL_TYPE = Object.freeze({
    LUNCH: 1,
    DINNER: 2,
    BREAKFAST: 3,
});

/**
 * Como a pessoa foi identificada.
 *
 * Não é estatística: é a prova, exigida pelo consentimento de LGPD, de que o
 * caminho alternativo ao rosto existe e é usado. `FACIAL` só aparece a partir
 * da etapa 6.
 */
const IDENTIFIED_BY = Object.freeze({
    QR: 1,
    MANUAL: 2,
    FACIAL: 3,
    BUTTON: 4,
});

const DINER_TYPES = Object.freeze(Object.values(DINER_TYPE));
const MEAL_TYPES = Object.freeze(Object.values(MEAL_TYPE));
const IDENTIFICATION_METHODS = Object.freeze(Object.values(IDENTIFIED_BY));

/**
 * Formas de identificação válidas para uma refeição de colaborador.
 * `BUTTON` é do balde, nunca de uma matrícula.
 */
const EMPLOYEE_IDENTIFICATION = Object.freeze([
    IDENTIFIED_BY.QR,
    IDENTIFIED_BY.MANUAL,
    IDENTIFIED_BY.FACIAL,
]);

module.exports = {
    DINER_TYPE,
    MEAL_TYPE,
    IDENTIFIED_BY,
    DINER_TYPES,
    MEAL_TYPES,
    IDENTIFICATION_METHODS,
    EMPLOYEE_IDENTIFICATION,
};
