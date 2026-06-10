'use strict';

// ─── Abbreviation map ────────────────────────────────────────────────────────
const ABBR = [
  // order matters: longer / more-specific patterns first
  { pattern: /\ba\/w\b/gi,  expand: 'abrasion wound' },
  { pattern: /\baw\b/gi,    expand: 'abrasion wound' },
  { pattern: /\bspo\b/gi,   expand: 'spondylosis' },
  { pattern: /\bspr\b/gi,   expand: 'sprain' },
  { pattern: /\bten\b/gi,   expand: 'tendinitis' },
  { pattern: /\bcon\b/gi,   expand: 'contusion' },
  { pattern: /\bfr\b/gi,    expand: 'fracture' },
  { pattern: /\brt\b/gi,    expand: 'right' },
  { pattern: /\blt\b/gi,    expand: 'left' },
  // prefix-style: L- / C- (with or without dash)
  { pattern: /\bL-/gi,      expand: 'lumbar ' },
  { pattern: /\bC-/gi,      expand: 'cervical ' },
];

const ABBR_DISPLAY = [
  ['rt / Rt', 'right'],        ['lt / Lt', 'left'],
  ['a/w / aw', 'abrasion wound'], ['con', 'contusion'],
  ['fr', 'fracture'],          ['spr', 'sprain'],
  ['spo', 'spondylosis'],      ['ten', 'tendinitis'],
  ['L-', 'lumbar'],            ['C-', 'cervical'],
];

// ─── DOM refs ────────────────────────────────────────────────────────────────
const searchInput  = document.getElementById('search-input');
const clearBtn     = document.getElementById('clear-btn');
const abbrHint     = document.getElementById('abbr-hint');
const statusEl     = document.getElementById('status');
const resultsList  = document.getElementById('results-list');
const toastEl      = document.getElementById('toast');
const resultsArea  = document.getElementById('results-area');

// ─── Abbreviation reference panel ────────────────────────────────────────────
function renderAbbrPanel() {
  const panel = document.createElement('div');
  panel.id = 'abbr-panel';
  const grid = ABBR_DISPLAY.map(([k, v]) =>
    `<span><span class="abbr-tag">${k}</span> → ${v}</span>`
  ).join('');
  panel.innerHTML = `<strong>縮寫對照</strong><div class="abbr-grid">${grid}</div>`;
  resultsArea.parentNode.insertBefore(panel, resultsArea);
}
renderAbbrPanel();

// ─── Expand abbreviations ─────────────────────────────────────────────────────
function expandAbbr(raw) {
  let q = raw.trim();
  const applied = [];
  for (const { pattern, expand } of ABBR) {
    const next = q.replace(pattern, expand);
    if (next !== q) {
      applied.push(`"${raw.match(pattern)?.[0]}" → ${expand}`);
      q = next;
    }
  }
  // collapse multiple spaces
  q = q.replace(/\s+/g, ' ').trim();
  return { expanded: q, applied };
}

// ─── API search (NIH NLM) ─────────────────────────────────────────────────────
const API_BASE = 'https://clinicaltables.nlm.nih.gov/api/icd10cm/v3/search';
let abortController = null;

async function searchICD(query) {
  if (abortController) abortController.abort();
  abortController = new AbortController();

  const url = `${API_BASE}?terms=${encodeURIComponent(query)}&sf=code,name&df=code,name&maxList=30`;
  const resp = await fetch(url, { signal: abortController.signal });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  // data = [totalCount, codes[], extraInfo, [[code, name], ...]]
  const items = data[3] || [];
  return items.map(([code, name]) => ({ code, name }));
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
    li.innerHTML = `
      <div class="result-inner">
        <span class="code-badge">${escHtml(code)}</span>
        <span class="result-text">${escHtml(name)}</span>
      </div>`;
    li.addEventListener('click', () => copyCode(li, code));
    resultsList.appendChild(li);
  }
}

function escHtml(s) {
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ─── Copy code (strip dots) ───────────────────────────────────────────────────
let toastTimer = null;

function copyCode(li, code) {
  const clean = code.replace(/\./g, '');
  navigator.clipboard.writeText(clean).then(() => {
    li.classList.add('copied');
    showToast(`已複製 ${clean}`);
    setTimeout(() => li.classList.remove('copied'), 1200);
  }).catch(() => {
    // fallback for older iOS
    const ta = document.createElement('textarea');
    ta.value = clean;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    li.classList.add('copied');
    showToast(`已複製 ${clean}`);
    setTimeout(() => li.classList.remove('copied'), 1200);
  });
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

  const { expanded, applied } = expandAbbr(raw);

  if (applied.length) {
    abbrHint.textContent = `搜索：${expanded}`;
  } else {
    abbrHint.textContent = '';
  }

  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => doSearch(expanded), 300);
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

// ─── Service worker registration ──────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
