const pendingEvents = new Map(); // chave: userId ou "ALL"

function addPendingEvent(key, event) {
  if (!pendingEvents.has(key)) {
    pendingEvents.set(key, []);
  }

  pendingEvents.get(key).push(event);

  // 🔥 LOG AQUI (API)
  console.log("📦 [API] Estado da fila:", pendingEvents);
}

function getPendingEvents(key) {
  const events = pendingEvents.get(key) || [];

  // 🔥 LOG AQUI (WS)
  console.log("📦 [WS] Lendo fila:", events);

  return events;
}

function clearPendingEvents(key) {
  pendingEvents.delete(key);
}

module.exports = {
  addPendingEvent,
  getPendingEvents,
  clearPendingEvents,
};