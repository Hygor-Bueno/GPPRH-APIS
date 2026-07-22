// // notifyUserLogin.js
// const { eventBus } = require("../eventBus");

// function notifyUserLogin(user) {
//   eventBus.emit(
//     "user-logged-in",
//     {
//       message: `${user.name} acabou de entrar`,
//       userId: user.id,
//       time: new Date().toISOString(), // 🔥 melhor prática
//     },
//     {
//       excludeUserId: user.id,
//     }
//   );
// }

const axios = require("axios");

async function notifyUserLogin(user) {
  await axios.post("http://localhost:4001/ws/emit-event", {
    event: "user-logged-in",
    payload: {
      userId:   user.id,
      name:     user.nickname ?? user.name ?? null,
      message:  `${user.nickname ?? user.name} acabou de entrar`,
      time:     new Date().toISOString(),
    },
    options: {
      excludeUserId: user.id,
    },
  });
}

module.exports = { notifyUserLogin };