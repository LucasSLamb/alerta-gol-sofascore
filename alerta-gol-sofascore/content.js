// Lê os favoritos de onde o próprio site guarda (IndexedDB) quando o background pede.
(() => {
  const DB_NAME = "sofascoreIndexDB";
  const STORE = "keyvaluepairs";
  const KEY = "persist:favorites";

  function request(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function readRaw() {
    // Abrir um banco inexistente o criaria vazio e atrapalharia o site.
    const dbs = await indexedDB.databases();
    if (!dbs.some((d) => d.name === DB_NAME)) return null;
    const db = await request(indexedDB.open(DB_NAME));
    try {
      if (!db.objectStoreNames.contains(STORE)) return null;
      return await request(db.transaction(STORE).objectStore(STORE).get(KEY));
    } finally {
      db.close();
    }
  }

  async function readEvents() {
    const raw = await readRaw();
    const pageAgeSeconds = (Date.now() - performance.timeOrigin) / 1000;
    if (raw == null) return { events: [], pageAgeSeconds };
    return { events: AlertaGolFavorites.extractEvents(raw, Math.floor(Date.now() / 1000)), pageAgeSeconds };
  }

  // Busca os lances como a página de uma partida faz, um jogo por vez. Para na primeira
  // recusa do site: insistir só pioraria, e quem decide a pausa é o background.
  async function readIncidents(ids) {
    const results = {};
    for (const id of ids) {
      const res = await fetch(`/api/v1/event/${id}/incidents`, { headers: { Accept: "application/json" } });
      if (res.status === 403 || res.status === 429) return { results, blocked: true };
      // 404 é o que o site responde enquanto o jogo ainda não tem lances.
      if (res.status === 404) results[id] = [];
      else if (res.ok) results[id] = AlertaGolFavorites.trimIncidents((await res.json()).incidents);
    }
    return { results, blocked: false };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const task =
      message?.type === "read" ? readEvents() : message?.type === "incidents" ? readIncidents(message.ids) : null;
    if (!task) return;
    task.then(sendResponse).catch((err) => sendResponse({ error: String(err) }));
    return true;
  });

  chrome.runtime.sendMessage({ type: "pollNow" }).catch(() => {});
})();
