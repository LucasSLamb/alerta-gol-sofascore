import test from "node:test";
import assert from "node:assert/strict";
import {
  applyIncidents,
  applySnapshot,
  blockPauseSeconds,
  buildNotification,
  compareScores,
  gamesDueForIncidents,
  matchUrl,
  quartersDone,
  readScore,
  scoreText,
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
  const types = applySnapshot(games, [event(1, 0)], RECENT, NOW).alerts.map((a) => a.change.type);
  assert.ok(types.includes("goal"));
});

test("jogo salvo por versão anterior não gera aviso falso de etapa", () => {
  const { alerts, games } = applySnapshot(stored(1, 0, { statusType: "inprogress" }), [event(1, 0)], RECENT, NOW);
  assert.deepEqual(alerts, []);
  assert.deepEqual(games[1].phasesSeen, ["second"]);
});

test("outros esportes ficam de fora, e quem saiu da leitura sai da lista", () => {
  const tennis = event(1, 0, { id: 2, tournament: { category: { sport: { slug: "tennis" } } } });
  const { games, alerts } = applySnapshot(stored(0, 0, { id: 1 }), [tennis], RECENT, NOW);
  assert.deepEqual(games, {});
  assert.deepEqual(alerts, []);
});

test("gol nos últimos instantes alerta mesmo se o jogo já consta como encerrado", () => {
  const finished = event(2, 0, { status: { type: "finished" } });
  const types = applySnapshot(stored(1, 0), [finished], RECENT, NOW).alerts.map((a) => a.change.type);
  assert.deepEqual(types, ["goal", "final"]);
});

const titles = (result) => result.alerts.map((a) => buildNotification(a.game, a.change).title);

const footballAt = (description, type, home = 0, away = 0, periods = {}) =>
  event(home, away, {
    status: { type, description },
    homeScore: { current: home, ...periods },
    awayScore: { current: away, ...periods },
  });

test("futebol: início, intervalo, 2º tempo e fim, cada um uma vez", () => {
  let state = applySnapshot({}, [footballAt("Not started", "notstarted")], RECENT, NOW);
  assert.deepEqual(state.alerts, []);

  const steps = [
    [footballAt("1st half", "inprogress", 0, 0, { period1: 0 }), ["🟢 Começou o jogo"]],
    [footballAt("1st half", "inprogress", 0, 0, { period1: 0 }), []],
    [footballAt("Halftime", "inprogress", 0, 0, { period1: 0 }), ["⏸ Fim do 1º tempo"]],
    [footballAt("2nd half", "inprogress", 0, 0, { period1: 0, period2: 0 }), ["▶ Começou o 2º tempo"]],
    [footballAt("2nd half", "inprogress", 0, 0, { period1: 0, period2: 0 }), []],
    [footballAt("Ended", "finished", 0, 0, { period1: 0, period2: 0 }), ["🏁 Fim de jogo"]],
    [footballAt("Ended", "finished", 0, 0, { period1: 0, period2: 0 }), []],
  ];
  for (const [step, expected] of steps) {
    state = applySnapshot(state.games, [step], RECENT, NOW);
    assert.deepEqual(titles(state), expected);
  }
});

test("futebol: início mostra só os times, e os outros avisos mostram o placar", () => {
  const { games } = applySnapshot({}, [footballAt("Not started", "notstarted")], RECENT, NOW);
  const started = applySnapshot(games, [footballAt("1st half", "inprogress")], RECENT, NOW);
  const start = started.alerts[0];
  assert.equal(buildNotification(start.game, start.change).message, "Barcelona x Aston Villa");
  const half = applySnapshot(started.games, [footballAt("Halftime", "inprogress", 2, 1)], RECENT, NOW);
  const phase = half.alerts.find((a) => a.change.type === "phase");
  assert.equal(buildNotification(phase.game, phase.change).message, "Barcelona 2 x 1 Aston Villa");
});

test("futebol: 2º tempo é detectado pelo placar mesmo se o texto do status mudar, e o intervalo não é obrigatório", () => {
  const { games } = applySnapshot({}, [footballAt("1st half", "inprogress", 0, 0, { period1: 0 })], RECENT, NOW);
  const state = applySnapshot(games, [footballAt("Segundo", "inprogress", 0, 0, { period1: 0, period2: 0 })], RECENT, NOW);
  assert.deepEqual(titles(state), ["▶ Começou o 2º tempo"]);
});

test("futebol: prorrogação e pênaltis", () => {
  let state = applySnapshot({}, [footballAt("2nd half", "inprogress", 1, 1, { period2: 1 })], RECENT, NOW);
  state = applySnapshot(state.games, [footballAt("1st extra", "inprogress", 1, 1, { period2: 1, extra1: 0 })], RECENT, NOW);
  assert.deepEqual(titles(state), ["⏱ Prorrogação"]);
  state = applySnapshot(state.games, [footballAt("2nd extra", "inprogress", 1, 1, { period2: 1, extra1: 0 })], RECENT, NOW);
  assert.deepEqual(titles(state), [], "2º tempo da prorrogação não repete");
  state = applySnapshot(state.games, [footballAt("Penalties", "inprogress", 1, 1, { period2: 1, extra1: 0 })], RECENT, NOW);
  assert.deepEqual(titles(state), ["🥅 Disputa de pênaltis"]);
});

const shootoutAt = (home, away, penHome, penAway, type = "inprogress", description = "Penalties") =>
  event(4 + penHome, 4 + penAway, {
    status: { type, description },
    homeScore: { current: 4 + penHome, display: 4, normaltime: 4, penalties: penHome },
    awayScore: { current: 4 + penAway, display: 4, normaltime: 4, penalties: penAway },
    homeTeam: { shortName: home },
    awayTeam: { shortName: away },
  });

test("disputa de pênaltis: cada cobrança convertida avisa, sem misturar com o placar do jogo", () => {
  let state = applySnapshot({}, [footballAt("2nd extra", "inprogress", 4, 4, { display: 4 })], RECENT, NOW);
  state = applySnapshot(state.games, [shootoutAt("Brasil", "Argentina", 1, 0)], RECENT, NOW);
  const types = state.alerts.map((a) => a.change.type);
  assert.ok(types.includes("penalty"));
  assert.ok(!types.includes("goal"), "cobrança não pode sair como gol");
  const kick = state.alerts.find((a) => a.change.type === "penalty");
  const n = buildNotification(kick.game, kick.change);
  assert.equal(n.title, "🥅 Pênalti convertido: Brasil");
  assert.equal(n.message, "Brasil 4 x 4 Argentina (pênaltis 1 x 0)");
  assert.equal(scoreText(kick.game), "4 – 4 (pên. 1 – 0)");

  state = applySnapshot(state.games, [shootoutAt("Brasil", "Argentina", 1, 1)], RECENT, NOW);
  assert.deepEqual(titles(state), ["🥅 Pênalti convertido: Argentina"]);

  state = applySnapshot(state.games, [shootoutAt("Brasil", "Argentina", 1, 1)], RECENT, NOW);
  assert.deepEqual(titles(state), [], "cobrança perdida não muda o placar");

  state = applySnapshot(state.games, [shootoutAt("Brasil", "Argentina", 2, 2)], RECENT, NOW);
  assert.deepEqual(titles(state), ["🥅 Pênaltis convertidos"]);
});

test("fim após os pênaltis mostra o placar do jogo e o da disputa", () => {
  let state = applySnapshot({}, [shootoutAt("Brasil", "Argentina", 2, 3)], RECENT, NOW);
  state = applySnapshot(state.games, [shootoutAt("Brasil", "Argentina", 2, 3, "finished", "AP")], RECENT, NOW);
  const end = state.alerts[0];
  assert.equal(end.change.type, "final");
  assert.equal(buildNotification(end.game, end.change).message, "Brasil 4 x 4 Argentina (pênaltis 2 x 3)");
});

test("gol comum continua como gol, e o placar sem disputa não muda", () => {
  const { games, alerts } = applySnapshot(stored(0, 0), [event(1, 0)], RECENT, NOW);
  assert.equal(alerts[0].change.type, "goal");
  assert.equal(scoreText(games[1]), "1 – 0");
});

const liveGame = (extra = {}) => ({
  id: 1, home: "Bahia", away: "Vitória", tournament: "Série A", sport: "football",
  statusType: "inprogress", score: { home: 1, away: 0 }, incidentsAt: NOW - 60, ...extra,
});
const varPenalty = { id: 10, incidentType: "varDecision", incidentClass: "penaltyAwarded", isHome: true, time: 90, addedTime: 2, playerName: "J. Juninho" };

test("pênalti marcado pelo VAR avisa uma vez, com time, minuto e jogador", () => {
  const first = applyIncidents(liveGame(), [varPenalty], NOW);
  assert.equal(first.alerts.length, 1);
  const n = buildNotification(first.alerts[0].game, first.alerts[0].change);
  assert.equal(n.title, "🥅 Pênalti marcado: Bahia");
  assert.equal(n.message, "Bahia 1 x 0 Vitória\n90+2' · J. Juninho");
  assert.deepEqual(applyIncidents(first.game, [varPenalty], NOW + 60).alerts, []);
});

test("cancelado, perdido e convertido têm aviso próprio, e o time vem do lance", () => {
  const titleOf = (incident) => {
    const [alert] = applyIncidents(liveGame(), [incident], NOW).alerts;
    return alert && buildNotification(alert.game, alert.change).title;
  };
  assert.equal(titleOf({ id: 1, incidentType: "varDecision", incidentClass: "penaltyNotAwarded" }), "🚫 Pênalti cancelado pelo VAR");
  assert.equal(titleOf({ id: 2, incidentType: "inGamePenalty", incidentClass: "missed", isHome: false }), "❌ Pênalti perdido: Vitória");
  assert.equal(titleOf({ id: 3, incidentType: "goal", incidentClass: "penalty", isHome: false }), "⚽ Gol de pênalti: Vitória");
});

test("outros lances não avisam", () => {
  const others = [
    { id: 1, incidentType: "goal", incidentClass: "regular" },
    { id: 2, incidentType: "varDecision", incidentClass: "goalAwarded" },
    { id: 3, incidentType: "inGamePenalty", incidentClass: "scored" },
  ];
  assert.deepEqual(applyIncidents(liveGame(), others, NOW).alerts, []);
});

test("primeira consulta, ou depois de muito tempo, só registra os lances", () => {
  const first = applyIncidents(liveGame({ incidentsAt: undefined }), [varPenalty], NOW);
  assert.deepEqual(first.alerts, []);
  assert.deepEqual(first.game.incidentsSeen, ["10"]);
  const newer = { ...varPenalty, id: 11 };
  assert.deepEqual(applyIncidents(first.game, [newer], NOW + 3600).alerts, []);
  assert.equal(applyIncidents(first.game, [newer], NOW + 60).alerts.length, 1);
});

test("lance sem id não repete o aviso", () => {
  const incident = { incidentType: "inGamePenalty", incidentClass: "missed", time: 30 };
  const first = applyIncidents(liveGame(), [incident], NOW);
  assert.equal(first.alerts.length, 1);
  assert.deepEqual(applyIncidents(first.game, [incident], NOW + 60).alerts, []);
});

test("consulta só jogos ao vivo de esportes com pênalti, com limite por rodada e por minuto", () => {
  const games = {
    1: liveGame({ id: 1, incidentsAt: NOW - 30 }),
    2: liveGame({ id: 2, incidentsAt: NOW - 90 }),
    3: liveGame({ id: 3, statusType: "finished" }),
    4: liveGame({ id: 4, sport: "basketball" }),
    5: liveGame({ id: 5, incidentsAt: undefined }),
  };
  assert.deepEqual(gamesDueForIncidents(games, NOW), [5, 2]);
  const many = Object.fromEntries([...Array(9).keys()].map((i) => [i, liveGame({ id: i, incidentsAt: NOW - 100 - i })]));
  assert.deepEqual(gamesDueForIncidents(many, NOW), [8, 7, 6, 5, 4]);
});

test("pausa por recusa cresce e tem limite", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 9].map(blockPauseSeconds), [300, 600, 1200, 2400, 3600, 3600]);
});

test("lances são reduzidos ao necessário, sem dados extras do jogador", () => {
  const raw = [
    { id: 1, incidentType: "varDecision", incidentClass: "penaltyAwarded", player: { shortName: "A", dateOfBirthTimestamp: 1 }, time: 5 },
    { id: 2, incidentType: "period", text: "HT" },
  ];
  const trimmed = globalThis.AlertaGolFavorites.trimIncidents(raw);
  assert.equal(trimmed.length, 1);
  assert.equal(trimmed[0].playerName, "A");
  assert.equal(trimmed[0].player, undefined);
  assert.deepEqual(globalThis.AlertaGolFavorites.trimIncidents(undefined), []);
});

test("abrir no meio do jogo não avisa etapas passadas", () => {
  const { games, alerts } = applySnapshot({}, [footballAt("2nd half", "inprogress", 1, 0, { period1: 1, period2: 0 })], RECENT, NOW);
  assert.deepEqual(alerts, []);
  assert.deepEqual(titles(applySnapshot(games, [footballAt("2nd half", "inprogress", 1, 0, { period1: 1, period2: 0 })], RECENT, NOW)), []);
});

test("avisos de início e etapas respeitam leitura atrasada e página recém-carregada", () => {
  const { games } = applySnapshot({}, [footballAt("Not started", "notstarted")], RECENT, NOW);
  assert.deepEqual(applySnapshot(games, [footballAt("1st half", "inprogress")], NOW - 3600, NOW).alerts, []);
  assert.deepEqual(applySnapshot(games, [footballAt("1st half", "inprogress")], RECENT, NOW, 30).alerts, []);
});

const esportsAt = (type, home, away, periods = {}) =>
  event(home, away, {
    status: { type },
    homeTeam: { shortName: "FURIA" },
    awayTeam: { name: "Legacy" },
    homeScore: { current: home, ...periods },
    awayScore: { current: away, ...periods },
    tournament: { name: "IEM", category: { sport: { slug: "esports" } } },
  });

test("esports: início, fim e início de cada mapa, e o último mapa sai junto com o fim", () => {
  let state = applySnapshot({}, [esportsAt("notstarted")], RECENT, NOW);
  const steps = [
    [esportsAt("inprogress", 0, 0, { period1: 0 }), ["🎮 Começou a partida"]],
    [esportsAt("inprogress", 1, 0, { period1: 13 }), ["🎮 FURIA venceu o mapa!"]],
    [esportsAt("inprogress", 1, 0, { period1: 13, period2: 0 }), ["🎮 Começou o mapa 2"]],
    [esportsAt("finished", 2, 0, { period1: 13, period2: 13 }), ["🎮 Fim da partida"]],
  ];
  for (const [step, expected] of steps) {
    state = applySnapshot(state.games, [step], RECENT, NOW);
    assert.deepEqual(titles(state), expected);
  }
});

test("esports: início do mapa vem do status, antes de existirem pontos do mapa", () => {
  const liveMap = (code, description, home, periods) => ({
    ...esportsAt("inprogress", home, 0, periods),
    status: { code, description, type: "inprogress" },
  });
  let state = applySnapshot({}, [liveMap(1001, "First game", 0, { period1: 12 })], RECENT, NOW);
  assert.deepEqual(state.alerts, []);
  // Formato real gravado pelo site: placar já mudou, status é 1002 e ainda não há period2.
  state = applySnapshot(state.games, [liveMap(1002, "Second game", 1, { period1: 13 })], RECENT, NOW);
  assert.deepEqual(titles(state), ["🎮 FURIA venceu o mapa!", "🎮 Começou o mapa 2"]);
  state = applySnapshot(state.games, [liveMap(1002, "Second game", 1, { period1: 13, period2: 4 })], RECENT, NOW);
  assert.deepEqual(titles(state), [], "os pontos do mapa não repetem o aviso");
  state = applySnapshot(state.games, [liveMap(1003, "Third game", 2, { period1: 13, period2: 13 })], RECENT, NOW);
  assert.deepEqual(titles(state), ["🎮 FURIA venceu o mapa!", "🎮 Começou o mapa 3"]);
});

test("leitura do site preserva o código do status", () => {
  const [item] = extractEvents(record({ tournaments: [7] }, [{ ...siteEvent(1, 50, 7), status: { code: 1002, type: "inprogress", description: "Second game" } }]), NOW);
  assert.equal(item.status.code, 1002);
});

test("basquete: início, e o fim do jogo não repete o aviso do último quarto", () => {
  const at = (type, description, periods) => basket(periods, periods, description, type);
  let state = applySnapshot({}, [at("notstarted", "Not started", [])], RECENT, NOW);
  state = applySnapshot(state.games, [at("inprogress", "1st quarter", [2])], RECENT, NOW);
  assert.deepEqual(titles(state), ["🏀 Começou o jogo"]);
  state = applySnapshot(state.games, [at("inprogress", "4th quarter", [20, 20, 20, 5])], RECENT, NOW);
  state = applySnapshot(state.games, [at("finished", "Ended", [20, 20, 20, 25])], RECENT, NOW);
  assert.deepEqual(titles(state), ["🏀 Fim de jogo"]);
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
