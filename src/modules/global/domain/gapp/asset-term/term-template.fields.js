/**
 * @fileoverview Catálogo dos campos dinâmicos dos moldes de termo de ativo.
 *
 * Fonte única: a tela de moldes busca este catálogo pela API (inserir campo e
 * prévia) e a geração do termo — próximo passo — usa as mesmas chaves para
 * preencher o documento. Mesma sintaxe do termo de referência (`@chave@`).
 *
 * `types` = tipos de ativo em que o grupo vale; sem `types`, vale para todos.
 *
 * @module modules/global/domain/gapp/asset-term/term-template.fields
 */

/** Tipos de ativo dos moldes — os mesmos do cadastro de ativo (vehicle / smartphone / sim / genérico). */
const ASSET_TYPES = [
    { value: 'generic', label: 'Ativo geral' },
    { value: 'vehicle', label: 'Veículo' },
    { value: 'smartphone', label: 'Smartphone' },
    { value: 'sim', label: 'Cartão SIM' },
];

const ASSET_TYPE_VALUES = ASSET_TYPES.map(type => type.value);

const FIELD_GROUPS = [
    {
        group: 'Colaborador',
        fields: [
            { key: 'nome', label: 'Nome do colaborador', sample: 'MARIA APARECIDA DA SILVA' },
            { key: 'matricula', label: 'Matrícula', sample: '002351' },
            { key: 'cpf', label: 'CPF', sample: '123.456.789-00' },
            { key: 'loja', label: 'Loja / filial', sample: '0202 - LOJA CENTRO' },
        ],
    },
    {
        group: 'Termo',
        fields: [
            { key: 'termo', label: 'Número do termo', sample: '125' },
            { key: 'data', label: 'Data de emissão', sample: '09/11/2026' },
        ],
    },
    {
        group: 'Ativo',
        fields: [
            { key: 'patrimonio', label: 'Patrimônio (código do ativo)', sample: '1042' },
            { key: 'marca', label: 'Marca', sample: 'SAMSUNG' },
            { key: 'modelo', label: 'Modelo', sample: 'GALAXY A15' },
            { key: 'classe', label: 'Classe do ativo', sample: 'TELEFONIA' },
            { key: 'valor', label: 'Valor do ativo (sem R$)', sample: '1.299,00' },
            { key: 'data_compra', label: 'Data da compra', sample: '15/10/2026' },
            { key: 'nota_fiscal', label: 'Nº da nota fiscal', sample: '000123456' },
        ],
    },
    {
        group: 'Smartphone',
        types: ['smartphone'],
        fields: [
            { key: 'imei', label: 'IMEI 1', sample: '350845555897085' },
            { key: 'imei_2', label: 'IMEI 2', sample: '350845555897093' },
            { key: 'serie', label: 'Número de série (S/N)', sample: 'R58W12ABCDE' },
            { key: 'numero', label: 'Número da linha', sample: '(11) 98888-7777' },
            { key: 'operadora', label: 'Operadora', sample: 'VIVO' },
        ],
    },
    {
        group: 'Cartão SIM',
        types: ['sim'],
        fields: [
            { key: 'numero', label: 'Número da linha', sample: '(11) 98888-7777' },
            { key: 'serie', label: 'Número de série do chip', sample: '8955 1100 2233 4455' },
            { key: 'operadora', label: 'Operadora', sample: 'VIVO' },
        ],
    },
    {
        group: 'Veículo',
        types: ['vehicle'],
        fields: [
            { key: 'placa', label: 'Placa', sample: 'ABC1D23' },
            { key: 'renavam', label: 'Renavam', sample: '01234567890' },
            { key: 'chassi', label: 'Chassi', sample: '9BWZZZ377VT004251' },
            { key: 'ano', label: 'Ano de fabricação', sample: '2024' },
            { key: 'ano_modelo', label: 'Ano do modelo', sample: '2025' },
            { key: 'cor', label: 'Cor', sample: 'BRANCO' },
            { key: 'combustivel', label: 'Combustível', sample: 'FLEX' },
        ],
    },
];

/** Mesmo padrão do termo de referência: `@nome@`, `@imei@`... */
const FIELD_PATTERN = /@([a-z0-9_]+)@/g;

/** Grupos de campos válidos para o tipo de ativo. */
function fieldGroupsFor(assetType) {
    return FIELD_GROUPS.filter(group => !group.types || group.types.includes(assetType));
}

/** Chaves usadas no conteúdo, sem repetição, na ordem em que aparecem. */
function extractFieldKeys(content = '') {
    return [...new Set([...String(content).matchAll(FIELD_PATTERN)].map(match => match[1]))];
}

/** Chaves usadas no conteúdo que não existem para o tipo de ativo. */
function unknownFieldKeys(content, assetType) {
    const allowed = new Set(fieldGroupsFor(assetType).flatMap(group => group.fields.map(field => field.key)));
    return extractFieldKeys(content).filter(key => !allowed.has(key));
}

module.exports = { ASSET_TYPES, ASSET_TYPE_VALUES, FIELD_GROUPS, fieldGroupsFor, extractFieldKeys, unknownFieldKeys };
