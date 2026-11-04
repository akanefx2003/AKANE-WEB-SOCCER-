'use strict';

const path = require('path');
const express = require('express');
const { LEAGUES, byId } = require('./src/leagues');
const { cached, mapLimit } = require('./src/cache');
const { fetchMatches, fetchStandings, getSummary, summaryShape } = require('./src/espn');

const app = express();
app.disable('x-powered-by');

// Les réponses de l'API peuvent être gardées 30 s par le CDN de l'hébergeur.
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'public, max-age=0, s-maxage=30, stale-while-revalidate=300');
  next();
});

// Matchs d'une compétition. Une erreur de la source ne fait pas tomber le site :
// on garde la dernière valeur connue, sinon on répond une liste vide pendant 10 minutes.
function getMatches(id) {
  return cached('m:' + id, async () => {
    try {
      return await fetchMatches(id);
    } catch (err) {
      console.warn('[matchs]', id, err.message);
      return { value: { matches: [], error: true }, ttl: 10 * 60 * 1000 };
    }
  });
}

function getStandings(id) {
  return cached('s:' + id, async () => {
    try {
      return await fetchStandings(id);
    } catch (err) {
      console.warn('[classement]', id, err.message);
      return { value: { groups: [], error: true }, ttl: 10 * 60 * 1000 };
    }
  });
}

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Place d'une équipe au classement : par identifiant, sinon par nom.
function rankOf(groups, team) {
  const names = (team.names || []).map(norm);
  for (const g of groups) {
    const row = g.rows.find((r) => (team.id && r.id === team.id) || (r.names || []).some((n) => names.includes(norm(n))));
    if (row) return { rank: row.rank, points: row.points, played: row.played, group: g.name || '' };
  }
  return null;
}

function countCards(events, teamId) {
  const mine = events.filter((e) => e.teamId === teamId);
  return {
    yellow: mine.filter((e) => e.kind === 'yellow').length,
    red: mine.filter((e) => e.kind === 'red').length
  };
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.get('/api/leagues', (req, res) => {
  res.json({ leagues: LEAGUES });
});

app.get('/api/league/:id', async (req, res) => {
  const league = byId(req.params.id);
  if (!league) return res.status(404).json({ error: 'Compétition inconnue' });
  const [m, s] = await Promise.all([getMatches(league.id), getStandings(league.id)]);
  res.json({
    league,
    matches: m.matches,
    groups: s.groups,
    updatedAt: new Date().toISOString()
  });
});

// Tous les matchs en cours ou prévus dans les 7 prochains jours.
app.get('/api/week', async (req, res) => {
  const now = Date.now();
  const end = now + 7 * 24 * 3600 * 1000;
  const lists = await mapLimit(LEAGUES, 5, async (league) => {
    const m = await getMatches(league.id);
    return m.matches
      .filter((x) => x.state === 'in' || (x.state === 'pre' && new Date(x.date) <= end))
      .map((x) => ({ league: { id: league.id, name: league.name }, match: x }));
  });
  const items = [].concat(...lists);
  items.sort((a, b) => new Date(a.match.date) - new Date(b.match.date));
  res.json({ items, updatedAt: new Date().toISOString() });
});

const validEvent = (id) => /^\d{1,14}$/.test(id);

// Fiche d'un match : buts, cartons, forme, face-à-face avec cartons de chaque rencontre, classement.
app.get('/api/match/:league/:id', async (req, res) => {
  const league = byId(req.params.league);
  if (!league || !validEvent(req.params.id)) return res.status(404).json({ error: 'Match inconnu' });
  try {
    const s = await getSummary(league.id, req.params.id);
    const st = await getStandings(league.id);
    const ranks = { home: rankOf(st.groups || [], s.home), away: rankOf(st.groups || [], s.away) };
    const nameById = {};
    nameById[s.home.id] = s.home.name;
    nameById[s.away.id] = s.away.name;

    const meetings = await mapLimit(s.h2h, 3, async (g) => {
      const base = {
        date: g.date,
        league: g.league,
        home: nameById[g.homeId] || '?',
        away: nameById[g.awayId] || '?',
        homeScore: g.homeScore,
        awayScore: g.awayScore,
        cards: null,
        goals: []
      };
      if (!g.id) return base;
      try {
        const p = await getSummary(league.id, g.id);
        base.home = p.home.name;
        base.away = p.away.name;
        if (p.home.score != null) base.homeScore = p.home.score;
        if (p.away.score != null) base.awayScore = p.away.score;
        if (p.hasKeyEvents) {
          base.cards = { home: countCards(p.events, p.home.id), away: countCards(p.events, p.away.id) };
          base.goals = p.events
            .filter((e) => e.kind === 'goal' || e.kind === 'penalty' || e.kind === 'own')
            .map((e) => ({ minute: e.minute, player: e.player, kind: e.kind, side: e.side }));
        }
      } catch (err) {
        // détail indisponible pour cette rencontre : on garde la ligne de base
      }
      return base;
    });

    const { h2h, ...match } = s;
    res.json({ match, ranks, meetings, updatedAt: new Date().toISOString() });
  } catch (err) {
    console.warn('[détail]', league.id, req.params.id, err.message);
    res.status(502).json({ error: 'Détails indisponibles pour ce match' });
  }
});

// Diagnostic : montre quels champs ESPN renvoie vraiment pour un match (sans les données).
app.get('/api/match-debug/:league/:id', async (req, res) => {
  const league = byId(req.params.league);
  if (!league || !validEvent(req.params.id)) return res.status(404).json({ error: 'Match inconnu' });
  try {
    res.json(await summaryShape(league.id, req.params.id));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.use(express.static(path.join(__dirname, 'public'), { maxAge: '5m' }));

// Sur Render ou Termux : on écoute un port. Sur Vercel : l'application est simplement exportée.
if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log('Coup d\'envoi sur le port ' + port));
}

module.exports = app;
