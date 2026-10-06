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

  var codesState = { data: null, game: '' };

  function codeHasGame(row, game) {
    if (!game) return true;
    var games = Array.isArray(row.games) ? row.games : [];
    return games.indexOf(game) !== -1;
  }

  function renderCodes() {
    var data = codesState.data;
    if (!data) return;
    var showExpired = $('#codes-show-expired') && $('#codes-show-expired').checked;
    var today = todayISO();
    var note = $('#codes-note');
    if (note) note.textContent = data.note || '';
    var meta = $('#codes-meta');
    if (meta) meta.textContent = '核對 ' + (data.checkedAt || '—');
    var catalog = [];
    var seenGame = {};
    function addGame(name) {
      if (!name || seenGame[name]) return;
      seenGame[name] = true;
      catalog.push(name);
    }
    (data.gamesCatalog || []).forEach(addGame);
    (data.codes || []).forEach(function (row) {
      (Array.isArray(row.games) ? row.games : []).forEach(addGame);
    });
    var gamesNav = $('#codes-games');
    if (gamesNav) {
      var chips = ['<button type="button" class="tab' + (codesState.game ? '' : ' active') + '" data-game="">全部</button>'];
      catalog.forEach(function (name) {
        chips.push('<button type="button" class="tab' + (codesState.game === name ? ' active' : '') +
          '" data-game="' + escapeHtml(name) + '">' + escapeHtml(name) + '</button>');
      });
      gamesNav.innerHTML = chips.join('');
    }
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
    var forGame = rows.filter(function (row) { return codeHasGame(row, codesState.game); });
    var visible = forGame.filter(function (row) { return showExpired || row._status === 'active'; });
    var status = $('#codes-status');
    if (status) status.classList.add('hidden');
    var wrap = $('#codes-wrap');
    if (wrap) wrap.classList.remove('hidden');
    var body = $('#codes-body');
    if (!visible.length) {
      var emptyMsg = (codesState.game && !forGame.length) ? '暫未有公開配送碼' : '冇符合嘅代碼';
      body.innerHTML = '<tr><td colspan="5">' + emptyMsg + '</td></tr>';
      return;
    }
    body.innerHTML = visible.map(function (row) {
      var games = (Array.isArray(row.games) ? row.games : []).map(function (g) {
        return '<span class="badge badge-game">' + escapeHtml(g) + '</span>';
      }).join(' ');
      var badge = row._status === 'active'
        ? '<span class="badge badge-active">有效</span>'
        : '<span class="badge badge-expired">已過期</span>';
      var src = row.source
        ? '<div class="muted"><a href="' + escapeHtml(row.source) + '" target="_blank" rel="noopener">來源</a></div>'
        : '';
      return '<tr><td><code class="gift-code">' + escapeHtml(row.code) + '</code></td><td>' +
        escapeHtml(row.contentZh || '') + src + '</td><td>' + (games || '—') + '</td><td>' +
        escapeHtml(row.expires || '未公開') + '</td><td>' + badge + '</td></tr>';
    }).join('');
  }

  function loadCodes() {
    if (codesState.data) { renderCodes(); return; }
    var status = $('#codes-status');
    fetch('data/codes.json')
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (data) {
        codesState.data = data;
        renderCodes();
      })
      .catch(function (err) {
        if (status) status.innerHTML = '<p>載入失敗</p><p class="sub">' + escapeHtml(err.message) + '</p>';
      });
  }

  var EVENTS_LS = 'acg_events_board';
  var EVENT_RECENT_DAYS = 7;
  var EVENT_BUCKETS = [
    { id: 'shop', label: '快閃／限定店' },
    { id: 'exhibit', label: '展覽／特展' },
    { id: 'doujin', label: '展會／同人' },
    { id: 'live', label: '演唱會／LIVE' },
    { id: 'screen', label: '電影／LIVE VIEWING' },
    { id: 'other', label: '其他' }
  ];
  var EVENT_CAT_BUCKET = {
    '快閃店': 'shop',
    '限定店': 'shop',
    '展覽': 'exhibit',
    '特展': 'exhibit',
    '展會': 'doujin',
    '同人展': 'doujin',
    '同人': 'doujin',
    '同人祭': 'doujin',
    '演唱會': 'live',
    '見面會': 'live',
    'LIVE': 'live',
    '電影': 'screen',
    'LIVE VIEWING': 'screen'
  };

  function readEventFilters() {
    var out = { bucket: 'all', featured: false, q: '' };
    try {
      var raw = JSON.parse(localStorage.getItem(EVENTS_LS) || '{}');
      if (raw && (raw.bucket === 'all' || EVENT_BUCKETS.some(function (b) { return b.id === raw.bucket; }))) {
        out.bucket = raw.bucket;
      }
      out.featured = !!(raw && raw.featured);
      if (raw && typeof raw.q === 'string') out.q = raw.q.slice(0, 80);
    } catch (e) {}
    return out;
  }

  function saveEventFilters() {
    try {
      localStorage.setItem(EVENTS_LS, JSON.stringify({
        bucket: eventsState.bucket,
        featured: !!eventsState.featured,
        q: eventsState.q || ''
      }));
    } catch (e) {}
  }

  var _savedEventFilters = readEventFilters();
  var eventsState = {
    data: null,
    tab: 'events',
    bucket: _savedEventFilters.bucket,
    featured: _savedEventFilters.featured,
    q: _savedEventFilters.q
  };

  function eventBucket(category) {
    var cat = String(category || '').trim();
    if (!cat) return 'other';
    if (EVENT_CAT_BUCKET[cat]) return EVENT_CAT_BUCKET[cat];
    var upper = cat.toUpperCase();
    if (upper === 'LIVE VIEWING') return 'screen';
    if (upper === 'LIVE') return 'live';
    return 'other';
  }

  function eventPhase(row, today) {
    var start = row.date || '';
    var end = row.endDate || row.date || '';
    var status = row.status;
    if (start || end) {
      var startD = start || end;
      var endD = end || start;
      if (today < startD) status = '即將開始';
      else if (today > endD) status = '已完結';
      else status = '進行中';
    }
    if (status !== '即將開始' && status !== '進行中' && status !== '已完結') return '';
    if (status === '已完結') {
      var endD2 = row.endDate || row.date || '';
      if (!endD2) return '';
      if (daysUntil(endD2, today) < -EVENT_RECENT_DAYS) return '';
    }
    return status;
  }

  function eventVisible(row) {
    if (eventsState.bucket !== 'all' && eventBucket(row.category) !== eventsState.bucket) return false;
    if (eventsState.featured && !row.featured) return false;
    var q = String(eventsState.q || '').trim().toLowerCase();
    if (!q) return true;
    var ips = Array.isArray(row.ips) ? row.ips.join(' ') : '';
    var blob = [row.title, ips, row.place].join(' ').toLowerCase();
    return blob.indexOf(q) !== -1;
  }

  function upcomingLabel(start, today) {
    if (!start) return '';
    var n = daysUntil(start, today);
    if (n <= 0) return '今日開始';
    return n + ' 日後開始';
  }

  function ongoingLabel(end, today) {
    if (!end) return '';
    var n = daysUntil(end, today);
    if (n <= 0) return '今日最後一日';
    return '仲有 ' + n + ' 日';
  }

  function deadlineLabel(deadline, today) {
    if (!deadline) return '';
    var n = daysUntil(deadline, today);
    if (n === 0) return '今日截止';
    if (n > 0) return '仲有 ' + n + ' 日';
    return '已過 ' + (-n) + ' 日';
  }

  function mapsHref(row) {
    if (row.mapUrl && /^https?:\/\//i.test(String(row.mapUrl))) return String(row.mapUrl);
    var q = [row.place, row.address].filter(Boolean).join(' ');
    if (!q) return '';
    return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
  }

  function linkedPlace(text, href) {
    var label = text || '';
    if (!label) return '—';
    if (!href) return escapeHtml(label);
    return '<a class="place-link" href="' + escapeHtml(href) + '" target="_blank" rel="noopener" title="喺 Google 地圖開啟">' +
      escapeHtml(label) + '</a>';
  }

  function renderBucketChips() {
    var nav = $('#events-buckets');
    if (!nav) return;
    var buckets = [{ id: 'all', label: '全部' }].concat(EVENT_BUCKETS);
    nav.innerHTML = buckets.map(function (b) {
      return '<button type="button" class="tab' + (eventsState.bucket === b.id ? ' active' : '') +
        '" data-event-bucket="' + b.id + '">' + escapeHtml(b.label) + '</button>';
    }).join('');
  }

  function eventCard(row, today, phase) {
    var star = row.featured ? '<span class="event-star" title="重點 IP">⭐</span>' : '';
    var sample = row.sample ? ' <span class="badge badge-sample">示例</span>' : '';
    var cat = row.category ? '<span class="badge event-cat">' + escapeHtml(row.category) + '</span>' : '';
    var ips = (Array.isArray(row.ips) ? row.ips : []).map(function (ip) {
      return '<span class="badge">' + escapeHtml(ip) + '</span>';
    }).join('');
    var when = '';
    if (row.date) when = (row.endDate && row.endDate !== row.date) ? (row.date + ' – ' + row.endDate) : row.date;
    if (row.timeNote) when = when ? (when + ' · ' + row.timeNote) : row.timeNote;
    var count = '';
    if (phase === '即將開始') count = upcomingLabel(row.date, today);
    else if (phase === '進行中') count = ongoingLabel(row.endDate || row.date, today);
    var countHtml = count ? '<span class="event-count">' + escapeHtml(count) + '</span>' : '';
    var price = row.price ? '<p class="event-meta">' + escapeHtml(row.price) + '</p>' : '';
    var ticketNote = row.ticketNote ? '<p class="event-meta">' + escapeHtml(row.ticketNote) + '</p>' : '';
    var notes = row.notes ? '<p class="event-notes">' + escapeHtml(row.notes) + '</p>' : '';
    var ticket = safeHttp(row.ticketUrl);
    var source = safeHttp(row.source);
    var actions = '';
    if (ticket) {
      actions += '<a class="btn btn-primary btn-sm event-ticket" href="' + escapeHtml(ticket) + '" target="_blank" rel="noopener">購票</a>';
    }
    if (source) {
      actions += '<a class="event-source" href="' + escapeHtml(source) + '" target="_blank" rel="noopener">來源</a>';
    }
    return '<article class="event-card">' +
      '<div class="event-card-head"><h3 class="event-title">' + star + escapeHtml(row.title || '') + sample + '</h3>' + cat + '</div>' +
      (ips ? '<div class="event-ips">' + ips + '</div>' : '') +
      ((when || count) ? '<p class="event-meta">' + escapeHtml(when) + countHtml + '</p>' : '') +
      '<p class="event-meta event-place">' + linkedPlace(row.place || '', mapsHref(row)) + '</p>' +
      price + ticketNote + notes +
      (actions ? '<div class="event-actions">' + actions + '</div>' : '') +
      '</article>';
  }

  function eventSection(title, rows, today, empty) {
    var cards = rows.length
      ? '<div class="event-grid">' + rows.map(function (row) { return eventCard(row, today, title); }).join('') + '</div>'
      : '<p class="events-empty">' + empty + '</p>';
    return '<section class="event-section"><h2>' + title + '（' + rows.length + '）</h2>' + cards + '</section>';
  }

  function cmpEventDate(a, b, field) {
    var av = a[field] || a.date || '9999-99-99';
    var bv = b[field] || b.date || '9999-99-99';
    if (av !== bv) return av < bv ? -1 : 1;
    return String(a.title || '').localeCompare(String(b.title || ''), 'zh-Hant');
  }

  function renderDeadlines(data, today) {
    var rows = (data.deadlines || []).slice().sort(function (a, b) {
      var ad = a.deadline || '9999-99-99';
      var bd = b.deadline || '9999-99-99';
      if (ad !== bd) return ad < bd ? -1 : 1;
      return String(a.item || '').localeCompare(String(b.item || ''), 'zh-Hant');
    });
    if (!rows.length) return '<p class="events-empty">暫未有周邊截止</p>';
    return '<div class="event-grid">' + rows.map(function (row) {
      var label = [row.ip, row.item].filter(Boolean).join(' · ');
      var count = deadlineLabel(row.deadline, today);
      var sample = row.sample ? ' <span class="badge badge-sample">示例</span>' : '';
      var link = safeHttp(row.url);
      var linkHtml = link ? '<a href="' + escapeHtml(link) + '" target="_blank" rel="noopener">開啟</a>' : '';
      return '<article class="event-card">' +
        '<h3 class="event-title">' + escapeHtml(label || '截止') + sample + '</h3>' +
        '<p class="event-meta">' + linkedPlace(row.shop || row.place || '', mapsHref(row)) + '</p>' +
        '<p class="event-meta">截止 ' + escapeHtml(row.deadline || '—') +
        (count ? '<span class="event-count">' + escapeHtml(count) + '</span>' : '') + '</p>' +
        (linkHtml ? '<div class="event-actions">' + linkHtml + '</div>' : '') +
        '</article>';
    }).join('') + '</div>';
  }

  function renderEvents() {
    var data = eventsState.data;
    if (!data) return;
    var today = todayISO();
    var note = $('#events-note');
    if (note) note.textContent = data.note || '';
    var updated = $('#events-updated');
    if (updated) {
      var stamp = String(data.updatedAt || '');
      updated.textContent = /^\d{4}-\d{2}-\d{2}$/.test(stamp) ? ('活動資料更新：' + stamp) : '';
    }
    var status = $('#events-status');
    if (status) status.classList.add('hidden');
    var tools = $('#events-tools');
    var board = $('#events-board');
    var deadlines = $('#events-deadlines');
    if (eventsState.tab === 'deadlines') {
      if (tools) tools.classList.add('hidden');
      if (board) board.classList.add('hidden');
      if (deadlines) {
        deadlines.classList.remove('hidden');
        deadlines.innerHTML = renderDeadlines(data, today);
      }
      return;
    }
    if (tools) tools.classList.remove('hidden');
    if (deadlines) deadlines.classList.add('hidden');
    if (!board) return;
    board.classList.remove('hidden');
    renderBucketChips();
    var groups = { '進行中': [], '即將開始': [], '已完結': [] };
    (data.events || []).forEach(function (row) {
      if (!eventVisible(row)) return;
      var phase = eventPhase(row, today);
      if (groups[phase]) groups[phase].push(row);
    });
    groups['進行中'].sort(function (a, b) { return cmpEventDate(a, b, 'endDate'); });
    groups['即將開始'].sort(function (a, b) { return cmpEventDate(a, b, 'date'); });
    groups['已完結'].sort(function (a, b) { return cmpEventDate(b, a, 'endDate'); });
    var pastCards = groups['已完結'].length
      ? '<div class="event-grid">' + groups['已完結'].map(function (row) { return eventCard(row, today, '已完結'); }).join('') + '</div>'
      : '<p class="events-empty">最近七日冇完結活動</p>';
    board.innerHTML = [
      eventSection('進行中', groups['進行中'], today, '暫未有進行中嘅活動'),
      eventSection('即將開始', groups['即將開始'], today, '暫未有即將開始嘅活動'),
      '<details class="event-section events-past"><summary>剛完結（' + groups['已完結'].length + '）</summary>' + pastCards + '</details>'
    ].join('');
  }

  function icsEscape(s) {
    return String(s || '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
  }

  function exportIcs() {
    var data = eventsState.data;
    if (!data) return;
    var today = todayISO();
    var lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ACG Tools//hub//ZH', 'CALSCALE:GREGORIAN'];
    function add(uid, date, summary, location, url, allowPastStart) {
      if (!date || (!allowPastStart && date < today)) return;
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
      var end = row.endDate || row.date || '';
      if (!row.date || (end && end < today)) return;
      add('event-' + row.id, row.date, row.title, row.place, row.ticketUrl || row.source, true);
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

  // scripts/sync_anime_subs.py reads the pair list in tradToSimp. Keep that string intact.
  var SIMP_MAP = null;
  function tradToSimp(s) {
    if (!SIMP_MAP) {
      SIMP_MAP = {};
      ('藥药 偵侦 東东 戰战 龍龙 國国 門门 長长 馬马 車车 書书 畫画 電电 視视 動动 亞亚 麗丽 夢梦 靈灵 術术 師师 鬥斗 強强 無无 雙双 與与 為为 裡里 裏里 過过 進进 達达 遠远 見见 觀观 聽听 問问 題题 義义 認认 話话 誰谁 應应 還还 個个 們们 開开 關关 時时 間间 會会 來来 這这 說说 後后 發发 對对 機机 記记 從从 麼么 鳥鸟 魚鱼 聲声 學学 歐欧 爭争 於于 該该 議议 識识 雲云 氣气 點点 體体 頭头 實实 現现 業业 經经 歷历 齊齐 齒齿 齡龄 廣广 慶庆 庫库 廳厅 廚厨 廟庙 廢废 異异 當当 網网 線线 練练 鐵铁 銀银 銅铜 錢钱 鐘钟 鍵键 鏡镜 閣阁 隊队 陽阳 陰阴 陳陈 陸陆 險险 隱隐 難难 雞鸡 離离 霧雾 頁页 順顺 須须 預预 領领 風风 飛飞 飯饭 餅饼 養养 餘余 駐驻 驗验 髮发 鬧闹 鮮鲜 黃黄 黨党 龜龟 萬万 專专 叢丛 並并 乾干 亂乱 俠侠 倉仓 倫伦 偉伟 側侧 偽伪 傑杰 傘伞 備备 傭佣 傳传 債债 傷伤 傾倾 僅仅 僑侨 僕仆 價价 儉俭 優优 內内 兩两 衝冲 決决 況况 剛刚 劇剧 勸劝 務务 勝胜 勞劳 勢势 匯汇 區区 協协 卻却 廠厂 參参 敘叙 疊叠 葉叶 號号 團团 圖图 圓圆 聖圣 場场 壞坏 塊块 堅坚 壽寿 奪夺 奮奋 孫孙 宮宫 審审 導导 層层 島岛 嶺岭 帳帐 幣币 幾几 棄弃 張张 彈弹 徑径 復复 懷怀 戀恋 戲戏 戶户 執执 掃扫 揚扬 揮挥 據据 擬拟 擊击 擋挡 擴扩 攝摄 數数 斷断 晝昼 曉晓 殺杀 雜杂 權权 條条 極极 樂乐 樓楼 歲岁 歸归 殘残 殼壳 沒没 測测 湯汤 溝沟 溫温 滅灭 燈灯 燒烧 營营 牆墙 獨独 獲获 獸兽 環环 產产 療疗 盡尽 盤盘 眾众 礙碍 礎础 禍祸 積积 穩稳 窮穷 節节 範范 簡简 紅红 純纯 級级 緊紧 緣缘 縣县 縫缝 縮缩 羅罗 習习 聞闻 聯联 職职 腸肠 膚肤 興兴 捨舍 艦舰 藝艺 蒼苍 蓋盖 處处 蟲虫 衛卫 補补 裝装 褲裤 製制 複复 規规 覽览 觸触 訂订 計计 討讨 讓让 護护 誠诚 誤误 課课 調调 談谈 請请 論论 謝谢 證证 譯译 豐丰 豬猪 貓猫 貝贝 貢贡 財财 貨货 責责 貴贵 買买 費费 賽赛 贏赢 跡迹 車车 軍军 較较 載载 輕轻 輛辆 輪轮 轉转 辦办 週周 連连 遊游 運运 違违 遙遥 適适 選选 遲迟 遺遗 鄰邻 醜丑 醫医 針针 鈴铃 錯错 錶表 鍋锅 鎖锁 鎮镇 鑄铸 閃闪 閉闭 閑闲 閘闸 類类 飄飘 飾饰 館馆 騎骑 鳴鸣 鵝鹅 齊齐').split(/\s+/).forEach(function (pair) {
        if (pair.length === 2) SIMP_MAP[pair.charAt(0)] = pair.charAt(1);
      });
    }
    return String(s || '').replace(/[\u3400-\u9fff]/g, function (ch) { return SIMP_MAP[ch] || ch; });
  }

  function decodeEntities(s) {
    return String(s || '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }

  var CN_DIGIT = { '零': 0, '〇': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
  function cnToInt(raw) {
    var s = String(raw || '');
    if (/^[0-9]+$/.test(s)) return String(parseInt(s, 10));
    if (s === '十') return '10';
    var ten = s.indexOf('十');
    if (ten === -1) {
      if (s.length === 1 && CN_DIGIT[s] != null) return String(CN_DIGIT[s]);
      return '';
    }
    var hi = ten === 0 ? 1 : CN_DIGIT[s.charAt(0)];
    var lo = ten === s.length - 1 ? 0 : CN_DIGIT[s.charAt(ten + 1)];
    if (hi == null || lo == null) return '';
    return String(hi * 10 + lo);
  }

  function normTitle(s) {
    var t = decodeEntities(s);
    try { t = t.normalize('NFKC'); } catch (e) {}
    t = tradToSimp(t.toLowerCase());
    t = t.replace(/([0-9]+)\s*(?:st|nd|rd|th)\s*season/g, '第$1季');
    t = t.replace(/season\s*([0-9]+)/g, '第$1季');
    t = t.replace(/第\s*([0-9]+|[零〇一二三四五六七八九十]+)\s*(?:期|季|部)/g, function (_, n) {
      var num = cnToInt(n);
      return num ? ('s' + num) : _;
    });
    t = t.replace(/[\s\u3000·・･．.。、，,：:；;！!？?～〜\-–—_／/\\()（）[\]【】「」『』《》〈〉"'“”‘’#&+]+/g, '');
    return t;
  }

  function safeHttp(url) {
    var u = String(url || '');
    return /^https?:\/\//i.test(u) ? u : '';
  }

  function bgmIdOf(row) {
    if (row && row.bgmId != null && row.bgmId !== '') return String(row.bgmId);
    var src = String((row && row.source) || '');
    var m = src.match(/bgm\.tv\/subject\/(\d+)/);
    return m ? m[1] : '';
  }

  function indexSubs(items) {
    var byId = {};
    var byName = {};
    (items || []).forEach(function (row, i) {
      row._i = i;
      var id = bgmIdOf(row);
      if (id && !byId[id]) byId[id] = row;
      [row.title, row.titleJa].concat(Array.isArray(row.aliases) ? row.aliases : []).forEach(function (name) {
        var key = normTitle(name);
        if (key && !byName[key]) byName[key] = row;
      });
    });
    return { byId: byId, byName: byName, items: items || [] };
  }

  function matchSub(item, index) {
    if (!item || !index) return null;
    if (item.id != null && index.byId[String(item.id)]) return index.byId[String(item.id)];
    var keys = [normTitle(item.name), normTitle(item.name_cn)];
    for (var i = 0; i < keys.length; i++) {
      if (keys[i] && index.byName[keys[i]]) return index.byName[keys[i]];
    }
    return null;
  }

  function pairSeason(days, items) {
    var index = indexSubs(items);
    var matched = {};
    var groups = (days || []).map(function (day) {
      var rows = (day.items || []).map(function (item) {
        var sub = matchSub(item, index);
        if (sub) matched[sub._i] = true;
        return { item: item, sub: sub };
      });
      return { weekday: day.weekday || {}, rows: rows };
    });
    var unmatched = index.items.filter(function (row) { return !matched[row._i]; });
    return { groups: groups, unmatched: unmatched };
  }

  var seasonView = { days: null, subs: null, zhOnly: false, platform: '' };

  function subPasses(sub) {
    if (!sub) return !seasonView.zhOnly && !seasonView.platform;
    if (seasonView.zhOnly && !sub) return false;
    if (seasonView.platform) {
      var platforms = Array.isArray(sub.platforms) ? sub.platforms : [];
      if (platforms.indexOf(seasonView.platform) === -1) return false;
    }
    return true;
  }

  function subPanel(sub) {
    if (!sub) return '';
    var badges = [];
    badges.push('<span class="badge badge-sub">' + escapeHtml(sub.subtitle || '中文字幕') + '</span>');
    if (sub.status) badges.push('<span class="badge">' + escapeHtml(sub.status) + '</span>');
    (Array.isArray(sub.platforms) ? sub.platforms : []).forEach(function (p) {
      badges.push('<span class="badge">' + escapeHtml(p) + '</span>');
    });
    if (sub.sample === true) badges.push('<span class="badge badge-sample">樣本</span>');
    var meta = [sub.regionNote, sub.scheduleHkt].filter(Boolean).map(escapeHtml).join(' · ');
    var src = safeHttp(sub.source);
    var srcHtml = src ? '<div class="anime-sub-src"><a href="' + escapeHtml(src) + '" target="_blank" rel="noopener">字幕來源</a></div>' : '';
    return '<div class="anime-sub-panel"><div class="anime-sub-line">' + badges.join('') + '</div>' +
      (meta ? '<div class="anime-sub-meta muted">' + meta + '</div>' : '') + srcHtml + '</div>';
  }

  function seasonCard(item, sub) {
    var rawName = item.name_cn || item.name || sub && sub.title || '未知';
    var name = decodeEntities(rawName);
    var rawJa = item.name && decodeEntities(item.name) !== name ? decodeEntities(item.name) : (sub && sub.titleJa && sub.titleJa !== name ? sub.titleJa : '');
    var cover = item.images && (item.images.common || item.images.large || item.images.medium) || '';
    var url = safeHttp(item.url) || (item.id ? ('https://bgm.tv/subject/' + encodeURIComponent(item.id)) : '');
    var scoreNum = item.rating && item.rating.score ? Number(item.rating.score) : 0;
    var score = scoreNum ? scoreNum.toFixed(1) : '';
    var air = item.air_date && item.air_date !== '0000-00-00' ? item.air_date : '';
    var hitOpen = url ? '<a class="anime-card-hit" href="' + escapeHtml(url) + '" target="_blank" rel="noopener">' : '<div class="anime-card-hit">';
    var hitClose = url ? '</a>' : '</div>';
    return '<article class="anime-card' + (sub ? ' anime-card-sub' : '') + '">' + hitOpen +
      (cover ? '<img class="anime-cover" src="' + escapeHtml(cover) + '" alt="" loading="lazy" />' : '<div class="anime-cover"></div>') +
      '<div class="anime-info"><div class="anime-name" title="' + escapeHtml(name) + '">' + escapeHtml(name) + '</div>' +
      (rawJa ? '<div class="muted">' + escapeHtml(rawJa) + '</div>' : '') +
      (air ? '<div class="anime-date">' + escapeHtml(air) + '</div>' : '') +
      (score ? '<div class="anime-score">★ ' + escapeHtml(score) + '</div>' : '') +
      '</div>' + hitClose + subPanel(sub) + '</article>';
  }

  function renderSubsChrome(subs) {
    subs = subs || {};
    var updated = $('#season-subs-updated');
    if (updated) {
      if (subs.updatedAt) {
        updated.hidden = false;
        updated.textContent = '字幕資料更新：' + subs.updatedAt;
      } else {
        updated.hidden = true;
        updated.textContent = '';
      }
    }
    var note = $('#season-subs-note');
    if (note) note.textContent = subs.note || '';
    var box = $('#season-unresolved');
    var pending = Array.isArray(subs.unresolved) ? subs.unresolved : [];
    if (!box) return;
    if (!pending.length) {
      box.hidden = true;
      box.open = false;
      box.innerHTML = '';
      return;
    }
    box.hidden = false;
    box.innerHTML = '<summary>有 ' + pending.length + ' 套未能自動對上 Bangumi，請在 Notion 填 bgmId</summary><ul>' +
      pending.map(function (row) {
        var title = row.title || row.titleJa || '未命名';
        var ja = row.titleJa && row.titleJa !== row.title ? (' · ' + row.titleJa) : '';
        return '<li>' + escapeHtml(title + ja) + '</li>';
      }).join('') + '</ul>';
  }

  function fillPlatforms(items) {
    var sel = $('#season-platform');
    if (!sel) return;
    var current = seasonView.platform;
    var seen = {};
    var names = [];
    (items || []).forEach(function (row) {
      (Array.isArray(row.platforms) ? row.platforms : []).forEach(function (p) {
        if (!p || seen[p]) return;
        seen[p] = true;
        names.push(p);
      });
    });
    names.sort();
    sel.innerHTML = '<option value="">全部平台</option>' + names.map(function (p) {
      return '<option value="' + escapeHtml(p) + '">' + escapeHtml(p) + '</option>';
    }).join('');
    if (current && seen[current]) sel.value = current;
    else {
      seasonView.platform = '';
      sel.value = '';
    }
  }

  var seasonPainting = false;

  function paintSeason() {
    if (seasonPainting) return;
    seasonPainting = true;
    try {
    var container = $('#season-content');
    if (!container || !seasonView.days) return;
    var subs = seasonView.subs || { items: [], note: '' };
    renderSubsChrome(subs);
    fillPlatforms(subs.items || []);
    var paired = pairSeason(seasonView.days, subs.items || []);
    var jsDay = new Date().getDay();
    var todayBgmId = jsDay === 0 ? 7 : jsDay;
    var groups = paired.groups.slice().sort(function (a, b) {
      var idA = a.weekday.id || 0;
      var idB = b.weekday.id || 0;
      if (idA === todayBgmId && idB !== todayBgmId) return -1;
      if (idB === todayBgmId && idA !== todayBgmId) return 1;
      return ((idA - todayBgmId + 7) % 7) - ((idB - todayBgmId + 7) % 7);
    });
    var html = groups.map(function (day) {
      var rows = day.rows.filter(function (row) { return subPasses(row.sub); });
      if (!rows.length) return '';
      var id = day.weekday.id || 0;
      var isToday = id === todayBgmId;
      var dayName = day.weekday.cn || day.weekday.ja || day.weekday.en || '其他';
      return '<div class="weekday-section' + (isToday ? ' weekday-today' : '') + '">' +
        '<div class="weekday-title">' + escapeHtml(dayName) + (isToday ? ' · 今日' : '') + '（' + rows.length + ' 部）</div>' +
        '<div class="anime-grid">' + rows.map(function (row) { return seasonCard(row.item, row.sub); }).join('') + '</div></div>';
    }).join('');
    var extra = paired.unmatched.filter(function (row) { return subPasses(row); });
    if (extra.length) {
      html += '<div class="weekday-section weekday-unmatched"><div class="weekday-title">未收錄於本季 Bangumi 表（' +
        extra.length + '）</div><div class="anime-grid">' + extra.map(function (row) {
          return seasonCard({
            name_cn: row.title || '',
            name: row.titleJa || '',
            url: safeHttp(row.source) || '',
            air_date: row.premiere || '',
            images: {},
            rating: {}
          }, row);
        }).join('') + '</div></div>';
    }
    container.innerHTML = html || '<div class="empty-state"><p>呢個篩選冇動畫</p></div>';
    } finally {
      seasonPainting = false;
    }
  }

  function ensureSeasonSubs(force) {
    if (seasonView.subs && !force) return Promise.resolve(seasonView.subs);
    return fetch('data/anime-subs.json' + (force ? ('?t=' + Date.now()) : ''), { cache: force ? 'no-store' : 'default' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (data) {
        seasonView.subs = data || { items: [] };
        return seasonView.subs;
      })
      .catch(function () {
        if (!seasonView.subs) seasonView.subs = { items: [], note: '中文字幕資料載入失敗，放送表仍然顯示。' };
        return seasonView.subs;
      });
  }

  window.renderSeason = function (days) {
    seasonView.days = Array.isArray(days) ? days : [];
    if (window.__acgSeasonZh) seasonView.zhOnly = true;
    var box = $('#season-zh-only');
    if (box) box.checked = !!seasonView.zhOnly;
    paintSeason();
    ensureSeasonSubs(false).then(function () { paintSeason(); });
  };

  window.acgSetSeasonZhOnly = function (on, fromRoute) {
    seasonView.zhOnly = !!on;
    window.__acgSeasonZh = !!on;
    var box = $('#season-zh-only');
    if (box) box.checked = seasonView.zhOnly;
    if (!fromRoute) {
      var next = seasonView.zhOnly ? '#season/zh' : '#season';
      if (/^#season/.test(location.hash || '') && location.hash !== next) history.replaceState(null, '', next);
    }
    if (seasonView.days) paintSeason();
  };

  window.acgMatchSubs = function (days, items) {
    var paired = pairSeason(days, items);
    var pairs = [];
    paired.groups.forEach(function (day) {
      day.rows.forEach(function (row) {
        if (row.sub) pairs.push({ id: row.item.id, title: row.item.name_cn || row.item.name, sub: row.sub.title, via: bgmIdOf(row.sub) && String(row.item.id) === bgmIdOf(row.sub) ? 'bgmId' : 'name' });
      });
    });
    return {
      pairs: pairs,
      unmatched: paired.unmatched.map(function (row) { return row.title; })
    };
  };

  var zhBox = $('#season-zh-only');
  if (zhBox) zhBox.addEventListener('change', function () {
    window.acgSetSeasonZhOnly(zhBox.checked, false);
  });
  var platformSel = $('#season-platform');
  if (platformSel) platformSel.addEventListener('change', function () {
    if (seasonPainting) return;
    seasonView.platform = platformSel.value || '';
    if (seasonView.days) paintSeason();
  });
  if (typeof window.loadSeason === 'function') {
    var innerLoadSeason = window.loadSeason;
    window.loadSeason = function (force) {
      if (force) seasonView.subs = null;
      return innerLoadSeason.apply(this, arguments);
    };
  }

  var SUBS_LS = 'acg_subs_passphrase';
  var subsState = { envelope: null, plain: null };
  var SUBS_HIDE = ['subs-note', 'subs-totals', 'subs-warehouse', 'subs-active-block', 'subs-uncertain-block', 'subs-cancelled-block'];

  function readSubsPass() {
    try { return (localStorage.getItem(SUBS_LS) || '').trim(); } catch (e) { return ''; }
  }

  function writeSubsPass(value) {
    try {
      if (value) localStorage.setItem(SUBS_LS, value);
      else localStorage.removeItem(SUBS_LS);
    } catch (e) {}
  }

  function showSubsError(msg) {
    var err = $('#subs-gate-error');
    if (!err) return;
    err.textContent = msg || '密碼錯誤';
    err.className = 'gate-error';
  }

  function hideSubsError() {
    var err = $('#subs-gate-error');
    if (err) err.className = 'gate-error hidden';
  }

  function clearSubsDom() {
    SUBS_HIDE.forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.classList.add('hidden');
      if (id === 'subs-note') el.textContent = '';
      else if (id !== 'subs-active-block' && id !== 'subs-uncertain-block' && id !== 'subs-cancelled-block') el.innerHTML = '';
    });
    ['subs-body', 'subs-uncertain-body', 'subs-cancelled-body'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.innerHTML = '';
    });
    var updated = $('#subs-updated');
    if (updated) updated.textContent = '';
    var det = $('#subs-cancelled-block');
    if (det) det.open = false;
  }

  function b64ToBytes(b64) {
    var bin = atob(String(b64 || '').replace(/\s+/g, ''));
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function decryptSubs(envelope, passphrase) {
    if (!window.crypto || !window.crypto.subtle) return Promise.reject(new Error('no-webcrypto'));
    var kdf = envelope.kdf || {};
    var cipher = envelope.cipher || {};
    var iterations = Number(kdf.iterations);
    if (!iterations || iterations < 1) return Promise.reject(new Error('kdf'));
    var salt = b64ToBytes(kdf.salt);
    var iv = b64ToBytes(cipher.iv);
    var ct = b64ToBytes(envelope.ciphertext);
    return crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'])
      .then(function (material) {
        return crypto.subtle.deriveKey(
          { name: 'PBKDF2', salt: salt, iterations: iterations, hash: 'SHA-256' },
          material,
          { name: 'AES-GCM', length: 256 },
          false,
          ['decrypt']
        );
      })
      .then(function (key) {
        return crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, ct);
      })
      .then(function (buf) {
        var data = JSON.parse(new TextDecoder().decode(new Uint8Array(buf)));
        if (!data || data.schema !== 'subscriptions.v2' || !Array.isArray(data.items)) throw new Error('schema');
        return data;
      });
  }

  function formatMoneyNumber(n) {
    if (n == null || n === '') return '';
    var num = Number(n);
    if (!isFinite(num)) return '';
    if (Math.abs(num - Math.round(num)) < 0.001) return String(Math.round(num));
    return num.toFixed(2);
  }

  function formatAmount(row) {
    var text = formatMoneyNumber(row.amount);
    if (!text) return '—';
    return row.currency ? (text + ' ' + row.currency) : text;
  }

  function formatHkd(n) {
    var rounded = Math.round(n * 100) / 100;
    var whole = Math.abs(rounded - Math.round(rounded)) < 0.001;
    var text = whole
      ? Math.round(rounded).toLocaleString('zh-HK')
      : rounded.toLocaleString('zh-HK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return 'HK$' + text;
  }

  function intervalLabel(row) {
    if (row.interval === 'year') return '年';
    if (row.interval === 'month30') return '月（30日）';
    if (row.estimated) return '月（推算）';
    if (row.interval === 'week') return '週';
    return '月';
  }

  function monthlyHkd(row) {
    if (row.hkd == null || row.hkd === '') return null;
    var n = Number(row.hkd);
    if (!isFinite(n)) return null;
    if (row.interval === 'year') return n / 12;
    if (row.interval === 'week') return (n * 52) / 12;
    return n;
  }

  function dueText(iso, today) {
    if (!iso) return '';
    var n = daysUntil(iso, today);
    if (n === 0) return '今日';
    if (n > 0) return n + ' 日後';
    return '已過 ' + Math.abs(n) + ' 日';
  }

  function byRenew(a, b) {
    var as = a.nextRenew || '9999-99-99';
    var bs = b.nextRenew || '9999-99-99';
    if (as < bs) return -1;
    if (as > bs) return 1;
    return String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hant');
  }

  function subsRow(row, today) {
    var n = row.nextRenew ? daysUntil(row.nextRenew, today) : null;
    var soon = row.status === '使用中' && n !== null && n >= 0 && n <= 7;
    var renew = escapeHtml(row.nextRenew || '—');
    var due = dueText(row.nextRenew, today);
    if (due) renew += ' <span class="subs-due">' + escapeHtml(due) + '</span>';
    if (row.rolled) renew += ' <span class="subs-meta">已順延</span>';
    if (row.lastCharged) renew += '<div class="subs-meta">上次扣款 ' + escapeHtml(row.lastCharged) + '</div>';
    var hkdText = (row.hkd == null || row.hkd === '') ? '—' : formatMoneyNumber(row.hkd);
    return '<tr' + (soon ? ' class="subs-row-soon"' : '') + '><td>' + escapeHtml(row.name || '') +
      '</td><td>' + escapeHtml(row.plan || '—') + '</td><td>' + escapeHtml(formatAmount(row)) +
      '</td><td>' + escapeHtml(hkdText) + '</td><td>' + escapeHtml(intervalLabel(row)) +
      '</td><td>' + renew + '</td><td>' + escapeHtml(row.notes || '') + '</td></tr>';
  }

  function renderSubs(data) {
    var today = todayISO();
    var items = data.items || [];
    var active = items.filter(function (row) { return row.status === '使用中'; }).sort(byRenew);
    var cancelled = items.filter(function (row) { return row.status === '已取消'; }).sort(byRenew);
    var uncertain = items.filter(function (row) {
      return row.status !== '使用中' && row.status !== '已取消';
    }).sort(byRenew);
    var note = $('#subs-note');
    if (note) {
      if (data.demo) {
        note.textContent = '呢份係公開示例密文，唔係真實訂閱。正式數字由 Notion「訂閱追蹤」同步後先會覆蓋。';
        note.classList.remove('hidden');
      } else {
        note.textContent = '';
        note.classList.add('hidden');
      }
    }
    var updated = $('#subs-updated');
    var stamp = data.updatedAt || (subsState.envelope && subsState.envelope.updatedAt) || '';
    if (updated) updated.textContent = stamp ? ('資料更新：' + stamp) : '';
    var monthly = 0;
    var missing = 0;
    active.forEach(function (row) {
      var part = monthlyHkd(row);
      if (part == null) missing += 1;
      else monthly += part;
    });
    var totalsEl = $('#subs-totals');
    if (totalsEl) {
      totalsEl.classList.remove('hidden');
      var cards = '<div class="subs-card"><span class="muted">每月約計</span><strong>' + escapeHtml(formatHkd(monthly)) +
        '</strong></div><div class="subs-card"><span class="muted">每年約計</span><strong>' +
        escapeHtml(formatHkd(monthly * 12)) + '</strong></div>';
      if (missing) {
        cards += '<div class="subs-card"><span class="muted">未計入</span><strong>' + missing + ' 項未能折算港元</strong></div>';
      }
      totalsEl.innerHTML = cards;
    }
    var warehouses = active.filter(function (row) { return row.category === 'warehouse' && row.nextRenew; });
    var wh = $('#subs-warehouse');
    if (wh) {
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
    }
    var activeBlock = $('#subs-active-block');
    if (activeBlock) activeBlock.classList.remove('hidden');
    var body = $('#subs-body');
    if (body) {
      body.innerHTML = active.length
        ? active.map(function (row) { return subsRow(row, today); }).join('')
        : '<tr><td colspan="7">未有使用中嘅訂閱</td></tr>';
    }
    var uncertainBlock = $('#subs-uncertain-block');
    if (uncertainBlock) {
      if (uncertain.length) {
        uncertainBlock.classList.remove('hidden');
        $('#subs-uncertain-body').innerHTML = uncertain.map(function (row) { return subsRow(row, today); }).join('');
      } else {
        uncertainBlock.classList.add('hidden');
        $('#subs-uncertain-body').innerHTML = '';
      }
    }
    var cancelledBlock = $('#subs-cancelled-block');
    if (cancelledBlock) {
      if (cancelled.length) {
        cancelledBlock.classList.remove('hidden');
        var summary = $('#subs-cancelled-summary');
        if (summary) summary.textContent = '已取消（' + cancelled.length + '）';
        $('#subs-cancelled-body').innerHTML = cancelled.map(function (row) { return subsRow(row, today); }).join('');
      } else {
        cancelledBlock.classList.add('hidden');
        cancelledBlock.open = false;
      }
    }
    var status = $('#subs-status');
    if (status) status.classList.add('hidden');
  }

  function finishUnlock(data) {
    subsState.plain = data;
    var input = $('#subs-pass');
    if (input) input.value = '';
    hideSubsError();
    var form = $('#subs-gate-form');
    if (form) form.classList.add('hidden');
    var lock = $('#subs-lock');
    if (lock) lock.classList.remove('hidden');
    var btn = $('#subs-unlock');
    if (btn) { btn.disabled = false; btn.textContent = '解鎖'; }
    var status = $('#subs-status');
    if (status) status.classList.add('hidden');
    renderSubs(data);
  }

  function subsFail(err) {
    var btn = $('#subs-unlock');
    if (btn) { btn.disabled = false; btn.textContent = '解鎖'; }
    clearSubsDom();
    var form = $('#subs-gate-form');
    if (form) form.classList.remove('hidden');
    var lock = $('#subs-lock');
    if (lock) lock.classList.add('hidden');
    var status = $('#subs-status');
    if (status) status.classList.add('hidden');
    var msg = '密碼錯誤';
    if (err && err.message === 'schema') msg = '資料格式不符';
    else if (err && err.message === 'no-webcrypto') msg = '呢個瀏覽器無法解密';
    showSubsError(msg);
    var input = $('#subs-pass');
    if (input) { input.value = ''; input.focus(); }
  }

  function tryDecrypt(pass, remember) {
    var btn = $('#subs-unlock');
    if (btn) { btn.disabled = true; btn.textContent = '解密中...'; }
    hideSubsError();
    return decryptSubs(subsState.envelope, pass).then(function (data) {
      writeSubsPass(remember ? pass : '');
      finishUnlock(data);
    }).catch(function (err) {
      if (remember) {
        writeSubsPass('');
        var box = $('#subs-remember');
        if (box) box.checked = false;
      }
      subsFail(err);
    });
  }

  function lockSubs() {
    subsState.plain = null;
    writeSubsPass('');
    var box = $('#subs-remember');
    if (box) box.checked = false;
    var input = $('#subs-pass');
    if (input) input.value = '';
    hideSubsError();
    clearSubsDom();
    var form = $('#subs-gate-form');
    if (form) form.classList.remove('hidden');
    var lock = $('#subs-lock');
    if (lock) lock.classList.add('hidden');
    var status = $('#subs-status');
    if (status) status.classList.add('hidden');
    if (input) input.focus();
  }

  function loadSubs() {
    if (subsState.plain) {
      finishUnlock(subsState.plain);
      return;
    }
    var status = $('#subs-status');
    if (status) {
      status.classList.remove('hidden');
      status.innerHTML = '<p>載入中...</p>';
    }
    var form = $('#subs-gate-form');
    if (form) form.classList.add('hidden');
    fetch('data/subscriptions.enc.json', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (env) {
        if (!env || env.schema !== 'subscriptions-enc.v1' || !env.ciphertext || !env.kdf || !env.cipher) {
          throw new Error('schema');
        }
        subsState.envelope = env;
        var stored = readSubsPass();
        var box = $('#subs-remember');
        if (box) box.checked = !!stored;
        if (stored) {
          if (status) status.innerHTML = '<p>解密中...</p>';
          return tryDecrypt(stored, true);
        }
        if (status) status.classList.add('hidden');
        if (form) form.classList.remove('hidden');
      })
      .catch(function (err) {
        if (err && err.message === 'schema' && status) {
          status.classList.remove('hidden');
          status.innerHTML = '<p>資料格式不符</p>';
          return;
        }
        if (status && !subsState.plain) {
          status.classList.remove('hidden');
          status.innerHTML = '<p>載入失敗</p><p class="sub">' + escapeHtml(err && err.message ? err.message : '') + '</p>';
        }
      });
  }

  document.addEventListener('acg:module', function (e) {
    var mod = e.detail && e.detail.mod;
    var sub = (e.detail && e.detail.sub) || '';
    if (mod === 'names') loadNames();
    if (mod === 'codes') loadCodes();
    if (mod === 'events') {
      eventsState.tab = sub === 'deadlines' ? 'deadlines' : 'events';
      document.querySelectorAll('#events-tabs .tab').forEach(function (b) {
        b.classList.toggle('active', (b.dataset.eventsTab || 'events') === eventsState.tab);
      });
      loadEvents();
    }
    if (mod === 'subs') loadSubs();
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
    renderCodes();
  });
  var codesGames = $('#codes-games');
  if (codesGames) codesGames.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-game]');
    if (!btn) return;
    codesState.game = btn.getAttribute('data-game') || '';
    renderCodes();
  });
  document.querySelectorAll('#events-tabs .tab').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var tab = btn.dataset.eventsTab || 'events';
      var next = tab === 'deadlines' ? '#events/deadlines' : '#events';
      if ((location.hash || '') === next) return;
      location.hash = next;
    });
  });
  var eventBuckets = $('#events-buckets');
  if (eventBuckets) eventBuckets.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-event-bucket]');
    if (!btn) return;
    eventsState.bucket = btn.getAttribute('data-event-bucket') || 'all';
    saveEventFilters();
    renderEvents();
  });
  var featuredToggle = $('#events-featured');
  if (featuredToggle) {
    featuredToggle.checked = !!eventsState.featured;
    featuredToggle.addEventListener('change', function () {
      eventsState.featured = !!featuredToggle.checked;
      saveEventFilters();
      renderEvents();
    });
  }
  var eventsQ = $('#events-q');
  if (eventsQ) {
    eventsQ.value = eventsState.q || '';
    eventsQ.addEventListener('input', function () {
      eventsState.q = eventsQ.value || '';
      saveEventFilters();
      renderEvents();
    });
  }
  var icsBtn = $('#btn-export-ics');
  if (icsBtn) icsBtn.addEventListener('click', exportIcs);
  var subsForm = $('#subs-gate-form');
  if (subsForm) subsForm.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!subsState.envelope) return;
    var input = $('#subs-pass');
    var pass = (input && input.value || '').trim();
    if (!pass) {
      showSubsError('輸入訂閱密碼');
      if (input) input.focus();
      return;
    }
    var box = $('#subs-remember');
    tryDecrypt(pass, !!(box && box.checked));
  });
  var subsLock = $('#subs-lock');
  if (subsLock) subsLock.addEventListener('click', lockSubs);

  if (typeof window.applyAcgRoute === 'function') window.applyAcgRoute();
})();
