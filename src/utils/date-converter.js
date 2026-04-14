function toMysqlDatetime(date) {
    if (!date) return null;

    if (date instanceof Date) {
        return date.toISOString().slice(0, 23).replace('T', ' ');
    }

    if (typeof date === 'string') {
        return date.replace('T', ' ').replace('Z', '').slice(0, 23);
    }

    return null;
}

module.exports = { toMysqlDatetime };