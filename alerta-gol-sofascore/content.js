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

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "read") return;
    readEvents()
      .then(sendResponse)
      .catch((err) => sendResponse({ error: String(err) }));
    return true;
  });

  chrome.runtime.sendMessage({ type: "pollNow" }).catch(() => {});
})();
