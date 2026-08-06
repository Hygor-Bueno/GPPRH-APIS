#!/bin/bash
#
# Registra CPU/memória/status/reinicializações de cada processo PM2 numa
# linha de log, com timestamp. Feito pra rodar via cron a cada 1-2 minutos,
# gerando um histórico passivo — sem precisar reagir na hora de um travamento.
#
# Uso manual: bash scripts/monitor-pm2-health.sh
# Uso via cron (a cada minuto):
#   * * * * * /home/administrador/Documents/gpprh/api/scripts/monitor-pm2-health.sh
#
# Pra investigar depois de um travamento:
#   tail -100 pm2-health.log
#   grep "api-gpprh" pm2-health.log | tail -60

LOGFILE="$(dirname "$0")/../pm2-health.log"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

pm2 jlist | node -e "
const data = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
for (const p of data) {
  const cpu = p.monit?.cpu ?? '?';
  const memMb = p.monit?.memory ? Math.round(p.monit.memory / 1024 / 1024) : '?';
  console.log(['$TIMESTAMP', p.name, p.pid, p.pm2_env.status, cpu + '%', memMb + 'MB', 'restarts=' + p.pm2_env.restart_time].join('\t'));
}
" >> "$LOGFILE"
