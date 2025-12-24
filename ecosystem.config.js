module.exports = {
  apps: [
    {
      name: "api-gpprh",
      script: "./src/server.js",
      cwd: "/home/administrador/Documents/gpprh/api",

      env: {
        NODE_ENV: "production",
      },

      exec_mode: "cluster",
      instances: 3, // 3 cores para API

      node_args: "--max-old-space-size=512",
      max_memory_restart: "800M",

      watch: false,
      autorestart: true,

      max_restarts: 10,
      restart_delay: 5000,

      nice: 0, // prioridade normal
    },
  ],
};
