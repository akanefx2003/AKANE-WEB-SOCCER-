'use strict';

const path = require('path');
const express = require('express');
const { LEAGUES, byId } = require('./src/leagues');
const { cached, mapLimit } = require('./src/cache');
const { fetchMatches, fetchStandings } = require('./src/espn');

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

app.use(express.static(path.join(__dirname, 'public'), { maxAge: '5m' }));

// Sur Render : on écoute un port. Sur Vercel : l'application est simplement exportée.
if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log('Coup d\'envoi sur le port ' + port));
}

module.exports = app;
