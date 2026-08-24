// Config do PM2 que roda DENTRO do container do backend interno.
//
// Não confundir com o ecosystem.config.js da raiz, que é o do PM2 do host.
// Este arquivo só é lido pelo `pm2-runtime` dentro da imagem.
//
// ⚠️ O sufixo `.config.js` é OBRIGATÓRIO. O PM2 decide se um arquivo é
// configuração ou script pela extensão — só aceita `.json`, `.yaml`/`.yml` e
// `.config.js`. Com o nome `ecosystem.docker.js` ele executa o arquivo como
// script, o `module.exports` abaixo não faz nada, e o container sobe sem
// servidor algum escutando (o log mostra "starting in -fork mode-" e nenhuma
// linha do app).
//
// Por que PM2 dentro de container: o cluster mode do Node compartilha UMA porta
// entre os workers, e é assim que o Apache enxerga o backend hoje (um único
// upstream). Rodar 2 réplicas de container exigiria load balancer na frente e
// mudaria comportamento já validado em produção. O `pm2-runtime` existe
// exatamente para esse caso: roda em foreground, sem daemon, e o container
// morre se o app morrer.

module.exports = {
  apps: [
    {
      name: "api-gipp-enterprises",
      script: "./src/server.internal.js",

      exec_mode: "cluster",
      instances: 2,

      // Mesmos valores validados no ecosystem.config.js do host.
      kill_timeout: 10000,
      max_memory_restart: "1G",
      exp_backoff_restart_delay: 100,

      // NÃO redirecionar para /dev/stdout: o `pm2-runtime` em modo no-daemon já
      // encaminha o stdout/stderr dos workers para o stdout do container.
      // Redirecionar também para /dev/stdout duplica cada linha de log.

      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
