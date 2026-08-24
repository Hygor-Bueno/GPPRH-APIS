const {
    validateMealLog,
    validateGroupRequiresHost,
} = require('../meal-log.rules');
const { DINER_TYPE, MEAL_TYPE, IDENTIFIED_BY } = require('../meal.enums');

const VALID_UUID = '3f1a7c9e-2b4d-4a6f-8c1e-9d0b5a7f3c21';

function employeeMeal(overrides = {}) {
    return {
        diner_type: DINER_TYPE.EMPLOYEE,
        company_code: '02',
        employee_id: '000123',
        branch_code: '0203',
        site_code: '0202',
        meal_type: MEAL_TYPE.LUNCH,
        identified_by: IDENTIFIED_BY.QR,
        client_uuid: VALID_UUID,
        ...overrides,
    };
}

function groupMeal(overrides = {}) {
    return {
        diner_type: DINER_TYPE.GROUP,
        diner_group_id: 7,
        site_code: '0202',
        meal_type: MEAL_TYPE.LUNCH,
        identified_by: IDENTIFIED_BY.BUTTON,
        client_uuid: VALID_UUID,
        ...overrides,
    };
}

describe('validateMealLog — colaborador', () => {
    it('aceita a chave completa de tres partes', () => {
        expect(validateMealLog(employeeMeal())).toEqual([]);
    });

    // A chave de 2 partes funcionaria nesta instalacao do Protheus por acidente
    // de numeracao das filiais. A regra existe para nao depender disso.
    it('recusa matricula sem empresa', () => {
        const errors = validateMealLog(employeeMeal({ company_code: undefined }));
        expect(errors.join(' ')).toMatch(/company_code é obrigatório/);
    });

    it('recusa matricula sem filial', () => {
        const errors = validateMealLog(employeeMeal({ branch_code: undefined }));
        expect(errors.join(' ')).toMatch(/branch_code .* é obrigatório/);
    });

    it('recusa colaborador com balde ao mesmo tempo', () => {
        const errors = validateMealLog(employeeMeal({ diner_group_id: 7 }));
        expect(errors.join(' ')).toMatch(/ou é colaborador, ou é balde/);
    });

    it('recusa identificacao por botao para colaborador', () => {
        const errors = validateMealLog(employeeMeal({ identified_by: IDENTIFIED_BY.BUTTON }));
        expect(errors.join(' ')).toMatch(/é do balde/);
    });

    it('aceita identificacao manual — o caminho alternativo ao rosto', () => {
        expect(validateMealLog(employeeMeal({ identified_by: IDENTIFIED_BY.MANUAL }))).toEqual([]);
    });
});

describe('validateMealLog — balde', () => {
    it('aceita o balde puro', () => {
        expect(validateMealLog(groupMeal())).toEqual([]);
    });

    it('recusa balde com matricula', () => {
        const errors = validateMealLog(groupMeal({ employee_id: '000123' }));
        expect(errors.join(' ')).toMatch(/employee_id não se aplica/);
    });

    it('recusa balde com empresa', () => {
        const errors = validateMealLog(groupMeal({ company_code: '02' }));
        expect(errors.join(' ')).toMatch(/company_code não se aplica/);
    });

    it('recusa balde sem id de grupo', () => {
        const errors = validateMealLog(groupMeal({ diner_group_id: undefined }));
        expect(errors.join(' ')).toMatch(/diner_group_id é obrigatório/);
    });

    it('exige identificacao por botao', () => {
        const errors = validateMealLog(groupMeal({ identified_by: IDENTIFIED_BY.QR }));
        expect(errors.join(' ')).toMatch(/sempre 4/);
    });
});

describe('validateMealLog — site_code', () => {
    // Existem duas filiais chamadas Interlagos: 0104 (Frugal) e 0202 (Peg Pese).
    it('recusa nome de loja', () => {
        const errors = validateMealLog(employeeMeal({ site_code: 'INTERLAGOS' }));
        expect(errors.join(' ')).toMatch(/duas filiais chamadas Interlagos/);
    });

    it('recusa filial com menos de 4 digitos', () => {
        const errors = validateMealLog(employeeMeal({ site_code: '202' }));
        expect(errors.join(' ')).toMatch(/4 dígitos/);
    });

    it('exige site_code', () => {
        const errors = validateMealLog(employeeMeal({ site_code: undefined }));
        expect(errors.join(' ')).toMatch(/site_code é obrigatório/);
    });
});

describe('validateMealLog — client_uuid', () => {
    it('exige o uuid, que e a trava da fila offline', () => {
        const errors = validateMealLog(employeeMeal({ client_uuid: undefined }));
        expect(errors.join(' ')).toMatch(/impede o reenvio de duplicar/);
    });

    it('recusa uuid malformado', () => {
        const errors = validateMealLog(employeeMeal({ client_uuid: 'abc123' }));
        expect(errors.join(' ')).toMatch(/tem que ser um UUID/);
    });
});

describe('validateMealLog — convidante (tudo ou nada)', () => {
    it('aceita as tres colunas host preenchidas', () => {
        const errors = validateMealLog(groupMeal({
            host_company_code: '02',
            host_employee_id: '000123',
            host_branch_code: '0203',
        }));
        expect(errors).toEqual([]);
    });

    it('recusa convidante pela metade', () => {
        const errors = validateMealLog(groupMeal({ host_employee_id: '000123' }));
        expect(errors.join(' ')).toMatch(/Convidante incompleto/);
        expect(errors.join(' ')).toMatch(/host_company_code/);
        expect(errors.join(' ')).toMatch(/host_branch_code/);
    });
});

describe('validateMealLog — dominios', () => {
    it('recusa meal_type fora do dominio', () => {
        const errors = validateMealLog(employeeMeal({ meal_type: 7 }));
        expect(errors.join(' ')).toMatch(/meal_type inválido/);
    });

    it('recusa diner_type fora do dominio', () => {
        const errors = validateMealLog(employeeMeal({ diner_type: 3 }));
        expect(errors.join(' ')).toMatch(/diner_type inválido/);
    });

    it('recusa match_score quando nao foi o rosto que identificou', () => {
        const errors = validateMealLog(employeeMeal({ match_score: 0.91 }));
        expect(errors.join(' ')).toMatch(/match_score só faz sentido/);
    });

    it('aceita match_score no caminho facial', () => {
        const errors = validateMealLog(employeeMeal({
            identified_by: IDENTIFIED_BY.FACIAL,
            match_score: 0.91,
        }));
        expect(errors).toEqual([]);
    });
});

describe('validateGroupRequiresHost', () => {
    const visitante = { id: 3, label: 'Visitante', requires_host: 1 };
    const aprendiz = { id: 1, label: 'Jovem Aprendiz', requires_host: 0 };

    it('exige o anfitriao quando a flag esta ligada', () => {
        const errors = validateGroupRequiresHost(visitante, {});
        expect(errors.join(' ')).toMatch(/exige o QR de quem convidou/);
        expect(errors.join(' ')).toMatch(/Visitante/);
    });

    it('libera quando o anfitriao veio', () => {
        expect(validateGroupRequiresHost(visitante, { host_employee_id: '000123' })).toEqual([]);
    });

    it('nao exige anfitriao para jovem aprendiz — e um toque so', () => {
        expect(validateGroupRequiresHost(aprendiz, {})).toEqual([]);
    });

    it('recusa grupo inexistente', () => {
        expect(validateGroupRequiresHost(null, {}).join(' ')).toMatch(/não encontrado/);
    });
});
