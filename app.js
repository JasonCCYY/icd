'use strict';

// ─── Abbreviation map ────────────────────────────────────────────────────────
const ABBR = [
  { pattern: /\ba\/w\b/gi,  expand: 'abrasion' },
  { pattern: /\baw\b/gi,    expand: 'abrasion' },
  { pattern: /\bspo\b/gi,   expand: 'spondylosis' },
  { pattern: /\bspr\b/gi,   expand: 'sprain' },
  { pattern: /\bten\b/gi,   expand: 'tendinitis' },
  { pattern: /\bcon\b/gi,   expand: 'contusion' },
  { pattern: /\bfr\b/gi,    expand: 'fracture' },
  { pattern: /\brc\b/gi,    expand: 'rotator cuff' },
  { pattern: /\brt\b/gi,    expand: 'right' },
  { pattern: /\blt\b/gi,    expand: 'left' },
  { pattern: /\bL-/gi,      expand: 'lumbar ' },
  { pattern: /\bC-/gi,      expand: 'cervical ' },
  { pattern: /\bl\b/gi,     expand: 'lumbar' },
  { pattern: /\bc\b/gi,     expand: 'cervical' },
];

const ABBR_DISPLAY = [
  ['rt / Rt', 'right'],      ['lt / Lt', 'left'],
  ['a/w / aw', 'abrasion'],  ['con', 'contusion'],
  ['fr', 'fracture'],        ['spr', 'sprain'],
  ['spo', 'spondylosis'],    ['ten', 'tendinitis'],
  ['L- / l', 'lumbar'],      ['C- / c', 'cervical'],
  ['rc', 'rotator cuff'],
];

// ─── DOM refs ────────────────────────────────────────────────────────────────
const searchInput = document.getElementById('search-input');
const clearBtn    = document.getElementById('clear-btn');
const abbrHint    = document.getElementById('abbr-hint');
const statusEl    = document.getElementById('status');
const resultsList = document.getElementById('results-list');
const toastEl     = document.getElementById('toast');
const resultsArea = document.getElementById('results-area');

// ─── Abbreviation toggle panel ───────────────────────────────────────────────
function renderAbbrPanel() {
  const wrap = document.createElement('div');
  wrap.id = 'abbr-wrap';
  const btn = document.createElement('button');
  btn.id = 'abbr-toggle';
  btn.textContent = '縮寫對照 ▾';
  const panel = document.createElement('div');
  panel.id = 'abbr-panel';
  panel.hidden = true;
  const grid = ABBR_DISPLAY.map(([k, v]) =>
    `<span><span class="abbr-tag">${k}</span> → ${v}</span>`
  ).join('');
  panel.innerHTML = `<div class="abbr-grid">${grid}</div>`;
  btn.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    btn.textContent = panel.hidden ? '縮寫對照 ▾' : '縮寫對照 ▴';
  });
  wrap.appendChild(btn);
  wrap.appendChild(panel);
  resultsArea.parentNode.insertBefore(wrap, resultsArea);
}
renderAbbrPanel();

// ─── ICD code auto-format (m4726 → M47.26) ───────────────────────────────────
function maybeFormatCode(q) {
  const m = q.trim().match(/^([A-Za-z])(\d{2})([A-Za-z0-9]+)$/);
  if (m) return `${m[1].toUpperCase()}${m[2]}.${m[3].toUpperCase()}`;
  return q;
}

// ─── Expand abbreviations ────────────────────────────────────────────────────
function expandAbbr(raw) {
  let q = raw.trim();
  const applied = [];
  for (const { pattern, expand } of ABBR) {
    const next = q.replace(pattern, expand);
    if (next !== q) { applied.push(expand); q = next; }
  }
  q = q.replace(/\s+/g, ' ').trim();
  return { expanded: q, applied };
}

// ─── Chinese ICD-10 lookup (IndexedDB) ───────────────────────────────────────
// Source: 臺灣健保署 2023年中文版 ICD-10-CM (TW Core IG FHIR)
const ZH_DB_NAME  = 'icd10zh';
const ZH_DB_VER   = 1;
const ZH_STORE    = 'codes';
const ZH_META_KEY = '__meta__';
const ZH_SRC      = 'https://build.fhir.org/ig/cctwFHIRterm/MOHW_TWCoreIG_Build/CodeSystem-icd-10-cm-2023-tw.json';

let zhDB = null;
let zhReady = false;
let zhStatusEl = null;

function openZhDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(ZH_DB_NAME, ZH_DB_VER);
    req.onupgradeneeded = e => {
      e.target.result.createObjectStore(ZH_STORE);
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

function dbGet(key) {
  return new Promise((resolve) => {
    const tx = zhDB.transaction(ZH_STORE, 'readonly');
    const req = tx.objectStore(ZH_STORE).get(key);
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = () => resolve(undefined);
  });
}

function dbPutBulk(entries) {
  return new Promise((resolve, reject) => {
    const tx = zhDB.transaction(ZH_STORE, 'readwrite');
    const store = tx.objectStore(ZH_STORE);
    for (const [k, v] of entries) store.put(v, k);
    tx.oncomplete = resolve;
    tx.onerror    = e => reject(e.target.error);
  });
}

async function getZhName(code) {
  if (!zhReady || !zhDB) return null;
  return dbGet(code);
}

async function initZhDB() {
  try {
    zhDB = await openZhDB();
    const meta = await dbGet(ZH_META_KEY);
    if (meta && meta.loaded) { zhReady = true; return; }

    // First-time download
    showZhStatus('正在下載中文病名資料庫（僅需一次）…');
    const resp = await fetch(ZH_SRC);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();

    const concepts = data.concept || [];
    showZhStatus(`處理 ${concepts.length} 筆資料中…`);

    // Parse FHIR CodeSystem concepts
    // Each concept: { code, display, designation: [{language, value}] }
    const entries = [];
    for (const c of concepts) {
      const zhDes = (c.designation || []).find(d =>
        d.language && d.language.toLowerCase().startsWith('zh')
      );
      const zhName = zhDes ? zhDes.value : (c.display || '');
      if (c.code && zhName) entries.push([c.code, zhName]);
    }

    await dbPutBulk(entries);
    await dbPutBulk([[ZH_META_KEY, { loaded: true, count: entries.length, date: Date.now() }]]);
    zhReady = true;
    showZhStatus(`✓ 中文病名已載入（${entries.length} 筆）`);
    setTimeout(() => showZhStatus(''), 3000);
  } catch(e) {
    showZhStatus('中文病名載入失敗（網路問題）');
    setTimeout(() => showZhStatus(''), 4000);
  }
}

function showZhStatus(msg) {
  if (!zhStatusEl) {
    zhStatusEl = document.createElement('div');
    zhStatusEl.id = 'zh-status';
    resultsArea.parentNode.insertBefore(zhStatusEl, resultsArea);
  }
  zhStatusEl.textContent = msg;
  zhStatusEl.hidden = !msg;
}

initZhDB();

// ─── API search (NIH NLM) ────────────────────────────────────────────────────
const API_BASE = 'https://clinicaltables.nlm.nih.gov/api/icd10cm/v3/search';
let abortController = null;

async function searchICD(query) {
  if (abortController) abortController.abort();
  abortController = new AbortController();
  const url = `${API_BASE}?terms=${encodeURIComponent(query)}&sf=code,name&df=code,name&maxList=30`;
  const resp = await fetch(url, { signal: abortController.signal });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  const items = data[3] || [];
  const results = items.map(([code, name]) => ({ code, name }));
  results.sort((a, b) => {
    const ai = /initial/i.test(a.name) ? 0 : 1;
    const bi = /initial/i.test(b.name) ? 0 : 1;
    return ai - bi;
  });
  return results;
}

// ─── Render results ───────────────────────────────────────────────────────────
function renderResults(items) {
  resultsList.innerHTML = '';
  if (!items.length) {
    resultsList.innerHTML = '<li class="no-results">查無結果</li>';
    return;
  }
  for (const { code, name } of items) {
    const li = document.createElement('li');
    li.className = 'result-item';
    const zhEl = document.createElement('span');
    zhEl.className = 'result-zh';
    li.innerHTML = `
      <div class="result-inner">
        <span class="code-badge">${escHtml(code)}</span>
        <span class="result-text-wrap">
          <span class="result-en">${escHtml(name)}</span>
        </span>
      </div>`;
    li.querySelector('.result-text-wrap').appendChild(zhEl);
    li.addEventListener('click', () => copyCode(li, code));
    resultsList.appendChild(li);

    // Fill Chinese name async
    getZhName(code).then(zh => { if (zh) zhEl.textContent = zh; });
  }
}

function escHtml(s) {
  return s.replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ─── Copy code (strip dots) ───────────────────────────────────────────────────
let toastTimer = null;

function copyCode(li, code) {
  const clean = code.replace(/\./g, '');
  navigator.clipboard.writeText(clean).then(() => flashCopy(li, clean))
    .catch(() => {
      const ta = document.createElement('textarea');
      ta.value = clean;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      flashCopy(li, clean);
    });
}

function flashCopy(li, clean) {
  li.classList.add('copied');
  showToast(`已複製 ${clean}`);
  setTimeout(() => li.classList.remove('copied'), 1200);
}

function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1800);
}

// ─── Search handler ───────────────────────────────────────────────────────────
let debounceTimer = null;

function handleInput() {
  const raw = searchInput.value;
  clearBtn.classList.toggle('visible', raw.length > 0);

  if (!raw.trim()) {
    abbrHint.textContent = '';
    statusEl.textContent = '';
    resultsList.innerHTML = '';
    return;
  }

  const formatted = maybeFormatCode(raw.trim());
  let query, hint;
  if (formatted !== raw.trim()) {
    query = formatted;
    hint = `代碼：${formatted}`;
  } else {
    const { expanded, applied } = expandAbbr(raw);
    query = expanded;
    hint = applied.length ? `搜索：${expanded}` : '';
  }

  abbrHint.textContent = hint;
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => doSearch(query), 300);
}

async function doSearch(query) {
  statusEl.innerHTML = '<span class="spinner"></span>搜索中…';
  resultsList.innerHTML = '';
  try {
    const items = await searchICD(query);
    statusEl.textContent = items.length ? `找到 ${items.length} 筆結果` : '';
    renderResults(items);
  } catch (e) {
    if (e.name === 'AbortError') return;
    statusEl.textContent = '網路錯誤，請稍後再試';
  }
}

searchInput.addEventListener('input', handleInput);

clearBtn.addEventListener('click', () => {
  searchInput.value = '';
  abbrHint.textContent = '';
  statusEl.textContent = '';
  resultsList.innerHTML = '';
  clearBtn.classList.remove('visible');
  searchInput.focus();
});

// ─── Service worker ───────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
