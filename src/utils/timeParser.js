/**
 * parseTime - converte strings como "30m", "3d", "2h" em milissegundos
 * aceita também número (ms)
 */
function parseTime(value) {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  const s = String(value).trim().toLowerCase();

  const match = s.match(/^(\d+)(ms|s|m|h|d)?$/);
  if (!match) return 0;
  const n = Number(match[1]);
  const unit = match[2] || 'ms';

  switch (unit) {
    case 'ms': return n;
    case 's': return n * 1000;
    case 'm': return n * 60 * 1000;
    case 'h': return n * 60 * 60 * 1000;
    case 'd': return n * 24 * 60 * 60 * 1000;
    default: return n;
  }
}

module.exports = { parseTime };
