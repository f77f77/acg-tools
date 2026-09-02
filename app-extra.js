(function () {
  function $(s) { return document.querySelector(s); }
  function $$(s) { return document.querySelectorAll(s); }

  // Apple Music 預設收埋
  (function initSidebarPlayer() {
    const wrap = $('#sidebar-player');
    const btn = $('#btn-toggle-player');
    const iframe = $('#am-player');
    if (!wrap || !btn) return;
    function setPlayerOpen(open) {
      wrap.classList.toggle('collapsed', !open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open && iframe && !iframe.dataset.loaded) {
        const src = iframe.dataset.src;
        if (src) iframe.src = src;
        iframe.dataset.loaded = '1';
      }
      try { localStorage.setItem('acg_player_open', open ? '1' : '0'); } catch (e) {}
    }
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      setPlayerOpen(wrap.classList.contains('collapsed'));
    });
    let saved = '0';
    try { saved = localStorage.getItem('acg_player_open') || '0'; } catch (e) {}
    setPlayerOpen(saved === '1');
  })();

  // 漢堡鍵：桌面只用側欄鍵摺盤；手機只用 topbar 鍵開關
  (function unifyHamburger() {
    const openBtn = $('#btn-open-sidebar');
    if (!openBtn) return;
    openBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopImmediatePropagation();
      const sidebar = $('#sidebar');
      const mainWrap = $('#main-wrap');
      if (!sidebar) return;
      if (window.innerWidth <= 768) {
        sidebar.classList.toggle('open');
      } else {
        const willCollapse = !sidebar.classList.contains('collapsed');
        sidebar.classList.toggle('collapsed', willCollapse);
        if (mainWrap) mainWrap.classList.toggle('expanded', willCollapse);
      }
    }, true);
  })();

  // 覆蓋卡片列表：加編輯
  const _render = window.renderCardsList;
  window.renderCardsList = function renderCardsList() {
    const listEl = $('#cards-list');
    const emptyEl = $('#cards-empty');
    const countEl = $('#cards-count');
    const search = ($('#search-input') && $('#search-input').value || '').trim().toLowerCase();
    let filtered = cards;
    if (search) {
      filtered = filtered.filter(function (c) {
        return c.word.toLowerCase().includes(search) || c.meaning.toLowerCase().includes(search) ||
          c.reading.toLowerCase().includes(search) || (c.example || '').toLowerCase().includes(search);
      });
    }
    if (countEl) {
      countEl.textContent = search ? ('顯示 ' + filtered.length + ' / 共 ' + cards.length + ' 張') : ('共 ' + cards.length + ' 張');
    }
    if (!filtered.length) {
      listEl.innerHTML = '';
      if (emptyEl) emptyEl.classList.remove('hidden');
      return;
    }
    if (emptyEl) emptyEl.classList.add('hidden');
    filtered = filtered.slice().sort(function (a, b) { return b.createdAt - a.createdAt; });
    listEl.innerHTML = filtered.map(function (c) {
      return '<div class="card-item" data-id="' + c.id + '">' +
        '<div class="card-item-main">' +
        '<div class="word">' + escapeHtml(c.word) + '</div>' +
        (c.reading ? '<div class="reading">' + escapeHtml(c.reading) + '</div>' : '') +
        '<div class="meaning">' + escapeHtml(c.meaning) + '</div>' +
        '<div class="meta">複習 ' + c.reps + ' 次 · ' + formatNextReview(c.nextReview) + '</div>' +
        '</div>' +
        '<div class="card-item-actions">' +
        '<button class="btn-tts-sm" data-tts title="朗讀">🔊</button>' +
        '<button class="btn-edit" data-edit title="編輯">✎</button>' +
        '<button class="btn-delete" title="刪除">🗑</button>' +
        '</div></div>';
    }).join('');
    listEl.querySelectorAll('.btn-delete').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        const id = String(e.target.closest('.card-item').dataset.id);
        if (confirm('確定刪除呢張卡片？')) {
          sbDelete(id).then(function () {
            cards = cards.filter(function (c) { return String(c.id) !== id; });
            renderCardsList();
          }).catch(function (err) { alert('刪除失敗: ' + err.message); });
        }
      });
    });
    listEl.querySelectorAll('[data-edit]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        const id = String(e.target.closest('.card-item').dataset.id);
        const card = cards.find(function (c) { return String(c.id) === id; });
        if (card) openEditModal(card);
      });
    });
    listEl.querySelectorAll('[data-tts]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        const id = String(e.target.closest('.card-item').dataset.id);
        const card = cards.find(function (c) { return String(c.id) === id; });
        if (card) speakCard(card);
      });
    });
  };

  window.openEditModal = function (card) {
    $('#edit-id').value = card.id;
    $('#edit-word').value = card.word || '';
    $('#edit-reading').value = card.reading || '';
    $('#edit-meaning').value = card.meaning || '';
    $('#edit-example').value = card.example || '';
    $('#modal-edit').classList.remove('hidden');
  };
  function closeEditModal() {
    var m = $('#modal-edit');
    if (m) m.classList.add('hidden');
  }
  var cancel = $('#btn-edit-cancel');
  if (cancel) cancel.addEventListener('click', closeEditModal);
  var form = $('#edit-form');
  if (form) form.addEventListener('submit', function (e) {
    e.preventDefault();
    const id = String($('#edit-id').value || '');
    const card = cards.find(function (c) { return String(c.id) === id; });
    if (!card) return;
    const word = ($('#edit-word').value || '').trim();
    const reading = ($('#edit-reading').value || '').trim();
    const meaning = ($('#edit-meaning').value || '').trim();
    const example = ($('#edit-example').value || '').trim();
    if (!word || !meaning) return;
    const dup = cards.some(function (c) { return String(c.id) !== id && normWord(c.word) === normWord(word); });
    if (dup) { alert('呢個單字已經存在於另一張卡。'); return; }
    card.word = word; card.reading = reading; card.meaning = meaning; card.example = example;
    sbUpdate(card).then(function () {
      closeEditModal();
      renderCardsList();
    }).catch(function (err) { alert('儲存失敗: ' + err.message); });
  });

  // 本地 season.json
  window.loadSeason = async function loadSeason(force) {
    if (window.__seasonLoaded && !force) return;
    const loading = $('#season-loading');
    const error = $('#season-error');
    const content = $('#season-content');
    if (loading) loading.classList.remove('hidden');
    if (error) error.classList.add('hidden');
    if (content) content.classList.add('hidden');
    try {
      const res = await fetch('season.json' + (force ? ('?t=' + Date.now()) : ''), { cache: force ? 'no-store' : 'default' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const payload = await res.json();
      const data = Array.isArray(payload) ? payload : (payload.days || []);
      renderSeason(data);
      window.__seasonLoaded = true;
      const stamp = payload && payload.updated_at ? new Date(payload.updated_at).toLocaleString('zh-HK') : new Date().toLocaleString('zh-HK');
      if ($('#season-updated')) $('#season-updated').textContent = '資料更新於 ' + stamp;
      if (loading) loading.classList.add('hidden');
      if (content) content.classList.remove('hidden');
    } catch (err) {
      if (loading) loading.classList.add('hidden');
      if (error) error.classList.remove('hidden');
      if ($('#season-error-msg')) $('#season-error-msg').textContent = err.message || String(err);
    }
  };

  document.addEventListener('keydown', function (e) {
    if (e.target.matches('input, textarea, select')) return;
    const reviewOn = $('#module-vocab') && $('#module-vocab').classList.contains('active') &&
      $('#vocab-review') && $('#vocab-review').classList.contains('active') &&
      $('#review-card') && !$('#review-card').classList.contains('hidden');
    if (reviewOn && currentCard) {
      if (!isRevealed && (e.key === ' ' || e.key === 'Enter' || e.code === 'Space')) {
        e.preventDefault();
        revealAnswer();
        return;
      }
      if (isRevealed) {
        const gradeMap = { '1': 'again', '2': 'hard', '3': 'good', '4': 'easy' };
        if (gradeMap[e.key]) {
          e.preventDefault();
          gradeCard(gradeMap[e.key]);
        }
      }
    }
  });
})();
