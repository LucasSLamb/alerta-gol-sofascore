import test from "node:test";
import assert from "node:assert/strict";
import {
  applySnapshot,
  buildNotification,
  compareScores,
  matchUrl,
  quartersDone,
  readScore,
} from "../alerta-gol-sofascore/core.js";
import "../alerta-gol-sofascore/favorites.js";

const { extractEvents } = globalThis.AlertaGolFavorites;
const NOW = 1_800_000_000;
const RECENT = NOW - 30;

const event = (home, away, extra = {}) => ({
  id: 1,
  status: { type: "inprogress", description: "2nd half" },
  homeScore: { current: home },
  awayScore: { current: away },
  homeTeam: { shortName: "Barcelona" },
  awayTeam: { shortName: "Aston Villa" },
  tournament: { name: "UCL", category: { sport: { slug: "football" } } },
  ...extra,
});

const stored = (home, away, extra = {}) => ({ 1: { id: 1, home: "Barcelona", away: "Aston Villa", score: { home, away }, ...extra } });

test("primeira leitura de um jogo só registra o placar", () => {
  const { games, alerts } = applySnapshot({}, [event(2, 1)], RECENT, NOW);
  assert.deepEqual(games[1].score, { home: 2, away: 1 });
  assert.deepEqual(alerts, []);
});

test("gol do mandante e do visitante geram alerta", () => {
  const home = applySnapshot(stored(0, 0), [event(1, 0)], RECENT, NOW).alerts[0];
  assert.deepEqual(home.change, { type: "goal", homeScored: true, awayScored: false });
  const away = applySnapshot(stored(0, 0), [event(0, 1)], RECENT, NOW).alerts[0];
  assert.deepEqual(away.change, { type: "goal", homeScored: false, awayScored: true });
});

test("placar igual não gera alerta", () => {
  assert.deepEqual(applySnapshot(stored(1, 1), [event(1, 1)], RECENT, NOW).alerts, []);
});

test("gols acumulados com o Chrome fechado não disparam alertas atrasados", () => {
  const { games, alerts } = applySnapshot(stored(0, 0), [event(3, 0)], NOW - 3600, NOW);
  assert.deepEqual(alerts, []);
  assert.deepEqual(games[1].score, { home: 3, away: 0 });
});

test("queda passageira de placar não é gol anulado nem repete o gol depois", () => {
  const first = applySnapshot(stored(2, 0), [event(1, 0)], RECENT, NOW);
  assert.deepEqual(first.alerts, []);
  assert.deepEqual(first.games[1].score, { home: 2, away: 0 });

  const back = applySnapshot(first.games, [event(2, 0)], RECENT, NOW + 30);
  assert.deepEqual(back.alerts, []);
  assert.equal(back.games[1].lowerSince, undefined);
});

test("queda que persiste vira gol anulado, uma vez só", () => {
  const first = applySnapshot(stored(2, 0), [event(1, 0)], RECENT, NOW);
  const confirmed = applySnapshot(first.games, [event(1, 0)], NOW + 170, NOW + 200);
  assert.equal(confirmed.alerts[0].change.type, "annulled");
  assert.deepEqual(confirmed.games[1].score, { home: 1, away: 0 });
  assert.deepEqual(applySnapshot(confirmed.games, [event(1, 0)], NOW + 200, NOW + 230).alerts, []);
});

test("leitura sem placar em jogo ao vivo não apaga o placar conhecido", () => {
  const noScore = { id: 1, status: { type: "inprogress" }, tournament: { category: { sport: { slug: "football" } } } };
  const { games, alerts } = applySnapshot(stored(1, 0), [noScore], RECENT, NOW);
  assert.deepEqual(games[1].score, { home: 1, away: 0 });
  assert.deepEqual(alerts, []);
});

test("jogo sem placar antes do início vale 0 x 0, e o primeiro gol alerta", () => {
  assert.deepEqual(readScore({ status: { type: "notstarted" } }), { home: 0, away: 0 });
  const notStarted = { ...event(), homeScore: {}, awayScore: {}, status: { type: "notstarted" } };
  const { games } = applySnapshot({}, [notStarted], RECENT, NOW);
  assert.equal(applySnapshot(games, [event(1, 0)], RECENT, NOW).alerts.length, 1);
});

test("outros esportes ficam de fora, e quem saiu da leitura sai da lista", () => {
  const tennis = event(1, 0, { id: 2, tournament: { category: { sport: { slug: "tennis" } } } });
  const { games, alerts } = applySnapshot(stored(0, 0, { id: 1 }), [tennis], RECENT, NOW);
  assert.deepEqual(games, {});
  assert.deepEqual(alerts, []);
});

test("gol nos últimos instantes alerta mesmo se o jogo já consta como encerrado", () => {
  const finished = event(2, 0, { status: { type: "finished" } });
  assert.equal(applySnapshot(stored(1, 0), [finished], RECENT, NOW).alerts.length, 1);
});

test("texto da notificação", () => {
  const game = { home: "Barcelona", away: "Aston Villa", tournament: "UCL", score: { home: 1, away: 0 } };
  const goal = buildNotification(game, { type: "goal", homeScored: true, awayScored: false });
  assert.equal(goal.title, "⚽ GOL do Barcelona!");
  assert.equal(goal.message, "Barcelona 1 x 0 Aston Villa");
  assert.equal(goal.contextMessage, "UCL");
  assert.equal(buildNotification(game, { type: "goal", homeScored: true, awayScored: true }).title, "⚽ GOL!");
  assert.equal(buildNotification(game, { type: "annulled" }).title, "🚫 Gol anulado");
});

test("esports alerta por mapa vencido, com texto próprio, e ignora as rodadas", () => {
  const map = (home, away, period1) =>
    event(home, away, {
      homeTeam: { name: "FURIA", shortName: "FURIA" },
      awayTeam: { name: "Legacy" },
      homeScore: { current: home, period1 },
      awayScore: { current: away, period1: 3 },
      tournament: { name: "IEM", category: { sport: { slug: "esports" } } },
    });
  const { games } = applySnapshot({}, [map(0, 0, 5)], RECENT, NOW);
  assert.deepEqual(applySnapshot(games, [map(0, 0, 9)], RECENT, NOW).alerts, [], "rodada não alerta");

  const [alert] = applySnapshot(games, [map(1, 0, 13)], RECENT, NOW).alerts;
  const n = buildNotification(alert.game, alert.change);
  assert.equal(n.title, "🎮 FURIA venceu o mapa!");
  assert.equal(n.message, "FURIA 1 x 0 Legacy");
  assert.equal(buildNotification(alert.game, { type: "annulled" }).title, "🎮 Placar corrigido");
});

const basket = (homePeriods, awayPeriods, description = "1st quarter", type = "inprogress") => {
  const scores = (periods) => ({
    current: periods.reduce((a, b) => a + b, 0),
    ...Object.fromEntries(periods.map((p, i) => [`period${i + 1}`, p])),
  });
  return {
    id: 1,
    status: { type, description },
    homeScore: scores(homePeriods),
    awayScore: scores(awayPeriods),
    homeTeam: { shortName: "Lakers" },
    awayTeam: { shortName: "Heat" },
    tournament: { name: "NBA", category: { sport: { slug: "basketball" } } },
  };
};

test("basquete: cesta não alerta, virada de quarto alerta com o placar daquele momento", () => {
  const { games } = applySnapshot({}, [basket([20], [18])], RECENT, NOW);
  assert.deepEqual(applySnapshot(games, [basket([25], [18])], RECENT, NOW).alerts, [], "cesta não alerta");

  // Quarto 2 já começou e saíram 3 pontos, mas o aviso mostra o placar do fim do quarto 1.
  const next = applySnapshot(games, [basket([28, 3], [24, 0], "2nd quarter")], RECENT, NOW);
  const n = buildNotification(next.alerts[0].game, next.alerts[0].change);
  assert.equal(n.title, "🏀 Fim do 1º quarto");
  assert.equal(n.message, "Lakers 28 x 24 Heat");
  assert.equal(n.contextMessage, "NBA");

  assert.deepEqual(applySnapshot(next.games, [basket([28, 9], [24, 4], "2nd quarter")], RECENT, NOW).alerts, [], "não repete");
});

test("basquete: intervalo avisa na hora, e o início do 3º quarto não repete o aviso", () => {
  const { games } = applySnapshot({}, [basket([28, 20], [24, 22], "2nd quarter")], RECENT, NOW);
  const half = applySnapshot(games, [basket([28, 30], [24, 26], "Halftime")], RECENT, NOW);
  assert.equal(half.alerts[0].change.quarter, 2);
  assert.deepEqual(half.alerts[0].change.score, { home: 58, away: 50 });
  assert.deepEqual(applySnapshot(half.games, [basket([28, 30, 2], [24, 26, 0], "3rd quarter")], RECENT, NOW).alerts, []);
});

test("basquete: fim de jogo alerta uma vez com o placar final, inclusive com prorrogação", () => {
  const { games } = applySnapshot({}, [basket([30, 30, 30, 20], [30, 30, 30, 18], "4th quarter")], RECENT, NOW);
  const end = applySnapshot(games, [basket([30, 30, 30, 25], [30, 30, 30, 20], "Ended", "finished")], RECENT, NOW);
  assert.equal(end.alerts[0].change.type, "final");
  const n = buildNotification(end.alerts[0].game, end.alerts[0].change);
  assert.equal(n.title, "🏀 Fim de jogo");
  assert.equal(n.message, "Lakers 115 x 110 Heat");
  assert.deepEqual(applySnapshot(end.games, [basket([30, 30, 30, 25], [30, 30, 30, 20], "Ended", "finished")], RECENT, NOW).alerts, []);

  const overtime = basket([30, 30, 30, 20], [30, 30, 30, 20], "Overtime");
  overtime.homeScore.overtime = 4;
  assert.equal(quartersDone(overtime), 4);
});

test("basquete: abrir no meio do jogo ou depois de muito tempo não dispara alerta", () => {
  const { games, alerts } = applySnapshot({}, [basket([30, 30, 10], [28, 25, 8], "3rd quarter")], RECENT, NOW);
  assert.deepEqual(alerts, []);
  assert.equal(games[1].quartersDone, 2);
  assert.deepEqual(applySnapshot(games, [basket([30, 30, 25, 3], [28, 25, 20, 0], "4th quarter")], NOW - 3600, NOW).alerts, []);
});

test("compareScores sem placar anterior não gera mudança", () => {
  assert.equal(compareScores(null, { home: 1, away: 0 }), null);
});

test("logo depois de a página carregar, placar novo só vira base, sem alerta", () => {
  const { games, alerts } = applySnapshot(stored(0, 0), [event(3, 0)], RECENT, NOW, 30);
  assert.deepEqual(alerts, []);
  assert.deepEqual(games[1].score, { home: 3, away: 0 });
  assert.equal(applySnapshot(games, [event(4, 0)], RECENT, NOW, 150).alerts.length, 1);
});

test("link do jogo", () => {
  assert.equal(
    matchUrl({ id: 16938788, sport: "football", slug: "atletico-madrid-fc-bayern-munchen", customId: "xdbsLgb" }),
    "https://www.sofascore.com/pt/football/match/atletico-madrid-fc-bayern-munchen/xdbsLgb#id:16938788"
  );
  assert.equal(matchUrl({ id: 1 }), "https://www.sofascore.com/pt/");
});

const siteEvent = (id, homeId, leagueId, type = "inprogress", startTimestamp = NOW) => ({
  id,
  startTimestamp,
  status: { type },
  homeScore: { current: 0 },
  awayScore: { current: 0 },
  homeTeam: { id: homeId },
  awayTeam: { id: 99 },
  tournament: { uniqueTournament: { id: leagueId }, category: { sport: { slug: "football" } } },
  campoInutil: "x".repeat(10),
});

const record = (lists, events) =>
  JSON.stringify({ lists: JSON.stringify(lists), events: JSON.stringify(Object.fromEntries(events.map((e) => [e.id, e]))) });

test("leitura do site inclui jogo com estrela, de time e de liga, e ignora o resto", () => {
  const lists = { events: [1], teams: [20], favoriteTeams: [21], tournaments: [7], favoriteLeagues: [325] };
  const events = [
    siteEvent(1, 50, 50),
    siteEvent(2, 20, 50),
    siteEvent(3, 21, 50),
    siteEvent(4, 50, 7),
    siteEvent(5, 50, 325),
    siteEvent(6, 50, 50),
  ];
  const ids = extractEvents(record(lists, events), NOW).map((e) => e.id);
  assert.deepEqual(ids, [1, 2, 3, 4, 5]);
});

test("leitura do site limita a janela de tempo e devolve só os campos usados", () => {
  const lists = { tournaments: [7] };
  const events = [
    siteEvent(1, 50, 7, "notstarted", NOW + 3600),
    siteEvent(2, 50, 7, "notstarted", NOW + 3 * 86400),
    siteEvent(3, 50, 7, "finished", NOW - 3600),
    siteEvent(4, 50, 7, "finished", NOW - 86400),
    siteEvent(5, 50, 7, "inprogress", NOW - 86400),
  ];
  const result = extractEvents(record(lists, events), NOW);
  assert.deepEqual(result.map((e) => e.id), [1, 3, 5]);
  assert.equal(result[0].campoInutil, undefined);
});
