import { applySnapshot, buildNotification, matchUrl } from "./core.js";

const SITE = "https://www.sofascore.com";
const ALARM = "poll";
const ALARM_MINUTES = 0.5; // mínimo permitido pelo Chrome

const now = () => Math.floor(Date.now() / 1000);

// Alarmes e popup podem disparar juntos. Enfileirar evita que um sobrescreva o estado
// do outro e gere notificação repetida.
let queue = Promise.resolve();
const enqueue = (task) => {
  const run = queue.then(task, task);
  queue = run.catch((err) => console.error("[Alerta de Gol]", err));
  return run;
};

async function readFromTabs() {
  const tabs = await chrome.tabs.query({ url: `${SITE}/*`, discarded: false });
  for (const tab of tabs) {
    if (tab.url?.includes("/captcha")) continue;
    try {
      const reply = await chrome.tabs.sendMessage(tab.id, { type: "read" });
      if (reply) return reply;
    } catch {
      // aba sem o content script (por exemplo, aberta antes de recarregar a extensão)
    }
  }
  return null;
}

function notify({ game, change }) {
  // O id identifica o lance: se o mesmo gol ou quarto for detectado duas vezes, a notificação é substituída.
  const detail = change.quarter ?? `${game.score.home}-${game.score.away}`;
  return chrome.notifications.create(`${change.type}|${game.id}|${detail}`, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    priority: 2,
    ...buildNotification(game, change),
  });
}

async function processEvents({ events, pageAgeSeconds }) {
  const { games = {}, lastReadAt } = await chrome.storage.local.get(["games", "lastReadAt"]);
  const result = applySnapshot(games, events, lastReadAt, now(), pageAgeSeconds);
  await chrome.storage.local.set({ games: result.games, lastReadAt: now(), tabMissing: false, lastError: null });
  await Promise.all(result.alerts.map(notify));
}

function poll() {
  return enqueue(async () => {
    const { paused = false } = await chrome.storage.local.get("paused");
    await chrome.action.setBadgeText({ text: paused ? "II" : "" });
    if (paused) {
      await chrome.storage.local.set({ tabMissing: false });
      return;
    }

    const reply = await readFromTabs();
    if (!reply) {
      await chrome.storage.local.set({ tabMissing: true });
    } else if (reply.error) {
      await chrome.storage.local.set({ tabMissing: false, lastError: reply.error });
    } else {
      await processEvents(reply);
    }
  });
}

function setPaused(paused) {
  // Ao retomar, a primeira leitura só registra os placares: gols da pausa não geram alerta.
  return enqueue(() => chrome.storage.local.set(paused ? { paused } : { paused, lastReadAt: null })).then(poll);
}

function ensureAlarm() {
  return chrome.alarms.create(ALARM, { periodInMinutes: ALARM_MINUTES });
}

chrome.runtime.onInstalled.addListener(ensureAlarm);
chrome.runtime.onStartup.addListener(ensureAlarm);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) poll();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "pollNow") {
    poll().finally(() => sendResponse({ ok: true }));
    return true;
  }
  if (message?.type === "setPaused") {
    setPaused(message.paused).finally(() => sendResponse({ ok: true }));
    return true;
  }
  if (message?.type === "testNotification") {
    chrome.notifications
      .create(`test|${Date.now()}`, {
        type: "basic",
        iconUrl: "icons/icon128.png",
        priority: 2,
        title: "⚽ GOL do Time A! (teste)",
        message: "Time A 1 x 0 Time B",
        contextMessage: "Notificação de teste",
      })
      .finally(() => sendResponse({ ok: true }));
    return true;
  }
});

chrome.notifications.onClicked.addListener(async (notificationId) => {
  chrome.notifications.clear(notificationId);
  const [, id] = notificationId.split("|");
  const { games = {} } = await chrome.storage.local.get("games");
  if (games[id]) chrome.tabs.create({ url: matchUrl(games[id]) });
});
