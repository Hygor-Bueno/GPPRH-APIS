module.exports = {
  apps: [

    {
      name: "api-gpprh",
      script: "./src/server.js",
      cwd: "/home/administrador/Documents/gpprh/api",

      exec_mode: "cluster",
      instances: 2,

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

      env: {
        NODE_ENV: "production"
      }
    }

  ]
};
