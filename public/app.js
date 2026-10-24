(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var state = { leagues: [], lg: 'week', view: 'next', f: 'all', data: null, error: null };
  var REFRESH_MS = 60 * 1000;

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
  var todayKey = function () { return new Date().toLocaleDateString('en-CA'); };

  // ---------- Rendu ----------
  function crest(team) {
    var code = esc((team.abbr || team.name || '?').slice(0, 3).toUpperCase());
    if (team.logo) {
      return '<span class="crest"><img src="' + esc(team.logo) + '" alt="" loading="lazy" width="24" height="24" onerror="this.replaceWith(Object.assign(document.createElement(\'span\'),{textContent:\'' + code + '\'}))"></span>';
    }
    return '<span class="crest"><span>' + code + '</span></span>';
  }

  function card(m, tag) {
    var mid, meta = '';
    if (m.state === 'pre') {
      mid = '<div class="kick">' + timeOf(m.date) + '</div>';
      if (m.venue) meta = '<div class="meta"><span>' + esc(m.venue) + '</span></div>';
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
    return '<article class="match">' + (tag ? '<div class="tag">' + esc(tag) + '</div>' : '') +
      '<div class="row"><div class="team">' + crest(m.home) + '<b>' + esc(m.home.name) + '</b></div>' + mid +
      '<div class="team away">' + crest(m.away) + '<b>' + esc(m.away.name) + '</b></div></div>' + meta + '</article>';
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
        '<p class="sum">Matchs en cours et matchs des 7 prochains jours.</p>';
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

  document.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.lg) {
      state.lg = b.dataset.lg; state.f = 'all'; state.view = 'next';
      window.scrollTo(0, 0);
      load(false);
    } else if (b.dataset.v) { state.view = b.dataset.v; render(); }
    else if (b.dataset.f) { state.f = b.dataset.f; render(); }
  });

  // Rafraîchissement automatique tant que la page est visible.
  setInterval(function () { if (document.visibilityState === 'visible') load(true); }, REFRESH_MS);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') load(true); });

  getJSON('/api/leagues').then(function (d) { state.leagues = d.leagues; render(); }).catch(function () {});
  render();
  load(false);
})();
