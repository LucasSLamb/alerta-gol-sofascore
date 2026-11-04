import { matchUrl, scoreText } from "./core.js";

const $ = (id) => document.getElementById(id);

const STATUS_ORDER = { inprogress: 0, notstarted: 1 };

function statusLine(game) {
  switch (game.statusType) {
    case "inprogress":
      return "Ao vivo";
    case "notstarted":
    case undefined:
      if (!game.start) return "Aguardando";
      return new Date(game.start * 1000).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    case "finished":
      return "Encerrado";
    case "canceled":
      return "Cancelado";
    case "postponed":
      return "Adiado";
    default:
      return game.statusText ?? "";
  }
}

function renderGame(game) {
  const li = document.createElement("li");
  const link = document.createElement("a");
  link.href = matchUrl(game);
  link.target = "_blank";

  const teams = document.createElement("span");
  teams.className = "teams";
  teams.textContent = `${game.home} x ${game.away}`;

  const score = document.createElement("span");
  score.className = "score";
  score.textContent = game.statusType !== "notstarted" ? scoreText(game) : "";

  const status = document.createElement("span");
  status.className = game.statusType === "inprogress" ? "status live" : "status";
  status.textContent = statusLine(game);

  link.append(teams, score, status);
  li.append(link);
  return li;
}

function render({ games = {}, paused = false, lastReadAt, lastError, tabMissing, blockedUntil = 0 }) {
  $("pause").textContent = paused ? "▶ Retomar alertas" : "⏸ Pausar alertas";

  const list = Object.values(games).sort(
    (a, b) =>
      (STATUS_ORDER[a.statusType] ?? 2) - (STATUS_ORDER[b.statusType] ?? 2) || (a.start ?? 0) - (b.start ?? 0)
  );
  if (list.length) {
    $("games").replaceChildren(...list.map(renderGame));
  } else {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = lastReadAt
      ? "Nenhum jogo dos seus favoritos nas próximas 24 horas."
      : "Abra ou recarregue a aba do Sofascore para carregar seus favoritos.";
    $("games").replaceChildren(empty);
  }

  if (paused) $("error").textContent = "Alertas pausados.";
  else if (tabMissing) $("error").textContent = "Alertas parados: deixe uma aba do Sofascore aberta. Se já houver uma, recarregue-a.";
  else if (blockedUntil * 1000 > Date.now()) {
    const until = new Date(blockedUntil * 1000).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    $("error").textContent = `O Sofascore recusou as consultas: avisos de pênalti marcado pausados até ${until}. Os demais continuam.`;
  } else $("error").textContent = lastError ?? "";
  $("info").textContent = lastReadAt ? `Lido às ${new Date(lastReadAt * 1000).toLocaleTimeString("pt-BR")}` : "";
}

const KEYS = ["games", "paused", "lastReadAt", "lastError", "tabMissing", "blockedUntil"];
const refresh = async () => render(await chrome.storage.local.get(KEYS));

$("pause").addEventListener("click", async () => {
  const { paused = false } = await chrome.storage.local.get("paused");
  chrome.runtime.sendMessage({ type: "setPaused", paused: !paused });
});
$("test").addEventListener("click", () => chrome.runtime.sendMessage({ type: "testNotification" }));
chrome.storage.onChanged.addListener(refresh);

refresh();
chrome.runtime.sendMessage({ type: "pollNow" });
