(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var state = { leagues: [], lg: 'week', view: 'next', f: 'all', data: null, error: null };
  var REFRESH_MS = 60 * 1000;
  var FRAGILE = 55; // en dessous, aucune issue n'est assez probable pour être signalée comme favorite

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function getJSON(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  // ---------- Dates (fuseau de l'appareil) ----------
  function timeOf(iso) {
    return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
  function dayKey(iso) {
    return new Date(iso).toLocaleDateString('en-CA');
  }
  function dayLabel(iso) {
    var s = new Date(iso).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function shortDate(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  var todayKey = function () { return new Date().toLocaleDateString('en-CA'); };

  // ---------- Briques ----------
  function crest(team) {
    var code = esc((team.abbr || team.name || '?').slice(0, 3).toUpperCase());
    if (team.logo) {
      return '<span class="crest"><img src="' + esc(team.logo) + '" alt="" loading="lazy" width="24" height="24" onerror="this.replaceWith(Object.assign(document.createElement(\'span\'),{textContent:\'' + code + '\'}))"></span>';
    }
    return '<span class="crest"><span>' + code + '</span></span>';
  }

  // Barre de probabilités : victoire domicile, nul, victoire extérieur.
  function probsHTML(p, h, a) {
    if (!p) return '';
    var max = Math.max(p.home, p.draw, p.away);
    return '<div class="bar" role="img" aria-label="Probabilités : ' + esc(h) + ' ' + p.home + ' %, nul ' + p.draw + ' %, ' + esc(a) + ' ' + p.away + ' %">' +
      '<span class="h" style="width:' + p.home + '%"></span><span class="d" style="width:' + p.draw + '%"></span><span class="a" style="width:' + p.away + '%"></span></div>' +
      '<div class="pct"><span><b>' + p.home + ' %</b> ' + esc(h) + '</span><span>Nul <b>' + p.draw + ' %</b></span><span>' + esc(a) + ' <b>' + p.away + ' %</b></span></div>' +
      (max < FRAGILE ? '<p class="warn">Match ouvert : aucune issue ne dépasse ' + FRAGILE + ' %.</p>' : '');
  }

  function card(m, tag) {
    var mid, meta = '', extra = '';
    if (m.state === 'pre') {
      mid = '<div class="kick">' + timeOf(m.date) + '</div>';
      if (m.venue) meta = '<div class="meta"><span>' + esc(m.venue) + '</span></div>';
      extra = probsHTML(m.probs, m.home.name, m.away.name);
    } else {
      var hl = m.home.score < m.away.score ? ' class="l"' : '';
      var al = m.away.score < m.home.score ? ' class="l"' : '';
      mid = '<div class="score"><span' + hl + '>' + m.home.score + '</span><i>-</i><span' + al + '>' + m.away.score + '</span></div>';
      if (m.state === 'in') {
        meta = '<div class="meta"><span class="live">En cours · ' + esc(m.clock || m.detail) + '</span><span>' + timeOf(m.date) + '</span></div>';
      } else {
        meta = '<div class="meta"><span>' + esc(m.detail || 'Terminé') + '</span><span>' + timeOf(m.date) + '</span></div>';
      }
    }
    return '<article class="match" tabindex="0" role="button" aria-label="Détails : ' + esc(m.home.name) + ' contre ' + esc(m.away.name) + '" data-lg="' + esc(m.leagueId || '') + '" data-id="' + esc(m.id) + '">' +
      (tag ? '<div class="tag">' + esc(tag) + '</div>' : '') +
      '<div class="row"><div class="team">' + crest(m.home) + '<b>' + esc(m.home.name) + '</b></div>' + mid +
      '<div class="team away">' + crest(m.away) + '<b>' + esc(m.away.name) + '</b></div></div>' + meta + extra + '</article>';
  }

  // items : [{ match, tag }]
  function byDay(items) {
    var html = '', cur = '';
    items.forEach(function (it) {
      var k = dayKey(it.match.date);
      if (k !== cur) {
        if (cur) html += '</div>';
        cur = k;
        html += '<div class="day">' + dayLabel(it.match.date) + (k === todayKey() ? '<span class="today">Aujourd\'hui</span>' : '') + '</div><div class="list">';
      }
      html += card(it.match, it.tag);
    });
    return html ? html + '</div>' : '';
  }

  function table(rows) {
    var body = rows.map(function (r, i) {
      return '<tr' + (i === 0 ? ' class="lead"' : '') + '><td>' + r.rank + '</td><td class="nm">' +
        (r.logo ? '<span class="crest"><img src="' + esc(r.logo) + '" alt="" loading="lazy" width="18" height="18"></span>' : '') + esc(r.team) +
        '</td><td>' + r.played + '</td><td>' + r.wins + '</td><td>' + r.draws + '</td><td>' + r.losses +
        '</td><td>' + (r.gd > 0 ? '+' : '') + r.gd + '</td><td class="pts">' + r.points + '</td></tr>';
    }).join('');
    return '<div class="tablewrap"><table><thead><tr><th>#</th><th>Équipe</th><th title="Matchs joués">J</th><th title="Victoires">G</th><th title="Nuls">N</th><th title="Défaites">P</th><th title="Différence de buts">Diff</th><th title="Points">Pts</th></tr></thead><tbody>' + body + '</tbody></table></div>';
  }

  function standings(groups) {
    return groups.map(function (g) {
      return (g.name && groups.length > 1 ? '<div class="day">' + esc(g.name) + '</div>' : '') + table(g.rows);
    }).join('');
  }

  function skeleton() {
    return '<div class="skel"></div><div class="skel"></div><div class="skel"></div>';
  }

  function render() {
    var tabs = [{ id: 'week', name: 'Semaine' }].concat(state.leagues);
    $('leagues').innerHTML = tabs.map(function (t) {
      return '<button role="tab" data-lg="' + esc(t.id) + '" aria-selected="' + (t.id === state.lg) + '">' + esc(t.name) + '</button>';
    }).join('');

    var sub = '', out = '';
    if (state.error && !state.data) {
      out = '<p class="note">Impossible de charger les données pour le moment. Réessaie dans un instant.</p>';
    } else if (!state.data) {
      out = skeleton();
    } else if (state.lg === 'week') {
      var all = state.data.items;
      var counts = {}, keys = [];
      all.forEach(function (it) { if (!counts[it.league.id]) { counts[it.league.id] = 0; keys.push(it.league); } counts[it.league.id]++; });
      var shown = state.f === 'all' ? all : all.filter(function (it) { return it.league.id === state.f; });
      sub = '<div class="chips"><button data-f="all" aria-pressed="' + (state.f === 'all') + '">Toutes (' + all.length + ')</button>' +
        keys.map(function (l) { return '<button data-f="' + esc(l.id) + '" aria-pressed="' + (state.f === l.id) + '">' + esc(l.name) + ' (' + counts[l.id] + ')</button>'; }).join('') + '</div>' +
        '<p class="sum">Matchs en cours et matchs des 7 prochains jours. Touche un match pour voir les détails.</p>';
      out = byDay(shown.map(function (it) { return { match: it.match, tag: it.league.name }; })) ||
        '<p class="note">Aucun match prévu dans les 7 prochains jours.</p>';
    } else {
      var d = state.data;
      var next = d.matches.filter(function (m) { return m.state !== 'post'; });
      var done = d.matches.filter(function (m) { return m.state === 'post'; }).reverse();
      var views = [];
      if (next.length) views.push(['next', 'À venir']);
      views.push(['res', 'Résultats']);
      if (d.groups.length) views.push(['table', d.groups.length > 1 ? 'Groupes' : 'Classement']);
      if (!views.some(function (v) { return v[0] === state.view; })) state.view = views[0][0];
      sub = '<div class="views" role="tablist">' + views.map(function (v) {
        return '<button role="tab" data-v="' + v[0] + '" aria-selected="' + (v[0] === state.view) + '">' + v[1] + '</button>';
      }).join('') + '</div>';
      if (state.view === 'table') out = standings(d.groups);
      else {
        var list = state.view === 'next' ? next : done;
        out = byDay(list.map(function (m) { return { match: m }; })) ||
          '<p class="note">Aucun match à afficher pour cette compétition en ce moment.</p>';
      }
    }
    $('sub').innerHTML = sub;
    $('out').innerHTML = out;
  }

  function load(silent) {
    var url = state.lg === 'week' ? '/api/week' : '/api/league/' + encodeURIComponent(state.lg);
    var asked = state.lg;
    if (!silent) { state.data = null; state.error = null; render(); }
    return getJSON(url).then(function (data) {
      if (asked !== state.lg) return;
      state.data = data; state.error = null;
      $('stamp').textContent = 'Mis à jour à ' + timeOf(data.updatedAt);
      render();
    }).catch(function () {
      if (asked !== state.lg) return;
      state.error = true;
      if (!state.data) $('stamp').textContent = 'Hors ligne';
      render();
    });
  }

  // ---------- Fiche d'un match ----------
  var sheet = null, lastFocus = null, openId = null;

  function ensureSheet() {
    if (sheet) return sheet;
    sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.hidden = true;
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', 'Détails du match');
    sheet.innerHTML = '<div class="sheet-inner"><button type="button" class="sheet-close" data-close>Fermer</button><div id="sheet-body"></div></div>';
    document.body.appendChild(sheet);
    sheet.addEventListener('click', function (e) {
      if (e.target === sheet || e.target.closest('[data-close]')) closeSheet();
    });
    return sheet;
  }

  function closeSheet() {
    if (!sheet || sheet.hidden) return;
    sheet.hidden = true;
    openId = null;
    document.documentElement.classList.remove('lock');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function findMatch(lg, id) {
    var d = state.data;
    if (!d) return null;
    var list = d.items ? d.items.map(function (it) { return it.match; }) : (d.matches || []);
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function ordinal(n) { return n === 1 ? '1er' : n + 'e'; }
  function section(title, body) { return '<section class="sec"><h3>' + title + '</h3>' + body + '</section>'; }
  function missing(text) { return '<p class="note small">' + text + '</p>'; }

  var KIND = { goal: 'But', penalty: 'But (penalty)', own: 'But contre son camp', yellow: 'Carton jaune', red: 'Carton rouge' };

  function cardIcon(kind) {
    return kind === 'yellow' ? '<i class="cardi y" title="Carton jaune"></i>' : kind === 'red' ? '<i class="cardi r" title="Carton rouge"></i>' : '<i class="ball" title="But"></i>';
  }

  function cardsLine(c, h, a) {
    if (!c) return '';
    return '<span class="cl"><i class="cardi y"></i>' + esc(h) + ' ' + c.home.yellow + ' · ' + esc(a) + ' ' + c.away.yellow + '</span>' +
      '<span class="cl"><i class="cardi r"></i>' + esc(h) + ' ' + c.home.red + ' · ' + esc(a) + ' ' + c.away.red + '</span>';
  }

  function renderDetail(d, fb) {
    var m = d.match, probs = m.probs || (fb && fb.probs) || null;
    var teamName = function (id) { return id === m.home.id ? m.home.name : id === m.away.id ? m.away.name : ''; };

    var score = m.state === 'pre'
      ? '<div class="kick big">' + (m.date ? timeOf(m.date) : '—') + '</div>'
      : '<div class="score big"><span>' + m.home.score + '</span><i>-</i><span>' + m.away.score + '</span></div>';
    var status = m.state === 'pre' ? (m.date ? dayLabel(m.date) : '') : m.state === 'in' ? 'En cours' : (m.detail || 'Terminé');
    var head = '<div class="dhead"><div class="team">' + crest(m.home) + '<b>' + esc(m.home.name) + '</b></div>' + score +
      '<div class="team away">' + crest(m.away) + '<b>' + esc(m.away.name) + '</b></div></div>' +
      '<p class="dsub" id="sheet-title">' + esc(status) + (m.venue ? ' · ' + esc(m.venue) : '') + '</p>';

    var html = head;

    // Probabilités
    if (probs && m.state === 'pre') {
      html += section('Probabilités', probsHTML(probs, m.home.name, m.away.name) +
        '<p class="note small">Estimation tirée des cotes' + (probs.source ? ' (' + esc(probs.source) + ')' : '') + ', pas un résultat. Une cote ne garantit rien.</p>');
    } else if (m.state === 'pre') {
      html += section('Probabilités', missing('Pas de cotes disponibles pour ce match, donc pas de pourcentages.'));
    }

    // Classement
    var rk = function (t, r) {
      return '<div class="rk"><b>' + esc(t.name) + '</b><span>' + (r ? ordinal(r.rank) + ' · ' + r.points + ' pts · ' + r.played + ' matchs' + (r.group ? ' · ' + esc(r.group) : '') : 'Non classé dans les données') + '</span></div>';
    };
    html += section('Classement', rk(m.home, d.ranks.home) + rk(m.away, d.ranks.away));

    // Buteurs et cartons
    if (m.state === 'pre') {
      html += section('Buteurs et cartons', missing('Le match n\'a pas commencé.'));
    } else if (!m.events.length) {
      html += section('Buteurs et cartons', missing('Aucun but ni carton fourni par ESPN pour ce match.'));
    } else {
      html += section('Buteurs et cartons', '<ul class="evs">' + m.events.map(function (e) {
        var who = e.side === 'home' ? m.home.name : e.side === 'away' ? m.away.name : teamName(e.teamId);
        return '<li class="ev ' + (e.side || '') + '"><span class="min">' + esc(e.minute) + '</span>' + cardIcon(e.kind) +
          '<span class="who"><b>' + esc(e.player || 'Joueur non précisé') + '</b><small>' + esc(who) + ' · ' + KIND[e.kind] + '</small></span></li>';
      }).join('') + '</ul>');
    }

    // Forme récente
    if (m.form.length) {
      html += section('Forme récente', m.form.map(function (f) {
        return '<div class="form"><b>' + esc(teamName(f.teamId) || 'Équipe') + '</b><ul class="fl">' + f.games.map(function (g) {
          var r = g.result === 'W' ? 'v' : g.result === 'L' ? 'p' : g.result === 'D' ? 'n' : '';
          var lbl = r === 'v' ? 'V' : r === 'p' ? 'D' : r === 'n' ? 'N' : '·';
          return '<li><span class="chipr ' + r + '">' + lbl + '</span><span class="fd">' + esc(shortDate(g.date)) + '</span><span class="fo">' + (g.away ? 'à ' : 'contre ') + esc(g.opponent) + '</span><span class="fs">' + esc(g.score) + '</span></li>';
        }).join('') + '</ul></div>';
      }).join(''));
    } else {
      html += section('Forme récente', missing('Non fournie par ESPN pour ce match.'));
    }

    // Dernières rencontres entre les deux équipes
    if (d.meetings.length) {
      html += section('Dernières rencontres entre les deux équipes (' + d.meetings.length + ')', '<ul class="mts">' + d.meetings.map(function (g) {
        var goals = (g.goals || []).map(function (x) { return esc(x.player || '?') + ' ' + esc(x.minute) + (x.kind === 'penalty' ? ' (pen.)' : x.kind === 'own' ? ' (c.s.c.)' : ''); }).join(', ');
        return '<li class="mt"><div class="mtl"><span>' + esc(shortDate(g.date)) + '</span><span>' + esc(g.league) + '</span></div>' +
          '<div class="mtm"><b>' + esc(g.home) + '</b><span class="sc">' + (g.homeScore != null ? g.homeScore : '?') + ' - ' + (g.awayScore != null ? g.awayScore : '?') + '</span><b>' + esc(g.away) + '</b></div>' +
          (goals ? '<div class="mtx"><span class="cl">Buteurs : ' + goals + '</span></div>' : '') +
          (g.cards ? '<div class="mtx">' + cardsLine(g.cards, g.home, g.away) + '</div>' : '') + '</li>';
      }).join('') + '</ul>' + missing('ESPN fournit en général quelques rencontres seulement, pas toujours dix.'));
    } else {
      html += section('Dernières rencontres entre les deux équipes', missing('Historique des confrontations non fourni par ESPN pour ce match.'));
    }

    return html;
  }

  function openMatch(lg, id, trigger) {
    if (!lg || !id) return;
    ensureSheet();
    lastFocus = trigger || null;
    openId = lg + ':' + id;
    var mine = openId;
    sheet.hidden = false;
    document.documentElement.classList.add('lock');
    var body = $('sheet-body');
    body.innerHTML = skeleton();
    sheet.querySelector('.sheet-close').focus();
    getJSON('/api/match/' + encodeURIComponent(lg) + '/' + encodeURIComponent(id)).then(function (d) {
      if (openId !== mine) return;
      body.innerHTML = renderDetail(d, findMatch(lg, id));
    }).catch(function () {
      if (openId !== mine) return;
      body.innerHTML = '<p class="note">Détails indisponibles pour ce match pour le moment. Réessaie plus tard.</p>';
    });
  }

  document.addEventListener('click', function (e) {
    var m = e.target.closest('.match[data-id]');
    if (m) { openMatch(m.dataset.lg, m.dataset.id, m); return; }
    var b = e.target.closest('button');
    if (!b || b.hasAttribute('data-close')) return;
    if (b.dataset.lg) {
      state.lg = b.dataset.lg; state.f = 'all'; state.view = 'next';
      window.scrollTo(0, 0);
      load(false);
    } else if (b.dataset.v) { state.view = b.dataset.v; render(); }
    else if (b.dataset.f) { state.f = b.dataset.f; render(); }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closeSheet(); return; }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('match')) {
      e.preventDefault();
      openMatch(e.target.dataset.lg, e.target.dataset.id, e.target);
    }
  });

  // Rafraîchissement automatique tant que la page est visible.
  setInterval(function () { if (document.visibilityState === 'visible') load(true); }, REFRESH_MS);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') load(true); });

  getJSON('/api/leagues').then(function (d) { state.leagues = d.leagues; render(); }).catch(function () {});
  render();
  load(false);
})();
