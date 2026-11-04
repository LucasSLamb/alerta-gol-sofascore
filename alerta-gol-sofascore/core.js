// Regras puras (sem APIs do Chrome), para poderem ser testadas com Node.

// Só esportes em que cada mudança de placar é rara. Em esports o placar conta mapas
// vencidos, não rodadas. Em basquete cada ponto viraria uma notificação, então o alerta
// é por quarto (veja applyQuarters).
const SCORE_ALERT_SPORTS = new Set(["football", "futsal", "minifootball", "esports"]);
const QUARTER_SPORT = "basketball";
const REGULAR_QUARTERS = 4;

// Com o Chrome fechado, gols acumulam. Depois de tanto tempo sem ler, o placar vira a nova
// base em vez de disparar alertas atrasados.
const STALE_READ_SECONDS = 10 * 60;
// Duas abas do site podem regravar um placar antigo por instantes. Só uma queda que
// persiste conta como gol anulado.
const ANNULLED_CONFIRM_SECONDS = 3 * 60;
// Logo depois de carregar, o site ainda mostra placares antigos que tinha guardado.
// Nesse tempo a leitura só registra o placar, para gols antigos não virarem alerta.
const PAGE_SETTLE_SECONDS = 2 * 60;

export const isAlertSport = (sport) => SCORE_ALERT_SPORTS.has(sport) || sport === QUARTER_SPORT;

export function readScore(event) {
  const home = event.homeScore?.current;
  const away = event.awayScore?.current;
  if (Number.isInteger(home) && Number.isInteger(away)) return { home, away };
  // Antes do início o site costuma não ter placar nenhum.
  if (event.status?.type === "notstarted") return { home: 0, away: 0 };
  return null;
}

// Primeira leitura de um jogo só registra o placar: quem começa a acompanhar um jogo em
// andamento não deve receber alerta dos gols que já aconteceram.
export function compareScores(previous, current) {
  if (!previous || !current) return null;
  const homeDelta = current.home - previous.home;
  const awayDelta = current.away - previous.away;
  if (homeDelta > 0 || awayDelta > 0) {
    return { type: "goal", homeScored: homeDelta > 0, awayScored: awayDelta > 0 };
  }
  if (homeDelta < 0 || awayDelta < 0) return { type: "annulled" };
  return null;
}

function applyEvent(game, event, nowSeconds) {
  const updated = {
    ...game,
    id: event.id,
    sport: event.tournament?.category?.sport?.slug ?? game?.sport,
    home: event.homeTeam?.shortName ?? event.homeTeam?.name ?? game?.home ?? "Mandante",
    away: event.awayTeam?.shortName ?? event.awayTeam?.name ?? game?.away ?? "Visitante",
    tournament: event.tournament?.name ?? game?.tournament ?? "",
    slug: event.slug ?? game?.slug,
    customId: event.customId ?? game?.customId,
    start: event.startTimestamp ?? game?.start,
    statusType: event.status?.type ?? game?.statusType,
    statusText: event.status?.description ?? game?.statusText,
  };
  const score = readScore(event);
  if (!score) return { game: updated, change: null };

  const change = compareScores(game?.score, score);
  if (change?.type === "annulled") {
    const lowerSince = game.lowerSince ?? nowSeconds;
    if (nowSeconds - lowerSince < ANNULLED_CONFIRM_SECONDS) {
      return { game: { ...updated, lowerSince }, change: null };
    }
  }
  const { lowerSince: _cleared, ...confirmed } = updated;
  return { game: { ...confirmed, score }, change };
}

// Quantos quartos já terminaram. A pontuação de um quarto aparece quando ele começa, e o
// status antecipa o aviso nas pausas, sem esperar o quarto seguinte começar.
export function quartersDone(event) {
  const home = event.homeScore ?? {};
  if (Number.isInteger(home.overtime)) return REGULAR_QUARTERS;
  let started = 0;
  for (let n = 1; n <= REGULAR_QUARTERS; n++) {
    if (Number.isInteger(home[`period${n}`])) started = n;
  }
  const description = event.status?.description ?? "";
  if (/overtime/i.test(description)) return REGULAR_QUARTERS;
  if (/half.?time/i.test(description)) return Math.max(started, 2);
  if (/pause|break/i.test(description)) return started;
  return Math.max(started - 1, 0);
}

function pointsThrough(score, quarters) {
  let total = 0;
  for (let n = 1; n <= quarters; n++) {
    const points = score?.[`period${n}`];
    if (!Number.isInteger(points)) return score?.current ?? 0;
    total += points;
  }
  return total;
}

// O placar do jogo continua sendo guardado, mas só a virada de quarto e o fim geram alerta.
function applyQuarters(previous, event, nowSeconds) {
  const { game } = applyEvent(previous, event, nowSeconds);
  const done = quartersDone(event);
  const alreadyDone = previous?.quartersDone ?? 0;
  game.quartersDone = Math.max(alreadyDone, done);
  if (!previous) return { game, change: null };

  if (event.status?.type === "finished" && previous.statusType !== "finished") {
    return { game, change: { type: "final" } };
  }
  if (done <= alreadyDone) return { game, change: null };
  const score = { home: pointsThrough(event.homeScore, done), away: pointsThrough(event.awayScore, done) };
  return { game, change: { type: "quarter", quarter: done, score } };
}

// Transforma uma leitura do site na nova lista de jogos e nos alertas a disparar.
// Quem saiu da leitura sai da lista.
export function applySnapshot(games, events, lastReadAt, nowSeconds, pageAgeSeconds = Infinity) {
  const silent =
    !lastReadAt || nowSeconds - lastReadAt > STALE_READ_SECONDS || pageAgeSeconds < PAGE_SETTLE_SECONDS;
  const result = {};
  const alerts = [];
  for (const event of events) {
    const sport = event.tournament?.category?.sport?.slug;
    if (!isAlertSport(sport)) continue;
    const apply = sport === QUARTER_SPORT ? applyQuarters : applyEvent;
    const { game, change } = apply(games[event.id], event, nowSeconds);
    result[event.id] = game;
    if (change && !silent) alerts.push({ game, change });
  }
  return { games: result, alerts };
}

export function buildNotification(game, change) {
  const score = change.score ?? game.score;
  const line = `${game.home} ${score.home} x ${score.away} ${game.away}`;
  if (change.type === "quarter") {
    return { title: `🏀 Fim do ${change.quarter}º quarto`, message: line, contextMessage: game.tournament ?? "" };
  }
  if (change.type === "final") {
    return { title: "🏀 Fim de jogo", message: line, contextMessage: game.tournament ?? "" };
  }
  const esports = game.sport === "esports";
  if (change.type === "annulled") {
    const title = esports ? "🎮 Placar corrigido" : "🚫 Gol anulado";
    return { title, message: line, contextMessage: game.tournament ?? "" };
  }
  let scorer = "";
  if (change.homeScored !== change.awayScored) {
    scorer = change.homeScored ? game.home : game.away;
  }
  let title = scorer ? `⚽ GOL do ${scorer}!` : "⚽ GOL!";
  if (esports) title = scorer ? `🎮 ${scorer} venceu o mapa!` : "🎮 Mapa encerrado!";
  return {
    title,
    message: line,
    contextMessage: game.tournament ?? "",
  };
}

export function matchUrl(game) {
  const sport = game.sport ?? "football";
  if (!game.slug || !game.customId) return "https://www.sofascore.com/pt/";
  return `https://www.sofascore.com/pt/${sport}/match/${game.slug}/${game.customId}#id:${game.id}`;
}
