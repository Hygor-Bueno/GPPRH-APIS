module.exports = {
  apps: [

    {
      name: "api-gpprh",
      script: "./src/server.js",
      cwd: "/home/administrador/Documents/gpprh/api",

      exec_mode: "cluster",
      instances: 2,

      // Tempo que o PM2 espera (SIGINT) antes de forçar SIGKILL num restart/reload —
      // sem isso (default 1600ms) uma requisição em andamento (query lenta, PDF de
      // recibo) pode ser cortada no meio durante um deploy/restart.
      kill_timeout: 10000,

      // Rede de segurança: se um worker travar o event loop ou vazar memória
      // (ex.: pico do Puppeteer/Chromium usado na geração de recibo), o PM2
      // reinicia sozinho em vez de deixar a instância zumbi respondendo devagar
      // (ou não respondendo) indefinidamente. Servidor tem 31GB — 1GB por
      // instância (2 instâncias) deixa folga de sobra.
      max_memory_restart: "1G",

      // Evita restart em loop acelerado caso o processo esteja quebrando de
      // verdade (ex.: erro de configuração) — espaça as tentativas em vez de
      // martelar o servidor.
      exp_backoff_restart_delay: 100,

      env: {
        NODE_ENV: "production"
      }
    },

    {
      name: "ws-gpprh",
      script: "./src/websocket/websocketServer.js",
      cwd: "/home/administrador/Documents/gpprh/api",

      exec_mode: "fork",
      instances: 1,

      kill_timeout: 10000,
      max_memory_restart: "500M",
      exp_backoff_restart_delay: 100,

      env: {
        NODE_ENV: "production"
      }
    }

  ]
};
