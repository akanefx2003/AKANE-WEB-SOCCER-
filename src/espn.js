'use strict';

// Source de données : API publique d'ESPN (sans clé). Elle n'est pas documentée officiellement :
// si elle change un jour, ce fichier est le seul à adapter. Les adresses se règlent par variables
// d'environnement (utile pour les tests).
const SITE = process.env.ESPN_SITE || 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const V2 = process.env.ESPN_V2 || 'https://site.api.espn.com/apis/v2/sports/soccer';
const UA = 'Mozilla/5.0 (compatible; CoupDEnvoi/1.0)';

const DAY = 24 * 3600 * 1000;

async function getJSON(url, ms = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'user-agent': UA, accept: 'application/json' }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' pour ' + url);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const ymd = (ms) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');

function normalizeEvent(e) {
  const c = e && e.competitions && e.competitions[0];
  if (!c || !Array.isArray(c.competitors)) return null;
  const home = c.competitors.find((x) => x.homeAway === 'home') || c.competitors[0];
  const away = c.competitors.find((x) => x.homeAway === 'away') || c.competitors[1];
  if (!home || !away || !home.team || !away.team) return null;

  const type = (e.status && e.status.type) || {};
  const state = type.state === 'in' || type.state === 'post' ? type.state : 'pre';
  const side = (x) => ({
    name: x.team.shortDisplayName || x.team.displayName || x.team.name || '?',
    abbr: x.team.abbreviation || '',
    logo: x.team.logo || null,
    score: state === 'pre' ? null : Number(x.score)
  });

  return {
    id: String(e.id),
    date: e.date,
    state, // 'pre' (à venir), 'in' (en cours), 'post' (terminé)
    detail: type.shortDetail || '',
    clock: (e.status && e.status.displayClock) || '',
    home: side(home),
    away: side(away),
    venue: (c.venue && c.venue.fullName) || null
  };
}

// Matchs des 10 derniers jours et des 14 prochains jours.
async function fetchMatches(id) {
  const now = Date.now();
  const url = SITE + '/' + id + '/scoreboard?limit=300&dates=' + ymd(now - 10 * DAY) + '-' + ymd(now + 14 * DAY);
  const data = await getJSON(url);
  const matches = (data.events || []).map(normalizeEvent).filter(Boolean);
  matches.sort((a, b) => new Date(a.date) - new Date(b.date));
  const live = matches.some((m) => m.state === 'in');
  return { value: { matches }, ttl: live ? 30 * 1000 : 5 * 60 * 1000 };
}

function statMap(entry) {
  const out = {};
  (entry.stats || []).forEach((s) => {
    out[s.name] = s.value;
  });
  return out;
}

function normalizeEntries(entries) {
  const rows = (entries || []).map((en, i) => {
    const s = statMap(en);
    return {
      rank: Number(s.rank) || i + 1,
      team: en.team.shortDisplayName || en.team.displayName || '?',
      logo: en.team.logo || (en.team.logos && en.team.logos[0] && en.team.logos[0].href) || null,
      played: Number(s.gamesPlayed) || 0,
      wins: Number(s.wins) || 0,
      draws: Number(s.ties) || 0,
      losses: Number(s.losses) || 0,
      gd: Number(s.pointDifferential) || 0,
      points: Number(s.points) || 0
    };
  });
  rows.sort((a, b) => a.rank - b.rank);
  return rows;
}

// Classements : un tableau par groupe (un seul pour un championnat classique).
async function fetchStandings(id) {
  const data = await getJSON(V2 + '/' + id + '/standings');
  let groups = [];
  if (Array.isArray(data.children) && data.children.length) {
    groups = data.children
      .map((ch) => ({
        name: (ch.name || '').replace(/^Group /i, 'Groupe '),
        rows: normalizeEntries(ch.standings && ch.standings.entries)
      }))
      .filter((g) => g.rows.length);
  } else if (data.standings && data.standings.entries) {
    groups = [{ name: '', rows: normalizeEntries(data.standings.entries) }];
  }
  return { value: { groups }, ttl: 15 * 60 * 1000 };
}

module.exports = { fetchMatches, fetchStandings, normalizeEvent };
