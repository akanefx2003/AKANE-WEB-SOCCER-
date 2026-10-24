'use strict';
// Test de fumée : un faux service ESPN, puis les routes du site.
const http = require('http');
const assert = require('assert');

const day = 24 * 3600 * 1000;
const iso = (offset) => new Date(Date.now() + offset).toISOString();

function event(id, offset, state, hs, as) {
  return {
    id,
    date: iso(offset),
    status: { displayClock: state === 'in' ? "63'" : '0:00', type: { state, shortDetail: state === 'post' ? 'FT' : '' } },
    competitions: [{
      venue: { fullName: 'Stade Test' },
      competitors: [
        { homeAway: 'home', score: String(hs), team: { shortDisplayName: 'Lyon', abbreviation: 'LYO', logo: 'http://x/lyon.png' } },
        { homeAway: 'away', score: String(as), team: { shortDisplayName: 'Nice', abbreviation: 'NIC' } }
      ]
    }]
  };
}

const entries = (n) => Array.from({ length: n }, (_, i) => ({
  team: { shortDisplayName: 'Club ' + (i + 1), logos: [{ href: 'http://x/c.png' }] },
  stats: [
    { name: 'rank', value: i + 1 }, { name: 'gamesPlayed', value: 8 }, { name: 'wins', value: 5 - i },
    { name: 'ties', value: 1 }, { name: 'losses', value: i }, { name: 'pointDifferential', value: 4 - i }, { name: 'points', value: 16 - 3 * i }
  ]
}));

const fake = http.createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.url.includes('/scoreboard') && req.url.includes('/fra.1/')) {
    return res.end(JSON.stringify({ events: [event('1', -2 * day, 'post', 2, 1), event('2', -600000, 'in', 1, 1), event('3', 2 * day, 'pre', 0, 0), event('4', 20 * day, 'pre', 0, 0)] }));
  }
  if (req.url.includes('/standings') && req.url.includes('/fra.1/')) {
    return res.end(JSON.stringify({ children: [{ name: 'Group A', standings: { entries: entries(3) } }] }));
  }
  if (req.url.includes('/standings') && req.url.includes('/eng.1/')) {
    return res.end(JSON.stringify({ standings: { entries: entries(2) } }));
  }
  res.statusCode = 404;
  res.end('{}');
});

(async () => {
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + fake.address().port;
  process.env.ESPN_SITE = base + '/site';
  process.env.ESPN_V2 = base + '/v2';
  const app = require('../server');
  const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const url = 'http://127.0.0.1:' + srv.address().port;
  const get = async (p) => { const r = await fetch(url + p); return { status: r.status, body: await r.json().catch(() => null) }; };

  let r = await get('/api/health');
  assert.strictEqual(r.status, 200);

  r = await get('/api/leagues');
  assert.ok(r.body.leagues.length >= 20);

  r = await get('/api/league/fra.1');
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body.matches.map((m) => m.state), ['post', 'in', 'pre', 'pre']);
  assert.strictEqual(r.body.matches[0].home.score, 2);
  assert.strictEqual(r.body.matches[2].home.score, null);
  assert.strictEqual(r.body.groups[0].name, 'Groupe A');
  assert.strictEqual(r.body.groups[0].rows[0].points, 16);
  assert.strictEqual(r.body.groups[0].rows[1].gd, 3);

  r = await get('/api/league/eng.1');
  assert.strictEqual(r.body.matches.length, 0); // 404 côté source : liste vide, pas de plantage
  assert.strictEqual(r.body.groups[0].rows.length, 2);

  r = await get('/api/league/inconnue');
  assert.strictEqual(r.status, 404);

  r = await get('/api/week');
  const states = r.body.items.map((i) => i.match.state);
  assert.deepStrictEqual(states, ['in', 'pre']); // en cours + à venir sous 7 jours, pas celui dans 20 jours
  assert.strictEqual(r.body.items[0].league.name, 'Ligue 1');

  const home = await fetch(url + '/');
  assert.strictEqual(home.status, 200);
  assert.ok((await home.text()).includes("Coup d'"));

  console.log('Tous les tests passent.');
  srv.close();
  fake.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
