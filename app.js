
// ==================== Password gate hook ====================
// 實際解鎖邏輯在 index.html 內聯 script；這裡只負責解鎖後初始化
window.__acgAppReady = false;
window.onAcgUnlocked = function () {
  // 只標記已解鎖；真正 init 等 app.js 尾 __acgAppReady = true
  window.__acgUnlocked = true;
  var app = document.getElementById('app');
  if (app) {
    app.classList.remove('app-locked');
    app.style.display = 'flex';
    app.style.visibility = 'visible';
  }
  var gate = document.getElementById('gate');
  if (gate) {
    gate.classList.add('hidden');
    gate.style.display = 'none';
  }
  tryStartVocab();
};
function tryStartVocab() {
  if (!window.__acgUnlocked || !window.__acgAppReady) return;
  if (window.__vocabInited) return;
  window.__vocabInited = true;
  if (typeof initVocab === 'function') {
    initVocab();
  }
}
(function () {
  // 若 HTML 已解鎖，只更新 UI；唔好喺 SB_URL 未 ready 時 init
  if (window.__acgUnlocked) {
    window.onAcgUnlocked();
  }
})();

// ==================== Utils ====================
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ==================== Sidebar ====================
const sidebar = $('#sidebar');
const mainWrap = $('#main-wrap');

function setSidebarOpen(open) {
  if (window.innerWidth <= 768) {
    sidebar.classList.toggle('open', open);
  } else {
    sidebar.classList.toggle('collapsed', !open);
    mainWrap.classList.toggle('expanded', !open);
  }
}

$('#btn-toggle-sidebar')?.addEventListener('click', () => {
  const isCollapsed = sidebar.classList.contains('collapsed') || !sidebar.classList.contains('open') && window.innerWidth <= 768;
  if (window.innerWidth <= 768) {
    sidebar.classList.toggle('open');
  } else {
    sidebar.classList.toggle('collapsed');
    mainWrap.classList.toggle('expanded');
  }
});

$('#btn-open-sidebar')?.addEventListener('click', () => {
  sidebar.classList.add('open');
});

// Close sidebar on mobile when clicking nav
$$('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    if (window.innerWidth <= 768) sidebar.classList.remove('open');
  });
});

// Module switch
$$('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    const mod = btn.dataset.module;
    $$('.nav-item').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    $$('.module').forEach(m => m.classList.remove('active'));
    $(`#module-${mod}`)?.classList.add('active');
    $('#page-title').textContent = ({ vocab: '生詞本', season: '新番表', fx: '匯率計算' })[mod] || mod;
    if (mod === 'fx') loadFx();
    if (mod === 'season') loadSeason();
    if (mod === 'vocab') startReview();
  });
});


// ==================== TTS ====================
function speakJapanese(text) {
  if (!text || !window.speechSynthesis) {
    alert('呢個瀏覽器唔支援語音朗讀');
    return;
  }
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ja-JP';
  u.rate = 0.9;
  // 盡量揀日文 voice
  const voices = window.speechSynthesis.getVoices();
  const ja = voices.find(v => v.lang.startsWith('ja'));
  if (ja) u.voice = ja;
  window.speechSynthesis.speak(u);
}

function ttsTextForCard(card) {
  if (!card) return '';
  // 有讀音就讀「單字。讀音」，否則只讀單字
  if (card.reading) return card.word + '。' + card.reading;
  return card.word;
}

// ==================== VOCAB MODULE ====================
const SB_URL = 'https://qfeejmpjexgoamalnxzy.supabase.co/rest/v1/cards';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZWVqbXBqZXhnb2FtYWxueHp5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczMjQ5ODcsImV4cCI6MjEwMjkwMDk4N30.PtNO0FPdXy1rA8_LjPDo7pfHZYfarmI0tc1OplQ7x7A';
const SB_HEADERS = {
  'apikey': SB_KEY,
  'Authorization': 'Bearer ' + SB_KEY,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation'
};

function rowToCard(row) {
  return {
    id: row.id,
    word: row.word || '',
    reading: row.reading || '',
    meaning: row.meaning || '',
    example: row.example || '',
    reps: row.reps || 0,
    interval: row.interval_min || 0,
    ease: row.ease != null ? row.ease : 2.5,
    nextReview: row.next_review ? new Date(row.next_review).getTime() : Date.now(),
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now()
  };
}

function cardToRow(card) {
  return {
    word: card.word,
    reading: card.reading || '',
    meaning: card.meaning,
    example: card.example || '',
    reps: card.reps || 0,
    interval_min: card.interval || 0,
    ease: card.ease != null ? card.ease : 2.5,
    next_review: new Date(card.nextReview || Date.now()).toISOString(),
    updated_at: new Date().toISOString()
  };
}

async function sbFetchAll() {
  const res = await fetch(SB_URL + '?select=*&order=created_at.desc', { headers: SB_HEADERS });
  if (!res.ok) throw new Error('載入失敗: ' + res.status);
  const rows = await res.json();
  return rows.map(rowToCard);
}

async function sbInsert(card) {
  const body = cardToRow(card);
  const res = await fetch(SB_URL, {
    method: 'POST',
    headers: SB_HEADERS,
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error('新增失敗: ' + t);
  }
  const rows = await res.json();
  return rowToCard(rows[0]);
}

async function sbUpdate(card) {
  const body = cardToRow(card);
  const res = await fetch(SB_URL + '?id=eq.' + encodeURIComponent(card.id), {
    method: 'PATCH',
    headers: SB_HEADERS,
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error('更新失敗: ' + t);
  }
  return true;
}

async function sbDelete(id) {
  const res = await fetch(SB_URL + '?id=eq.' + encodeURIComponent(id), {
    method: 'DELETE',
    headers: SB_HEADERS
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error('刪除失敗: ' + t);
  }
  return true;
}

function normWord(w) {
  return (w || '').trim().normalize('NFKC').toLowerCase();
}
function isDuplicateWord(word, list) {
  const n = normWord(word);
  return (list || cards).some(c => normWord(c.word) === n);
}

let cards = [];
let currentReviewQueue = [];
let currentCard = null;
let isRevealed = false;
let pendingImport = [];
let vocabReady = false;

async function initVocab() {
  try {
    cards = await sbFetchAll();
    vocabReady = true;
    startReview();
  } catch (e) {
    console.error(e);
    alert('無法連接 Supabase 生詞庫：' + e.message);
    cards = [];
    vocabReady = true;
    startReview();
  }
}

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function getDueCards() {
  const now = Date.now();
  const due = cards.filter(c => c.nextReview <= now);
  const seen = new Set();
  const unique = due.filter(c => {
    const k = normWord(c.word);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return shuffleArray(unique);
}

function showReviewSetup() {
  const due = getDueCards();
  const setup = $('#review-setup');
  const emptyEl = $('#review-empty');
  const cardEl = $('#review-card');
  cardEl?.classList.add('hidden');
  currentReviewQueue = [];
  currentCard = null;
  if (due.length === 0) {
    setup?.classList.add('hidden');
    emptyEl?.classList.remove('hidden');
    return;
  }
  emptyEl?.classList.add('hidden');
  setup?.classList.remove('hidden');
  const hint = $('#review-due-hint');
  if (hint) hint.textContent = '到期可複習：' + due.length + ' 張';
}

function beginReviewSession(limit) {
  const due = getDueCards();
  if (!due.length) {
    showReviewSetup();
    return;
  }
  const n = limit == null ? due.length : Math.min(limit, due.length);
  currentReviewQueue = due.slice(0, n);
  isRevealed = false;
  $('#review-setup')?.classList.add('hidden');
  showNextCard();
}

function startReview() {
  showReviewSetup();
}

function showNextCard() {
  const emptyEl = $('#review-empty');
  const cardEl = $('#review-card');
  const setup = $('#review-setup');
  if (currentReviewQueue.length === 0) {
    cardEl?.classList.add('hidden');
    showReviewSetup();
    return;
  }
  setup?.classList.add('hidden');
  emptyEl?.classList.add('hidden');
  cardEl?.classList.remove('hidden');
  $('#review-actions-front')?.classList.remove('hidden');
  $('#review-actions-back')?.classList.add('hidden');
  currentCard = currentReviewQueue[0];
  isRevealed = false;
  $('#card-word').textContent = currentCard.word;
  $('#card-reading').textContent = currentCard.reading || '';
  $('#card-meaning').textContent = currentCard.meaning;
  $('#card-example').textContent = currentCard.example || '';
  $('.card-back')?.classList.add('hidden');
  $('#review-count').textContent = currentReviewQueue.length;
}

// Vocab tabs
$$('[data-vocab-view]').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('[data-vocab-view]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    $$('.vocab-view').forEach(v => v.classList.remove('active'));
    const view = btn.dataset.vocabView;
    $('#vocab-' + view)?.classList.add('active');
    if (view === 'review') startReview();
    if (view === 'cards') renderCardsList();
  });
});

// ========== Anki-like SM-2（簡化接近官方預設）==========
// Learning steps: 1m → 10m → graduate
// Graduating interval: 1 day | Easy interval: 4 days
// Starting ease: 2.5 | Easy bonus: 1.3 | Hard factor: 1.2
// Min ease: 1.3 | Again (lapse): relearn 10m, ease −0.20
const MIN = 1;
const HOUR = 60;
const DAY = 60 * 24;
const LEARN_STEPS = [1, 10];          // 分鐘
const GRADUATING_INTERVAL = 1 * DAY;  // Good 畢業 → 1 日
const EASY_INTERVAL = 4 * DAY;        // Easy 畢業 → 4 日
const START_EASE = 2.5;
const MIN_EASE = 1.3;
const HARD_FACTOR = 1.2;
const EASY_BONUS = 1.3;
const LAPSE_RELEARN = 10;             // Again 後先入 10 分鐘重學

function formatInterval(mins) {
  if (mins == null || mins < 0) return '';
  if (mins < 1) return '<1 分';
  if (mins < 60) return Math.round(mins) + ' 分';
  if (mins < DAY) {
    const h = mins / 60;
    return (h < 10 ? h.toFixed(1).replace(/\.0$/, '') : Math.round(h)) + ' 小時';
  }
  const d = mins / DAY;
  if (d < 30) return (d < 10 ? d.toFixed(1).replace(/\.0$/, '') : Math.round(d)) + ' 日';
  const mo = d / 30;
  return (mo < 10 ? mo.toFixed(1).replace(/\.0$/, '') : Math.round(mo)) + ' 個月';
}

/** 是否仍在學習／重學階段（未畢業成「複習卡」） */
function isLearning(card) {
  const prev = card.interval || 0;
  // 間隔仍短於 1 日 → 視為 learning / relearning
  return prev < DAY;
}

/**
 * 預覽四個評分嘅下次間隔（分鐘）— 接近 Anki 預設行為
 */
function previewIntervals(card) {
  const prev = card.interval || 0;
  const ease = card.ease != null ? card.ease : START_EASE;
  const learning = isLearning(card);

  let again, hard, good, easy;

  if (learning) {
    // —— 學習步驟 ——
    // 而家步驟：若 prev < 1 → step0；若 prev < 10 → 當完成咗 1m；否則接近畢業
    let stepIdx = 0;
    if (prev >= LEARN_STEPS[0] && prev < LEARN_STEPS[1]) stepIdx = 1;
    else if (prev >= LEARN_STEPS[1]) stepIdx = 2;

    again = LEARN_STEPS[0]; // 1 分，重頭

    // Hard：停留／略延長而家步
    if (stepIdx === 0) hard = LEARN_STEPS[0];
    else if (stepIdx === 1) hard = LEARN_STEPS[1];
    else hard = Math.max(LEARN_STEPS[1], Math.round(prev * HARD_FACTOR));

    // Good：下一步；已係最後步 → 畢業 1 日
    if (stepIdx <= 0) good = LEARN_STEPS[1];       // 1m → 10m
    else good = GRADUATING_INTERVAL;                 // → 1 日

    // Easy：直接畢業去 easy interval
    easy = EASY_INTERVAL;
  } else {
    // —— 複習卡（Review）——
    again = LAPSE_RELEARN; // 10 分重學（之後再 graduate）

    hard = Math.max(DAY, Math.round(prev * HARD_FACTOR));
    // Anki Hard 唔會低過一日（對 review 卡）常見行為：至少保持合理
    hard = Math.round(prev * HARD_FACTOR);
    if (hard < DAY) hard = Math.max(prev, Math.round(DAY * 0.5)); // 略短都得，但唔好太短

    good = Math.max(DAY, Math.round(prev * ease));

    easy = Math.max(EASY_INTERVAL, Math.round(prev * ease * EASY_BONUS));
  }

  const CAP = 365 * DAY;
  return {
    again: Math.min(again, CAP),
    hard: Math.min(hard, CAP),
    good: Math.min(good, CAP),
    easy: Math.min(easy, CAP)
  };
}

function updateGradeButtonLabels(card) {
  const p = previewIntervals(card || {});
  const map = { again: p.again, hard: p.hard, good: p.good, easy: p.easy };
  Object.keys(map).forEach(g => {
    const el = document.getElementById('grade-time-' + g);
    if (el) el.textContent = formatInterval(map[g]);
  });
}

function revealAnswer() {
  isRevealed = true;
  $('.card-back')?.classList.remove('hidden');
  $('#review-actions-front')?.classList.add('hidden');
  $('#review-actions-back')?.classList.remove('hidden');
  if (currentCard) updateGradeButtonLabels(currentCard);
}

function gradeCard(grade) {
  if (!currentCard) return;
  const now = Date.now();
  const wasLearning = isLearning(currentCard);
  const planned = previewIntervals(currentCard);
  let intervalMin = planned[grade] || planned.good;
  let ease = currentCard.ease != null ? currentCard.ease : START_EASE;

  if (grade === 'again') {
    // Lapse：ease −0.20，重入學習（短間隔）；reps 重置
    ease = Math.max(MIN_EASE, ease - 0.2);
    currentCard.reps = 0;
  } else if (grade === 'hard') {
    ease = Math.max(MIN_EASE, ease - 0.15);
    if (!wasLearning) currentCard.reps = (currentCard.reps || 0) + 1;
  } else if (grade === 'good') {
    currentCard.reps = (currentCard.reps || 0) + 1;
    // Good 唔改 ease（Anki 預設）
  } else if (grade === 'easy') {
    currentCard.reps = (currentCard.reps || 0) + 1;
    ease = Math.min(3.0, ease + 0.15);
  }

  currentCard.ease = ease;
  currentCard.interval = intervalMin;
  currentCard.nextReview = now + intervalMin * 60 * 1000;

  const idx = cards.findIndex(c => c.id === currentCard.id);
  if (idx !== -1) cards[idx] = currentCard;

  sbUpdate(currentCard).catch(e => alert('同步失敗: ' + e.message));

  const graded = currentCard;
  currentReviewQueue.shift();

  // Again：插到隊列最後 10 張範圍內（避免即刻再出同一張）
  if (grade === 'again') {
    const len = currentReviewQueue.length;
    const windowStart = Math.max(0, len - 9); // 最後最多 10 個位置：index windowStart .. len
    const insertAt = windowStart + Math.floor(Math.random() * (len - windowStart + 1));
    currentReviewQueue.splice(insertAt, 0, graded);
  }

  showNextCard();
}

$('#btn-reveal')?.addEventListener('click', revealAnswer);
$('#btn-tts')?.addEventListener('click', (e) => {
  e.stopPropagation();
  if (currentCard) speakJapanese(ttsTextForCard(currentCard));
});
$('#flashcard')?.addEventListener('dblclick', () => {
  if (currentCard) speakJapanese(ttsTextForCard(currentCard));
});
$('#flashcard')?.addEventListener('click', () => { if (!isRevealed) revealAnswer(); });
$$('[data-grade]').forEach(btn => btn.addEventListener('click', () => gradeCard(btn.dataset.grade)));

function formatNextReview(ts) {
  const diff = ts - Date.now();
  if (diff <= 0) return '而家可複習';
  const mins = Math.round(diff / 60000);
  if (mins < 60) return mins + ' 分鐘後';
  const hours = Math.round(mins / 60);
  if (hours < 24) return hours + ' 小時後';
  return Math.round(hours / 24) + ' 日後';
}

function renderCardsList() {
  const listEl = $('#cards-list');
  const emptyEl = $('#cards-empty');
  const countEl = $('#cards-count');
  const search = ($('#search-input')?.value || '').trim().toLowerCase();
  let filtered = cards;
  if (search) {
    filtered = filtered.filter(c =>
      c.word.toLowerCase().includes(search) || c.meaning.toLowerCase().includes(search) ||
      c.reading.toLowerCase().includes(search) || (c.example||'').toLowerCase().includes(search)
    );
  }
  if (countEl) {
    countEl.textContent = search
      ? `顯示 ${filtered.length} / 共 ${cards.length} 張`
      : `共 ${cards.length} 張`;
  }
  if (filtered.length === 0) {
    listEl.innerHTML = '';
    emptyEl?.classList.remove('hidden');
    return;
  }
  emptyEl?.classList.add('hidden');
  filtered = [...filtered].sort((a,b) => b.createdAt - a.createdAt);
  listEl.innerHTML = filtered.map(c => `
    <div class="card-item" data-id="${c.id}">
      <div class="card-item-main">
        <div class="word">${escapeHtml(c.word)}</div>
        ${c.reading ? `<div class="reading">${escapeHtml(c.reading)}</div>` : ''}
        <div class="meaning">${escapeHtml(c.meaning)}</div>
        <div class="meta">複習 ${c.reps} 次 · ${formatNextReview(c.nextReview)}</div>
      </div>
      <div class="card-item-actions">
        <button class="btn-tts-sm" data-tts title="朗讀">🔊</button>
        <button class="btn-delete" title="刪除">🗑</button>
      </div>
    </div>
  `).join('');
  listEl.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.target.closest('.card-item').dataset.id;
      if (confirm('確定刪除呢張卡片？')) {
        sbDelete(id).then(() => {
          cards = cards.filter(c => c.id !== id);
          renderCardsList();
        }).catch(e => alert('刪除失敗: ' + e.message));
      }
    });
  });
  listEl.querySelectorAll('[data-tts]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.target.closest('.card-item').dataset.id;
      const card = cards.find(c => c.id === id);
      if (card) speakJapanese(ttsTextForCard(card));
    });
  });
}
$('#search-input')?.addEventListener('input', renderCardsList);

$('#add-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const word = $('#input-word').value;
  const reading = $('#input-reading').value;
  const meaning = $('#input-meaning').value;
  const example = $('#input-example').value;
  if (!word || !meaning) return;
  if (isDuplicateWord(word)) {
    alert('呢個單字已經存在，唔會重複加入。');
    return;
  }
  try {
    const card = await sbInsert({
      word, reading, meaning, example,
      reps: 0, interval: 0, ease: 2.5, nextReview: Date.now()
    });
    cards.unshift(card);
    $('#add-form').reset();
    alert('已加入（已同步雲端）！');
  } catch (err) {
    alert(err.message);
  }
});

// CSV parse
function parseCSVLine(line) {
  const result = []; let current = ''; let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i+1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) { result.push(current.trim()); current = ''; }
    else current += char;
  }
  result.push(current.trim());
  return result;
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return [];
  const first = lines[0].toLowerCase();
  const hasHeader = first.includes('日文') || first.includes('單字') || first.includes('平假名') || first.includes('中文');
  const dataLines = hasHeader ? lines.slice(1) : lines;
  const results = [];
  for (const line of dataLines) {
    const parts = parseCSVLine(line);
    if (parts.length < 2) continue;
    const word = parts[0] || '';
    let reading = parts[1] || '';
    let meaning = parts[2] || '';
    const example = parts.slice(3).join(', ') || '';
    if (word && (meaning || reading)) {
      if (!meaning && reading && /[\u4e00-\u9fff]/.test(reading)) { meaning = reading; reading = ''; }
      results.push({ word, reading, meaning: meaning || reading, example });
    }
  }
  return results;
}

function parseTableText(text) {
  if (text.includes(',') && (text.includes('\n') || text.includes('\r'))) {
    const r = parseCSV(text);
    if (r.length) return r;
  }
  const lines = text.trim().split('\n').map(l => l.trim()).filter(Boolean);
  const results = [];
  for (const line of lines) {
    let parts = line.split(/\t|\||｜/).map(p => p.trim()).filter(Boolean);
    if (parts.length < 2) parts = line.split(/\s{2,}/).map(p => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      let word = parts[0], reading = '', meaning = '', example = '';
      if (parts.length === 2) { meaning = parts[1]; }
      else if (parts.length === 3) {
        if (/^[\u3040-\u309F\u30A0-\u30FF\sー]+$/.test(parts[1])) { reading = parts[1]; meaning = parts[2]; }
        else { meaning = parts[1]; example = parts[2]; }
      } else { reading = parts[1]; meaning = parts[2]; example = parts.slice(3).join(' '); }
      if (word && meaning) results.push({ word, reading, meaning, example });
    }
  }
  return results;
}

function showImportPreview(items) {
  pendingImport = items;
  $('#import-preview').innerHTML = items.map((item, i) => `
    <div class="import-preview-item">
      <strong>${i+1}. ${escapeHtml(item.word)}</strong>
      ${item.reading ? `（${escapeHtml(item.reading)}）` : ''} → ${escapeHtml(item.meaning)}
      ${item.example ? `<br><small>${escapeHtml(item.example.slice(0,80))}${item.example.length>80?'…':''}</small>` : ''}
    </div>
  `).join('');
  $('#modal-import').classList.remove('hidden');
}

$('#btn-parse-paste')?.addEventListener('click', () => {
  const text = $('#paste-input').value;
  if (!text.trim()) { alert('請先貼上內容'); return; }
  const items = parseTableText(text);
  if (!items.length) { alert('解析唔到有效資料'); return; }
  showImportPreview(items);
});

$('#btn-import-confirm')?.addEventListener('click', async () => {
  const count = pendingImport.length;
  let added = 0;
  let skipped = 0;
  // 重新由雲端拉最新，避免重複
  try {
    cards = await sbFetchAll();
  } catch (e) {
    console.error(e);
  }
  const existing = new Set(cards.map(c => normWord(c.word)));
  // 同一批 CSV 內部亦去重
  const batchSeen = new Set();
  for (const item of pendingImport) {
    const key = normWord(item.word);
    if (!key || existing.has(key) || batchSeen.has(key)) {
      skipped++;
      continue;
    }
    batchSeen.add(key);
    try {
      const card = await sbInsert({
        ...item, reps: 0, interval: 0, ease: 2.5, nextReview: Date.now()
      });
      cards.unshift(card);
      existing.add(key);
      added++;
    } catch (err) {
      console.error(err);
      skipped++;
    }
  }
  $('#modal-import').classList.add('hidden');
  $('#paste-input').value = '';
  pendingImport = [];
  alert('成功加入 ' + added + ' 張' + (skipped ? '，略過重複／失敗 ' + skipped + ' 張' : '') + '。而家共 ' + cards.length + ' 張。');
  $$('[data-vocab-view]').forEach(b => b.classList.remove('active'));
  document.querySelector('[data-vocab-view="cards"]')?.classList.add('active');
  $$('.vocab-view').forEach(v => v.classList.remove('active'));
  $('#vocab-cards')?.classList.add('active');
  renderCardsList();
});

$('#btn-import-cancel')?.addEventListener('click', () => {
  $('#modal-import').classList.add('hidden');
  pendingImport = [];
});

$('#btn-import-file')?.addEventListener('click', () => $('#file-input').click());
$('#file-input')?.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const items = parseCSV(ev.target.result);
    if (!items.length) { alert('CSV 解析失敗'); return; }
    showImportPreview(items);
  };
  reader.readAsText(file, 'UTF-8');
  e.target.value = '';
});

$('#btn-export')?.addEventListener('click', () => {
  if (!cards.length) { alert('未有卡片可匯出'); return; }
  const header = '日文單字,平假名/讀音,中文意思,例句 / 備註';
  const rows = cards.map(c => {
    const esc = (s) => {
      if (!s) return '';
      if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"';
      return s;
    };
    return [esc(c.word), esc(c.reading), esc(c.meaning), esc(c.example)].join(',');
  });
  const csv = '\uFEFF' + [header, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'ln-vocab-' + new Date().toISOString().slice(0,10) + '.csv';
  a.click();
});

$('#btn-stats')?.addEventListener('click', () => {
  const total = cards.length;
  const due = getDueCards().length;
  const totalReps = cards.reduce((s,c) => s + c.reps, 0);
  $('#stats-content').innerHTML = `
    <div class="stat-row"><span>總卡片數</span><strong>${total}</strong></div>
    <div class="stat-row"><span>而家到期可複習</span><strong>${due}</strong></div>
    <div class="stat-row"><span>總複習次數</span><strong>${totalReps}</strong></div>
  `;
  $('#modal-stats').classList.remove('hidden');
});
$('#btn-stats-close')?.addEventListener('click', () => $('#modal-stats').classList.add('hidden'));
$$('.modal').forEach(m => m.addEventListener('click', e => { if (e.target === m) m.classList.add('hidden'); }));

// ==================== SEASON MODULE (Bangumi) ====================
const BGM_CALENDAR = 'https://api.bgm.tv/calendar';
let seasonLoaded = false;

async function loadSeason(force = false) {
  if (seasonLoaded && !force) return;
  const loading = $('#season-loading');
  const error = $('#season-error');
  const content = $('#season-content');
  loading?.classList.remove('hidden');
  error?.classList.add('hidden');
  content?.classList.add('hidden');

  try {
    const res = await fetch(BGM_CALENDAR, {
      headers: { 'User-Agent': 'ACG-Tools/1.0 (personal; https://github.com/)' }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    renderSeason(data);
    seasonLoaded = true;
    $('#season-updated').textContent = '更新於 ' + new Date().toLocaleString('zh-HK');
    loading?.classList.add('hidden');
    content?.classList.remove('hidden');
  } catch (err) {
    loading?.classList.add('hidden');
    error?.classList.remove('hidden');
    $('#season-error-msg').textContent = err.message || String(err);
  }
}

function renderSeason(data) {
  // data is array of { weekday: {en,cn,ja,id}, items: [...] }
  const container = $('#season-content');
  if (!Array.isArray(data) || !data.length) {
    container.innerHTML = '<div class="empty-state"><p>暫無資料</p></div>';
    return;
  }

  // Bangumi: 1=Mon ... 7=Sun; JS getDay(): 0=Sun, 1=Mon ... 6=Sat
  const jsDay = new Date().getDay();
  const todayBgmId = jsDay === 0 ? 7 : jsDay;

  const sorted = [...data].sort((a, b) => {
    const idA = a.weekday?.id || 0;
    const idB = b.weekday?.id || 0;
    // Put today first
    if (idA === todayBgmId && idB !== todayBgmId) return -1;
    if (idB === todayBgmId && idA !== todayBgmId) return 1;
    // Then order starting from today (today, tomorrow, ... wrap around)
    const relA = (idA - todayBgmId + 7) % 7;
    const relB = (idB - todayBgmId + 7) % 7;
    return relA - relB;
  });

  container.innerHTML = sorted.map(day => {
    const items = day.items || [];
    if (!items.length) return '';
    const id = day.weekday?.id || 0;
    const isToday = id === todayBgmId;
    const dayName = day.weekday?.cn || day.weekday?.ja || day.weekday?.en || '其他';
    const titleExtra = isToday ? ' · 今日' : '';
    return `
      <div class="weekday-section${isToday ? ' weekday-today' : ''}">
        <div class="weekday-title">${escapeHtml(dayName)}${titleExtra}（${items.length} 部）</div>
        <div class="anime-grid">
          ${items.map(item => {
            const name = item.name_cn || item.name || '未知';
            const cover = item.images?.large || item.images?.common || item.images?.medium || '';
            const airDate = item.air_date || '';
            const score = item.rating?.score ? item.rating.score.toFixed(1) : '';
            const url = item.url || (item.id ? 'https://bgm.tv/subject/' + item.id : '#');
            return `
              <a class="anime-card" href="${escapeHtml(url)}" target="_blank" rel="noopener">
                ${cover ? `<img class="anime-cover" src="${escapeHtml(cover)}" alt="" loading="lazy" onerror="this.style.display='none'" />` : '<div class="anime-cover"></div>'}
                <div class="anime-info">
                  <div class="anime-name" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
                  ${airDate ? `<div class="anime-date">${escapeHtml(airDate)}</div>` : ''}
                  ${score ? `<div class="anime-score">★ ${score}</div>` : ''}
                </div>
              </a>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }).join('');
}

$('#btn-refresh-season')?.addEventListener('click', () => loadSeason(true));
$('#btn-retry-season')?.addEventListener('click', () => loadSeason(true));


// ==================== FX MODULE ====================
const FX_API = 'https://open.er-api.com/v6/latest/';
const FX_CURRENCIES = ['HKD', 'CNY', 'JPY', 'USD', 'EUR', 'TWD'];
const FX_NAMES = { HKD: '港幣', CNY: '人民幣', JPY: '日元', USD: '美元', EUR: '歐元', TWD: '台幣' };

let fxRates = null; // { base, rates, updated }
let fxBaseCache = {}; // base -> rates object

async function fetchFxBase(base) {
  if (fxBaseCache[base] && Date.now() - fxBaseCache[base]._ts < 60 * 60 * 1000) {
    return fxBaseCache[base];
  }
  const res = await fetch(FX_API + base);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  if (data.result !== 'success') throw new Error(data['error-type'] || 'API error');
  const packed = { base: data.base_code, rates: data.rates, updated: data.time_last_update_utc, _ts: Date.now() };
  fxBaseCache[base] = packed;
  return packed;
}

async function loadFx(force) {
  const loading = $('#fx-loading');
  const error = $('#fx-error');
  if (force) fxBaseCache = {};
  loading?.classList.remove('hidden');
  error?.classList.add('hidden');
  try {
    const from = $('#fx-from')?.value || 'HKD';
    fxRates = await fetchFxBase(from);
    $('#fx-updated').textContent = '更新於 ' + (fxRates.updated || '');
    loading?.classList.add('hidden');
    computeFx();
    renderFxQuick();
    updateHotkeyActive(from);
  } catch (err) {
    loading?.classList.add('hidden');
    error?.classList.remove('hidden');
    $('#fx-error-msg').textContent = err.message || String(err);
  }
}

function updateHotkeyActive(base) {
  $$('.fx-hotkey').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.base === base);
  });
}

function computeFx() {
  if (!fxRates) return;
  const amount = parseFloat($('#fx-amount')?.value) || 0;
  const from = $('#fx-from')?.value;
  const to = $('#fx-to')?.value;
  const feeOn = $('#fx-fee-enable')?.checked;
  const feePct = Math.max(0, parseFloat($('#fx-fee-pct')?.value) || 0);
  const feeMul = feeOn ? (1 + feePct / 100) : 1;

  let rate;
  if (from === fxRates.base) {
    rate = fxRates.rates[to];
  } else {
    if (!fxBaseCache[from]) {
      loadFx();
      return;
    }
    rate = fxBaseCache[from].rates[to];
  }
  if (rate == null) {
    $('#fx-result-main').textContent = '不支援此貨幣';
    $('#fx-result-rate').textContent = '';
    const feeEl = $('#fx-result-fee');
    if (feeEl) feeEl.textContent = '';
    return;
  }

  // 市價結果
  const mid = amount * rate;
  // 信用卡：實際換到外幣時匯率較差 → 同等「由」金額換到較少「到」；
  // 亦等價於：要得到 mid 咁多外幣，要多付 fee% 本幣
  const result = feeOn ? (mid / feeMul) : mid;
  const effectiveRate = feeOn ? (rate / feeMul) : rate;

  const nameTo = FX_NAMES[to] || to;
  const nameFrom = FX_NAMES[from] || from;
  $('#fx-result-main').textContent = `${result.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${nameTo} ${to}`;
  $('#fx-result-rate').textContent = feeOn
    ? `有效匯率 1 ${from} ≈ ${effectiveRate.toFixed(4)} ${to}（已扣約 ${feePct}% 手續費）`
    : `1 ${from} = ${rate.toFixed(4)} ${to}`;

  const feeEl = $('#fx-result-fee');
  if (feeEl) {
    if (feeOn && amount > 0) {
      const extraFrom = amount * (feeMul - 1);
      feeEl.textContent = `相對市價少換約 ${(mid - result).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${to}；約等於多付 ${extraFrom.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${nameFrom} 手續費`;
    } else {
      feeEl.textContent = '';
    }
  }
}

function renderFxQuick() {
  const grid = $('#fx-quick-grid');
  if (!grid || !fxRates) return;
  const from = $('#fx-from')?.value || fxRates.base;
  const rates = (fxBaseCache[from] || fxRates).rates;
  const targets = FX_CURRENCIES.filter(c => c !== from);
  grid.innerHTML = targets.map(c => {
    const rate = rates[c];
    if (rate == null) return '';
    return `<div class="fx-quick-item">
      <div class="pair">1 ${from} → ${c}</div>
      <div class="val">${Number(rate).toLocaleString(undefined, { maximumFractionDigits: 4 })}</div>
    </div>`;
  }).join('');
}

async function setFxBase(base) {
  if ($('#fx-from')) $('#fx-from').value = base;
  // pick a sensible "to" if same
  if ($('#fx-to')?.value === base) {
    const fallback = ['JPY', 'HKD', 'CNY', 'USD'].find(c => c !== base);
    if (fallback) $('#fx-to').value = fallback;
  }
  updateHotkeyActive(base);
  try {
    fxRates = await fetchFxBase(base);
    $('#fx-updated').textContent = '更新於 ' + (fxRates.updated || '');
    computeFx();
    renderFxQuick();
  } catch (err) {
    $('#fx-error')?.classList.remove('hidden');
    $('#fx-error-msg').textContent = err.message || String(err);
  }
}

$('#btn-refresh-fx')?.addEventListener('click', () => loadFx(true));
$('#fx-amount')?.addEventListener('input', computeFx);
$('#fx-from')?.addEventListener('change', async () => {
  const from = $('#fx-from').value;
  updateHotkeyActive(from);
  try {
    fxRates = await fetchFxBase(from);
    $('#fx-updated').textContent = '更新於 ' + (fxRates.updated || '');
    computeFx();
    renderFxQuick();
  } catch (e) {
    $('#fx-error-msg').textContent = e.message;
    $('#fx-error')?.classList.remove('hidden');
  }
});
$('#fx-to')?.addEventListener('change', computeFx);
$('#btn-fx-swap')?.addEventListener('click', async () => {
  const a = $('#fx-from').value;
  const b = $('#fx-to').value;
  $('#fx-from').value = b;
  $('#fx-to').value = a;
  await setFxBase(b);
});

$$('.fx-hotkey').forEach(btn => {
  btn.addEventListener('click', () => setFxBase(btn.dataset.base));
});

// Keyboard hotkeys 1/2/3 when on FX module
document.addEventListener('keydown', (e) => {
  if (!$('#module-fx')?.classList.contains('active')) return;
  if (e.target.matches('input, textarea, select')) return;
  if (e.key === '1') setFxBase('HKD');
  if (e.key === '2') setFxBase('CNY');
  if (e.key === '3') setFxBase('JPY');
});


$$('.review-batch').forEach(btn => {
  btn.addEventListener('click', () => {
    const n = parseInt(btn.dataset.batch, 10);
    beginReviewSession(n);
  });
});
$('#btn-review-all')?.addEventListener('click', () => beginReviewSession(null));

// ==================== Init ====================
// initVocab 喺解鎖後由 unlockApp() 呼叫

// App 常數同函數已全部定義，可以安全 init
window.__acgAppReady = true;
if (typeof tryStartVocab === 'function') tryStartVocab();
