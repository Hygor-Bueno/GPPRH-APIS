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
      message: `${user.nickname} acabou de entrar`,
      userId: user.id,
      time: new Date().toISOString(),
    },
    options: {
      excludeUserId: user.id,
    },
  });
}

module.exports = { notifyUserLogin };