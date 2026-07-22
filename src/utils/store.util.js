/**
 * Separa o valor composto "NomeLoja_N" em nome e número.
 * Ex.: "Interlagos_1" → { name: "Interlagos", number: 1 }
 *      "Bolonha"      → { name: "Bolonha",    number: null }
 *
 * @param {string|null} value
 * @returns {{ name: string|null, number: number|null }}
 */
function splitStore(value) {
    if (!value) return { name: null, number: null };
    const parts  = String(value).split('_');
    const last   = parts[parts.length - 1];
    const number = /^\d+$/.test(last) ? parseInt(last, 10) : null;
    const name   = number !== null ? parts.slice(0, -1).join('_') : value;
    return { name, number };
}

module.exports = { splitStore };
