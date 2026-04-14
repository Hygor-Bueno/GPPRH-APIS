// notifyUserLogin.js
const { eventBus } = require("../eventBus");

function sendMessagePrivate(user) {
    const { toUserId, text } = payload;

    eventBus.emit(
        "private-message",
        {
            text,
            from: ws.userId,
        },
        { toUserId }
    );
}

module.exports = { sendMessagePrivate };