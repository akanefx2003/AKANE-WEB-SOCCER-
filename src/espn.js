'use strict';

// Source de données : API publique d'ESPN (sans clé). Elle n'est pas documentée officiellement :
// si elle change un jour, ce fichier est le seul à adapter.
const { cached, mapLimit } = require('./cache');

const SITE = process.env.ESPN_SITE || 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const V2 = process.env.ESPN_V2 || 'https://site.api.espn.com/apis/v2/sports/soccer';
const UA = 'Mozilla/5.0 (compatible; CoupDEnvoi/1.0)';

const DAY = 24 * 3600 * 1000;
const PAST_DAYS = 4;
const FUTURE_DAYS = 7;

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

// ---------- Probabilités calculées à partir des cotes ESPN (quand il y en a) ----------

function parseAmerican(v) {
  if (v == null) return null;
  if (typeof v === 'number') return isFinite(v) && v !== 0 ? v : null;
  const s = String(v).trim().toUpperCase();
  if (s === 'EVEN' || s === 'EV') return 100;
  const n = Number(s.replace('+', ''));
  return isFinite(n) && n !== 0 ? n : null;
}

function impliedProb(american) {
  const n = parseAmerican(american);
  if (n === null) return null;
  return n < 0 ? -n / (-n + 100) : 100 / (n + 100);
}

function moneylines(o) {
  const a = {
    home: o.homeTeamOdds && o.homeTeamOdds.moneyLine,
    draw: o.drawOdds && o.drawOdds.moneyLine,
    away: o.awayTeamOdds && o.awayTeamOdds.moneyLine
  };
  if (o.moneyline) {
    ['home', 'draw', 'away'].forEach((k) => {
      const m = o.moneyline[k];
      const v = m && ((m.close && m.close.odds) || (m.current && m.current.odds) || (m.open && m.open.odds));
      if (a[k] == null && v != null) a[k] = v;
    });
  }
  return a;
}

// Les trois issues (domicile, nul, extérieur) sont nécessaires. On retire la marge du bookmaker
// en ramenant la somme à 100 %.
function oddsToProbs(list) {
  const arr = Array.isArray(list) ? list : [];
  for (const o of arr) {
    if (!o) continue;
    const m = moneylines(o);
    const raw = [impliedProb(m.home), impliedProb(m.draw), impliedProb(m.away)];
    if (raw.some((x) => x === null)) continue;
    const sum = raw[0] + raw[1] + raw[2];
    const p = raw.map((x) => Math.round((x / sum) * 100));
    p[1] += 100 - (p[0] + p[1] + p[2]);
    return { home: p[0], draw: p[1], away: p[2], source: (o.provider && o.provider.name) || null };
  }
  return null;
}

// ---------- Matchs ----------

function normalizeEvent(e) {
  const c = e && e.competitions && e.competitions[0];
  if (!c || !Array.isArray(c.competitors)) return null;
  const home = c.competitors.find((x) => x.homeAway === 'home') || c.competitors[0];
  const away = c.competitors.find((x) => x.homeAway === 'away') || c.competitors[1];
  if (!home || !away || !home.team || !away.team) return null;

  const type = (e.status && e.status.type) || {};
  const state = type.state === 'in' || type.state === 'post' ? type.state : 'pre';
  const side = (x) => ({
    id: String(x.team.id || x.id || ''),
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
    venue: (c.venue && c.venue.fullName) || null,
    probs: oddsToProbs(c.odds)
  };
}

// ESPN refuse les plages de dates pour le foot (erreur 400) : on demande un seul jour à la fois.
// Chaque jour a son propre cache : long pour les jours passés, court pour aujourd'hui.
function fetchDay(id, day, kind) {
  return cached('d:' + id + ':' + day, async () => {
    const matches = ((await getJSON(SITE + '/' + id + '/scoreboard?dates=' + day)).events || [])
      .map((e) => {
        const m = normalizeEvent(e);
        if (m) m.leagueId = id;
        return m;
      })
      .filter(Boolean);
    let ttl = kind === 'past' ? 3 * 3600 * 1000 : 15 * 60 * 1000;
    if (kind === 'today') ttl = matches.some((m) => m.state === 'in') ? 30 * 1000 : 5 * 60 * 1000;
    return { value: matches, ttl };
  });
}

// Matchs des 4 derniers jours et des 7 prochains jours.
async function fetchMatches(id) {
  const now = Date.now();
  // Si le jour d'aujourd'hui échoue (mauvais identifiant), on s'arrête tout de suite.
  const todayList = await fetchDay(id, ymd(now), 'today');

  const offsets = [];
  for (let i = -PAST_DAYS; i <= FUTURE_DAYS; i++) if (i !== 0) offsets.push(i);
  const lists = await mapLimit(offsets, 4, async (i) => {
    try {
      return await fetchDay(id, ymd(now + i * DAY), i < 0 ? 'past' : 'future');
    } catch (err) {
      return [];
    }
  });

  const seen = new Set();
  const matches = [];
  [todayList].concat(lists).forEach((list) => {
    list.forEach((m) => {
      if (!seen.has(m.id)) {
        seen.add(m.id);
        matches.push(m);
      }
    });
  });
  matches.sort((a, b) => new Date(a.date) - new Date(b.date));
  const live = matches.some((m) => m.state === 'in');
  return { value: { matches }, ttl: live ? 30 * 1000 : 5 * 60 * 1000 };
}

// ---------- Détail d'un match ----------

// Garde seulement buts et cartons parmi les évènements clés.
function classify(k) {
  const raw = ((k.type && (k.type.type || k.type.text)) || '').toLowerCase();
  if (raw.includes('own') && raw.includes('goal')) return 'own';
  if (raw.includes('penalty')) return raw.includes('scored') ? 'penalty' : null;
  if (raw.includes('goal')) return 'goal';
  if (raw.includes('yellow') && raw.includes('red')) return 'red';
  if (raw.includes('yellow')) return 'yellow';
  if (raw.includes('red')) return 'red';
  return null;
}

function playerOf(k) {
  const p = k.participants && k.participants[0];
  const a = p && (p.athlete || p);
  return (a && (a.displayName || a.shortName || a.fullName)) || '';
}

function normalizeSummary(data, eventId) {
  const comp = data.header && data.header.competitions && data.header.competitions[0];
  const comps = (comp && comp.competitors) || [];
  const hc = comps.find((x) => x.homeAway === 'home') || comps[0];
  const ac = comps.find((x) => x.homeAway === 'away') || comps[1];
  if (!hc || !ac) throw new Error('Résumé du match incomplet');

  const team = (x) => {
    const t = x.team || x;
    return {
      id: String(t.id || x.id || ''),
      name: t.shortDisplayName || t.displayName || t.name || '?',
      names: [t.shortDisplayName, t.displayName, t.name, t.location].filter(Boolean),
      abbr: t.abbreviation || '',
      logo: t.logo || (t.logos && t.logos[0] && t.logos[0].href) || null,
      score: x.score != null && x.score !== '' ? Number(x.score) : null
    };
  };
  const home = team(hc);
  const away = team(ac);

  const type = (comp && comp.status && comp.status.type) || {};
  const state = type.state === 'in' || type.state === 'post' ? type.state : 'pre';
  if (state === 'pre') {
    home.score = null;
    away.score = null;
  }

  const events = (data.keyEvents || [])
    .map((k, i) => {
      const kind = classify(k);
      if (!kind) return null;
      const teamId = String((k.team && k.team.id) || '');
      return {
        kind,
        minute: (k.clock && k.clock.displayValue) || '',
        sec: k.clock && k.clock.value != null ? Number(k.clock.value) : i,
        player: playerOf(k),
        teamId,
        side: teamId === home.id ? 'home' : teamId === away.id ? 'away' : null
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.sec - b.sec);

  // Forme récente de chaque équipe (ESPN en donne en général cinq).
  const form = ((data.boxscore && data.boxscore.form) || [])
    .map((f) => ({
      teamId: String((f.team && f.team.id) || ''),
      games: (f.events || []).slice(0, 10).map((e) => ({
        date: e.gameDate || e.date || null,
        away: e.atVs === '@',
        opponent: (e.opponent && (e.opponent.shortDisplayName || e.opponent.displayName || e.opponent.abbreviation)) || '?',
        score: e.score || (e.homeTeamScore != null && e.awayTeamScore != null ? e.homeTeamScore + '-' + e.awayTeamScore : ''),
        result: e.gameResult || ''
      }))
    }))
    .filter((f) => f.games.length);

  // Dernières rencontres entre les deux équipes, si ESPN les fournit.
  let h2h = [];
  (data.headToHeadGames || []).forEach((g) => {
    const evs = (g && g.events) || [];
    if (evs.length > h2h.length) h2h = evs;
  });
  h2h = h2h
    .map((e) => ({
      id: String(e.id || ''),
      date: e.gameDate || e.date || null,
      homeId: String(e.homeTeamId || ''),
      awayId: String(e.awayTeamId || ''),
      homeScore: e.homeTeamScore != null ? Number(e.homeTeamScore) : null,
      awayScore: e.awayTeamScore != null ? Number(e.awayTeamScore) : null,
      league: e.leagueAbbreviation || e.leagueName || ''
    }))
    .filter((e) => e.date)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 10);

  return {
    id: String(eventId),
    date: (comp && comp.date) || null,
    state,
    detail: type.shortDetail || '',
    venue: (data.gameInfo && data.gameInfo.venue && data.gameInfo.venue.fullName) || null,
    home,
    away,
    events,
    hasKeyEvents: Array.isArray(data.keyEvents),
    form,
    h2h,
    probs: oddsToProbs(data.pickcenter) || oddsToProbs(data.odds)
  };
}

// Un match terminé ne change plus : 24 h de cache. En cours : 20 s. À venir : 10 min.
function getSummary(leagueId, eventId) {
  return cached('sum:' + leagueId + ':' + eventId, async () => {
    const data = await getJSON(SITE + '/' + leagueId + '/summary?event=' + encodeURIComponent(eventId));
    const value = normalizeSummary(data, eventId);
    const ttl = value.state === 'post' ? 24 * 3600 * 1000 : value.state === 'in' ? 20 * 1000 : 10 * 60 * 1000;
    return { value, ttl };
  });
}

// Diagnostic : liste ce que contient réellement la réponse ESPN (noms de champs, pas les données).
async function summaryShape(leagueId, eventId) {
  const data = await getJSON(SITE + '/' + leagueId + '/summary?event=' + encodeURIComponent(eventId));
  const first = (a) => (Array.isArray(a) && a[0] && typeof a[0] === 'object' ? Object.keys(a[0]) : []);
  const types = {};
  (data.keyEvents || []).forEach((k) => {
    const t = (k.type && (k.type.type || k.type.text)) || '?';
    types[t] = (types[t] || 0) + 1;
  });
  return {
    keys: Object.keys(data),
    keyEvents: { count: (data.keyEvents || []).length, types, firstKeys: first(data.keyEvents) },
    form: { count: ((data.boxscore && data.boxscore.form) || []).length, firstKeys: first(data.boxscore && data.boxscore.form) },
    headToHeadGames: { count: (data.headToHeadGames || []).length, firstKeys: first(data.headToHeadGames) },
    pickcenter: { count: (data.pickcenter || []).length, firstKeys: first(data.pickcenter) },
    odds: { count: (data.odds || []).length, firstKeys: first(data.odds) }
  };
}

// ---------- Classements ----------

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
      id: String(en.team.id || ''),
      rank: Number(s.rank) || i + 1,
      team: en.team.shortDisplayName || en.team.displayName || '?',
      names: [en.team.shortDisplayName, en.team.displayName, en.team.name, en.team.location].filter(Boolean),
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

module.exports = {
  fetchMatches,
  fetchStandings,
  getSummary,
  summaryShape,
  normalizeEvent,
  normalizeSummary,
  oddsToProbs
};
