// Interpreta o registro "persist:favorites" que o Sofascore guarda no navegador.
// O próprio site mantém os placares desse registro atualizados, por isso a extensão
// não precisa fazer nenhuma consulta ao servidor.
globalThis.AlertaGolFavorites = (() => {
  const LIVE_STATUS = "inprogress";
  const UPCOMING_WINDOW_SECONDS = 24 * 60 * 60;
  const FINISHED_WINDOW_SECONDS = 3 * 60 * 60;

  function inWindow(event, nowSeconds) {
    if (event.status?.type === LIVE_STATUS) return true;
    const start = event.startTimestamp ?? 0;
    if (event.status?.type === "notstarted") return start <= nowSeconds + UPCOMING_WINDOW_SECONDS;
    return start >= nowSeconds - FINISHED_WINDOW_SECONDS;
  }

  const trimScore = (score) => ({
    current: score?.current,
    display: score?.display,
    period1: score?.period1,
    period2: score?.period2,
    period3: score?.period3,
    period4: score?.period4,
    period5: score?.period5,
    extra1: score?.extra1,
    overtime: score?.overtime,
    penalties: score?.penalties,
  });

  const trim = (event) => ({
    id: event.id,
    slug: event.slug,
    customId: event.customId,
    startTimestamp: event.startTimestamp,
    status: { type: event.status?.type, description: event.status?.description },
    homeScore: trimScore(event.homeScore),
    awayScore: trimScore(event.awayScore),
    homeTeam: { name: event.homeTeam?.name, shortName: event.homeTeam?.shortName },
    awayTeam: { name: event.awayTeam?.name, shortName: event.awayTeam?.shortName },
    tournament: {
      name: event.tournament?.name,
      category: { sport: { slug: event.tournament?.category?.sport?.slug } },
    },
  });

  // O valor é JSON dentro de JSON: redux-persist serializa cada campo separadamente.
  function extractEvents(raw, nowSeconds) {
    const root = typeof raw === "string" ? JSON.parse(raw) : raw;
    const lists = JSON.parse(root.lists);
    const events = root.events ? JSON.parse(root.events) : {};
    const starred = new Set(lists.events ?? []);
    const teams = new Set([...(lists.teams ?? []), ...(lists.favoriteTeams ?? [])]);
    const leagues = new Set([...(lists.tournaments ?? []), ...(lists.favoriteLeagues ?? [])]);

    return Object.values(events)
      .filter(
        (e) =>
          starred.has(e.id) ||
          teams.has(e.homeTeam?.id) ||
          teams.has(e.awayTeam?.id) ||
          leagues.has(e.tournament?.uniqueTournament?.id)
      )
      .filter((e) => inWindow(e, nowSeconds))
      .map(trim);
  }

  const INCIDENT_TYPES = new Set(["goal", "inGamePenalty", "varDecision"]);

  // Só o necessário dos lances de um jogo, que costumam vir com muitos dados de cada jogador.
  function trimIncidents(incidents) {
    return (incidents ?? [])
      .filter((i) => INCIDENT_TYPES.has(i.incidentType))
      .map((i) => ({
        id: i.id,
        incidentType: i.incidentType,
        incidentClass: i.incidentClass,
        isHome: i.isHome,
        time: i.time,
        addedTime: i.addedTime,
        playerName: i.player?.shortName ?? i.player?.name ?? i.playerName,
      }));
  }

  return { extractEvents, trimIncidents };
})();
