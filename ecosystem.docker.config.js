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

      // Gravar também em arquivo, em cima do bind mount `./logs:/app/logs` do
      // compose: sem isto o único caminho até um erro de produção é
      // `docker logs` na máquina do Docker, e quem depura pelo compartilhamento
      // de rede fica sem nada. Não conflita com o aviso acima — o destino aqui
      // é arquivo, não /dev/stdout, então `docker logs` continua igual.
      //
      // `merge_logs` junta as duas instâncias do cluster num arquivo só: com
      // ele desligado o PM2 sufixa o nome com o id do worker e a mesma
      // requisição pode cair em qualquer um dos dois arquivos.
      error_file: "/app/logs/api-gipp-enterprises-error.log",
      out_file: "/app/logs/api-gipp-enterprises-out.log",
      merge_logs: true,

      // Sem isto as linhas de `console.error` entram no arquivo sem hora, o que
      // inviabiliza cruzar o erro com o histórico de status do banco.
      log_date_format: "YYYY-MM-DD HH:mm:ss",

      env: {
        NODE_ENV: "production"
      }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Renderizador da grade de produtos do MIEPP
    // ─────────────────────────────────────────────────────────────────────────
    //
    // ⚠️ `instances: 1`, e não é economia. O app acima roda em cluster com 2
    //    instâncias; um laço de cadência ali rodaria DUAS vezes — duas consultas
    //    ao Consinco por ciclo, dois Chromium simultâneos e duas gravações
    //    concorrentes na mesma grade. É o mesmo motivo que pôs o
    //    transcodificador de vídeo em processo próprio. O worker ainda pega um
    //    `GET_LOCK` no MySQL como cinto extra, caso alguém mude este número.
    //
    // Fica no MESMO container do backend porque a imagem já traz o Chromium do
    // Puppeteer — o container `transcoder` só tem ffmpeg.
    {
      name: "miepp-grid-renderer",
      script: "./src/workers/miepp-grid-renderer.js",

      exec_mode: "fork",
      instances: 1,

      kill_timeout: 10000,
      exp_backoff_restart_delay: 100,

      // O pico é o Chromium, que abre e fecha a cada ciclo. Se bater neste
      // teto, é vazamento — e aí reiniciar é o comportamento certo.
      max_memory_restart: "700M",

      error_file: "/app/logs/miepp-grid-renderer-error.log",
      out_file: "/app/logs/miepp-grid-renderer-out.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss",

      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
