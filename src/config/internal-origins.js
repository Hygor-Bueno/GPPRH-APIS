/**
 * Origens aceitas pelo CORS dos dois processos do lado interno: a API
 * (`app.internal.js`) e o servidor de WebSocket (`websocket/websocketServer.js`).
 *
 * Ficam juntas porque o Apache do 10.10.10.99 publica as duas sob o mesmo
 * `https://gigpp.com.br:73/api/v1/` — `/api/v1/monitoring/*` vai para o
 * container do WebSocket (`/ws/*`), o resto para a API. Uma origem liberada só
 * em um dos lados aparece no navegador como erro de CORS sem status.
 */
module.exports = [
  // frontends internos servidos pelo Apache do 10.10.10.99 (portas 72/73)
  'http://10.10.10.99',
  'http://10.10.10.99:73',
  'http://gigpp.com.br:72',
  'http://gigpp.com.br:73',
  'https://gigpp.com.br:73',
  // desenvolvimento local
  'http://localhost:3000',
  'http://localhost:5173',
  'https://localhost:5173'
];
