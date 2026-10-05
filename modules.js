(function () {
  function $(s) { return document.querySelector(s); }
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function weekBounds(today) {
    var parts = today.split('-');
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    var day = d.getDay();
    var mondayOffset = day === 0 ? -6 : 1 - day;
    var mon = new Date(d);
    mon.setDate(d.getDate() + mondayOffset);
    var sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    function iso(dt) {
      return dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate());
    }
    return { start: iso(mon), end: iso(sun) };
  }
  function daysUntil(iso, today) {
    var a = new Date(today + 'T00:00:00');
    var b = new Date(iso + 'T00:00:00');
    return Math.round((b.getTime() - a.getTime()) / 86400000);
  }

  var loaded = {};

  var KIND = { pokemon: '寶可夢', move: '招式', ability: '特性', item: '道具' };
  var namesState = { entries: [], kind: 'all', q: '' };

  function renderNames() {
    var q = namesState.q.replace(/\s+/g, '').toLowerCase();
    var rows = namesState.entries.filter(function (e) {
      if (namesState.kind !== 'all' && e.kind !== namesState.kind) return false;
      if (!q) return true;
      var blob = [e.zh, e.ja, e.en, e.id].join(' ').replace(/\s+/g, '').toLowerCase();
      return blob.indexOf(q) !== -1;
    });
    var shown = rows.slice(0, 200);
    var count = $('#names-count');
    if (count) {
      count.textContent = rows.length > shown.length
        ? ('顯示 ' + shown.length + ' / ' + rows.length + ' 筆')
        : (rows.length + ' 筆');
    }
    var body = $('#names-body');
    if (!body) return;
    if (!shown.length) {
      body.innerHTML = '<tr><td colspan="4">冇符合嘅名稱</td></tr>';
      return;
    }
    body.innerHTML = shown.map(function (e) {
      return '<tr><td>' + escapeHtml(e.zh || '—') + '</td><td>' + escapeHtml(e.ja || '—') +
        '</td><td>' + escapeHtml(e.en || '—') + '</td><td><span class="badge">' +
        escapeHtml(KIND[e.kind] || e.kind) + '</span></td></tr>';
    }).join('');
  }

  function loadNames() {
    if (loaded.names) { renderNames(); return; }
    var status = $('#names-status');
    fetch('data/names.json')
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (data) {
        loaded.names = true;
        namesState.entries = data.entries || [];
        var meta = $('#names-meta');
        if (meta) meta.textContent = (data.generatedAt || '').slice(0, 10) + ' · ' + namesState.entries.length + ' 筆';
        if (status) status.classList.add('hidden');
        var wrap = $('#names-wrap');
        if (wrap) wrap.classList.remove('hidden');
        renderNames();
      })
      .catch(function (err) {
        if (status) status.innerHTML = '<p>載入失敗</p><p class="sub">' + escapeHtml(err.message) + '</p>';
      });
  }

  function codeEffectiveStatus(row, today) {
    if (row.expires && row.expires < today) return 'expired';
    if (row.status === 'expired') return 'expired';
    return 'active';
  }

  function loadCodes() {
    var status = $('#codes-status');
    var showExpired = $('#codes-show-expired') && $('#codes-show-expired').checked;
    fetch('data/codes.json')
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (data) {
        loaded.codes = data;
        var today = todayISO();
        var note = $('#codes-note');
        if (note) note.textContent = data.note || '';
        var meta = $('#codes-meta');
        if (meta) meta.textContent = '核對 ' + (data.checkedAt || '—');
        var rows = (data.codes || []).map(function (row) {
          return Object.assign({}, row, { _status: codeEffectiveStatus(row, today) });
        });
        rows.sort(function (a, b) {
          if (a._status !== b._status) return a._status === 'active' ? -1 : 1;
          var ae = a.expires || '9999-99-99';
          var be = b.expires || '9999-99-99';
          if (ae !== be) return ae < be ? -1 : 1;
          return String(a.code).localeCompare(String(b.code));
        });
        var visible = rows.filter(function (row) { return showExpired || row._status === 'active'; });
        if (status) status.classList.add('hidden');
        var wrap = $('#codes-wrap');
        if (wrap) wrap.classList.remove('hidden');
        var body = $('#codes-body');
        if (!visible.length) {
          body.innerHTML = '<tr><td colspan="5">冇符合嘅代碼</td></tr>';
          return;
        }
        body.innerHTML = visible.map(function (row) {
          var games = Array.isArray(row.games) ? row.games.join('、') : (row.games || '');
          var badge = row._status === 'active'
            ? '<span class="badge badge-active">有效</span>'
            : '<span class="badge badge-expired">已過期</span>';
          var src = row.source
            ? '<div class="muted"><a href="' + escapeHtml(row.source) + '" target="_blank" rel="noopener">來源</a></div>'
            : '';
          return '<tr><td><code class="gift-code">' + escapeHtml(row.code) + '</code></td><td>' +
            escapeHtml(row.contentZh || '') + src + '</td><td>' + escapeHtml(games) + '</td><td>' +
            escapeHtml(row.expires || '未公開') + '</td><td>' + badge + '</td></tr>';
        }).join('');
      })
      .catch(function (err) {
        if (status) status.innerHTML = '<p>載入失敗</p><p class="sub">' + escapeHtml(err.message) + '</p>';
      });
  }

  var eventsState = { data: null, tab: 'events', filter: 'upcoming' };

  function eventSpan(row) {
    var start = row.date || row.deadline || '';
    var end = row.endDate || row.date || row.deadline || '';
    return { start: start, end: end };
  }

  function eventMatches(row, filter, today, week) {
    var span = eventSpan(row);
    if (!span.end) return filter !== 'past';
    if (filter === 'past') return span.end < today;
    if (span.end < today) return false;
    if (filter === 'week') return span.start <= week.end && span.end >= week.start;
    return true;
  }

  function renderEvents() {
    var data = eventsState.data;
    if (!data) return;
    var today = todayISO();
    var week = weekBounds(today);
    var note = $('#events-note');
    if (note) note.textContent = data.note || '';
    var list = eventsState.tab === 'deadlines' ? (data.deadlines || []) : (data.events || []);
    var rows = list.filter(function (row) { return eventMatches(row, eventsState.filter, today, week); });
    var head = $('#events-head');
    var body = $('#events-body');
    if (eventsState.tab === 'deadlines') {
      head.innerHTML = '<tr><th>IP／品項</th><th>商店</th><th>截止</th><th>連結</th></tr>';
      body.innerHTML = rows.length ? rows.map(function (row) {
        var label = [row.ip, row.item].filter(Boolean).join(' · ');
        var link = row.url ? '<a href="' + escapeHtml(row.url) + '" target="_blank" rel="noopener">開啟</a>' : '—';
        return '<tr><td>' + escapeHtml(label) + (row.sample ? ' <span class="badge badge-sample">示例</span>' : '') +
          '</td><td>' + escapeHtml(row.shop || '') + '</td><td>' + escapeHtml(row.deadline || '') +
          '</td><td>' + link + '</td></tr>';
      }).join('') : '<tr><td colspan="4">呢個篩選冇資料</td></tr>';
    } else {
      head.innerHTML = '<tr><th>日期</th><th>活動</th><th>地點</th><th>門票</th><th>來源</th></tr>';
      body.innerHTML = rows.length ? rows.map(function (row) {
        var when = row.endDate && row.endDate !== row.date ? (row.date + ' – ' + row.endDate) : (row.date || '');
        var ticket = row.ticketUrl ? '<a href="' + escapeHtml(row.ticketUrl) + '" target="_blank" rel="noopener">門票</a>' : '—';
        var source = row.source ? '<a href="' + escapeHtml(row.source) + '" target="_blank" rel="noopener">來源</a>' : '—';
        return '<tr><td>' + escapeHtml(when) + '</td><td>' + escapeHtml(row.title || '') +
          (row.sample ? ' <span class="badge badge-sample">示例</span>' : '') + '</td><td>' +
          escapeHtml(row.place || '') + '</td><td>' + ticket + '</td><td>' + source + '</td></tr>';
      }).join('') : '<tr><td colspan="5">呢個篩選冇資料</td></tr>';
    }
    $('#events-status').classList.add('hidden');
    $('#events-wrap').classList.remove('hidden');
  }

  function icsEscape(s) {
    return String(s || '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
  }

  function exportIcs() {
    var data = eventsState.data;
    if (!data) return;
    var today = todayISO();
    var lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ACG Tools//hub//ZH', 'CALSCALE:GREGORIAN'];
    function add(uid, date, summary, location, url) {
      if (!date || date < today) return;
      var stamp = today.replace(/-/g, '') + 'T000000Z';
      var day = date.replace(/-/g, '');
      lines.push('BEGIN:VEVENT');
      lines.push('UID:' + icsEscape(uid) + '@acg-tools');
      lines.push('DTSTAMP:' + stamp);
      lines.push('DTSTART;VALUE=DATE:' + day);
      lines.push('SUMMARY:' + icsEscape(summary));
      if (location) lines.push('LOCATION:' + icsEscape(location));
      if (url) lines.push('URL:' + icsEscape(url));
      lines.push('END:VEVENT');
    }
    (data.events || []).forEach(function (row) {
      add('event-' + row.id, row.date, row.title, row.place, row.ticketUrl || row.source);
    });
    (data.deadlines || []).forEach(function (row) {
      add('deadline-' + row.id, row.deadline, (row.ip || '') + ' ' + (row.item || '') + ' @ ' + (row.shop || ''), row.shop, row.url);
    });
    lines.push('END:VCALENDAR');
    if (lines.length <= 5) {
      alert('未有未結束嘅活動或截止可以匯出');
      return;
    }
    var blob = new Blob([lines.join('\r\n') + '\r\n'], { type: 'text/calendar;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'acg-tools-upcoming.ics';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function loadEvents() {
    if (eventsState.data) { renderEvents(); return; }
    fetch('data/events.json')
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (data) {
        eventsState.data = data;
        renderEvents();
      })
      .catch(function (err) {
        $('#events-status').innerHTML = '<p>載入失敗</p><p class="sub">' + escapeHtml(err.message) + '</p>';
      });
  }

  function loadAnime() {
    if (loaded.anime) return;
    fetch('data/anime-subs.json')
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (data) {
        loaded.anime = true;
        var meta = $('#anime-meta');
        if (meta) meta.textContent = data.updatedAt || '';
        var note = $('#anime-note');
        if (note) note.textContent = data.note || '';
        var body = $('#anime-body');
        var items = data.items || [];
        body.innerHTML = items.length ? items.map(function (row) {
          var platforms = Array.isArray(row.platforms) ? row.platforms.join('、') : (row.platforms || '');
          var title = escapeHtml(row.title || '');
          if (row.titleJa) title += '<div class="muted">' + escapeHtml(row.titleJa) + '</div>';
          if (row.sample) title += ' <span class="badge badge-sample">樣本</span>';
          var source = row.source ? '<a href="' + escapeHtml(row.source) + '" target="_blank" rel="noopener">來源</a>' : '—';
          return '<tr><td>' + title + '</td><td>' + escapeHtml(platforms) + '</td><td>' +
            escapeHtml(row.regionNote || '') + '</td><td>' + escapeHtml(row.scheduleHkt || '') +
            '</td><td>' + source + '</td></tr>';
        }).join('') : '<tr><td colspan="5">未有資料</td></tr>';
        $('#anime-status').classList.add('hidden');
        $('#anime-wrap').classList.remove('hidden');
      })
      .catch(function (err) {
        $('#anime-status').innerHTML = '<p>載入失敗</p><p class="sub">' + escapeHtml(err.message) + '</p>';
      });
  }

  function monthlyShare(row) {
    var n = Number(row.amount);
    if (!isFinite(n)) return 0;
    if (row.interval === 'year') return n / 12;
    if (row.interval === 'week') return (n * 52) / 12;
    return n;
  }

  function loadSubs() {
    fetch('data/subscriptions.json')
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (data) {
        var today = todayISO();
        var note = $('#subs-note');
        if (note) note.textContent = data.note || '';
        var items = data.items || [];
        var totals = {};
        items.forEach(function (row) {
          var cur = row.currency || '';
          totals[cur] = (totals[cur] || 0) + monthlyShare(row);
        });
        var totalsEl = $('#subs-totals');
        totalsEl.classList.remove('hidden');
        totalsEl.innerHTML = Object.keys(totals).map(function (cur) {
          var value = totals[cur];
          var text = Math.abs(value - Math.round(value)) < 0.05 ? String(Math.round(value)) : value.toFixed(2);
          return '<div class="subs-card"><span class="muted">每月約計（示例）</span><strong>' +
            escapeHtml(text + ' ' + cur) + '</strong></div>';
        }).join('');
        var warehouses = items.filter(function (row) { return row.category === 'warehouse' && row.nextRenew; });
        var wh = $('#subs-warehouse');
        if (warehouses.length) {
          wh.classList.remove('hidden');
          wh.innerHTML = warehouses.map(function (row) {
            var n = daysUntil(row.nextRenew, today);
            var label = n > 0 ? ('仲有 ' + n + ' 日') : (n === 0 ? '今日到期' : ('已過 ' + Math.abs(n) + ' 日'));
            return '<div class="subs-card"><span class="muted">倉租倒數 · ' + escapeHtml(row.name) +
              '</span><strong>' + escapeHtml(label) + '</strong><span class="muted">' +
              escapeHtml(row.nextRenew) + '</span></div>';
          }).join('');
        } else {
          wh.classList.add('hidden');
          wh.innerHTML = '';
        }
        var body = $('#subs-body');
        var sorted = items.slice().sort(function (a, b) {
          return String(a.nextRenew || '').localeCompare(String(b.nextRenew || ''));
        });
        body.innerHTML = sorted.map(function (row) {
          return '<tr><td>' + escapeHtml(row.name || '') +
            (row.example ? ' <span class="badge badge-sample">示例</span>' : '') + '</td><td>' +
            escapeHtml(row.amount) + '</td><td>' + escapeHtml(row.currency || '') + '</td><td>' +
            escapeHtml(row.nextRenew || '') + '</td><td>' + escapeHtml(row.notes || '') + '</td></tr>';
        }).join('');
        $('#subs-status').classList.add('hidden');
        $('#subs-wrap').classList.remove('hidden');
      })
      .catch(function (err) {
        $('#subs-status').innerHTML = '<p>載入失敗</p><p class="sub">' + escapeHtml(err.message) + '</p>';
      });
  }

  document.querySelectorAll('.nav-item').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var mod = btn.dataset.module;
      if (mod === 'names') loadNames();
      if (mod === 'codes') loadCodes();
      if (mod === 'events') loadEvents();
      if (mod === 'anime') loadAnime();
      if (mod === 'subs') loadSubs();
    });
  });

  var namesQ = $('#names-q');
  if (namesQ) namesQ.addEventListener('input', function () {
    namesState.q = namesQ.value || '';
    if (loaded.names) renderNames();
  });
  document.querySelectorAll('#names-kinds .tab').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('#names-kinds .tab').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      namesState.kind = btn.dataset.kind || 'all';
      if (loaded.names) renderNames();
    });
  });
  var expiredToggle = $('#codes-show-expired');
  if (expiredToggle) expiredToggle.addEventListener('change', function () {
    loaded.codes = null;
    loadCodes();
  });
  document.querySelectorAll('#events-tabs .tab').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('#events-tabs .tab').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      eventsState.tab = btn.dataset.eventsTab || 'events';
      renderEvents();
    });
  });
  document.querySelectorAll('#events-filters .tab').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('#events-filters .tab').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      eventsState.filter = btn.dataset.eventsFilter || 'upcoming';
      renderEvents();
    });
  });
  var icsBtn = $('#btn-export-ics');
  if (icsBtn) icsBtn.addEventListener('click', exportIcs);
})();
