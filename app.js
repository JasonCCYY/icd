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

// ─── Chinese lookup (local zh.json, 健保署 2023 官方中文版) ───────────────────
let zhMap = null;

fetch('zh.json')
  .then(r => r.json())
  .then(data => { zhMap = data; })
  .catch(() => {});

function getZhName(code) {
  if (!zhMap) return null;
  // NLM returns codes with dot (M47.26); zh.json keys have no dot (M4726)
  return zhMap[code.replace(/\./g, '')] || null;
}

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
    const zh = getZhName(code);
    const li = document.createElement('li');
    li.className = 'result-item';
    li.innerHTML = `
      <div class="result-inner">
        <span class="code-badge">${escHtml(code)}</span>
        <span class="result-text-wrap">
          <span class="result-en">${escHtml(name)}</span>
          ${zh ? `<span class="result-zh">${escHtml(zh)}</span>` : ''}
        </span>
      </div>`;
    li.addEventListener('click', () => copyCode(li, code));
    resultsList.appendChild(li);
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

  abbrHint.innerHTML = hint ? `${hint} <button id="g-search-btn">G搜尋</button>` : '';
  if (hint) {
    document.getElementById('g-search-btn').addEventListener('click', () => {
      window.open(`https://www.google.com/search?q=${encodeURIComponent(query + ' icd 10')}`, '_blank');
    });
  }
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

// ─── Tab navigation ───────────────────────────────────────────────────────────
const headerSubTabsMap = { soap: 'soap-top-tabs', cert: 'cert-top-tabs', ops: 'ops-top-tabs' };

function updateHeaderForPage(page) {
  const hasSubTabs = page in headerSubTabsMap;
  document.getElementById('header-title').style.display = hasSubTabs ? 'none' : '';
  Object.values(headerSubTabsMap).forEach(id => {
    document.getElementById(id).style.display = 'none';
  });
  if (hasSubTabs) document.getElementById(headerSubTabsMap[page]).style.display = 'flex';
}
// updateHeaderForPage called at end of file after all listeners are registered

document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`page-${btn.dataset.page}`).classList.add('active');
    document.getElementById('header-title').textContent = btn.dataset.title;
    updateHeaderForPage(btn.dataset.page);
  });
});

searchInput.addEventListener('input', handleInput);

clearBtn.addEventListener('click', () => {
  searchInput.value = '';
  abbrHint.textContent = '';
  statusEl.textContent = '';
  resultsList.innerHTML = '';
  clearBtn.classList.remove('visible');
  searchInput.focus();
});

// ─── 手術碼 page ──────────────────────────────────────────────────────────────
// Apps Script Web App URL（部署後填入）
const OPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxCaJs3M9JxP6gm2jsSGD2mQn03y1Vdf2zmb1JSvCfJKxLm21HiUNnq--JaEevTeQno4Q/exec';
const OPS_TOKEN      = 'cycicd-ops-X7m3K9pQ';

const opsSearchInput = document.getElementById('ops-search-input');
const opsClearBtn    = document.getElementById('ops-clear-btn');
const opsShowAllBtn  = document.getElementById('ops-show-all-btn');
const opsStatusEl    = document.getElementById('ops-status');
const opsResultsEl   = document.getElementById('ops-results');

document.querySelectorAll('.ops-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.ops-tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.opsTab;
    document.getElementById('ops-tab-ops').hidden   = tab !== 'ops';
    document.getElementById('ops-tab-notes').hidden = tab !== 'notes';
    document.getElementById('ops-tab-edu').hidden   = tab !== 'edu';
    if (tab === 'notes') loadNotes();
    if (tab === 'edu')   loadEdu();
  });
});

let opsData = null; // parsed rows

// ─── 備註 tab ─────────────────────────────────────────────────────────────────
let notesData = null;
let notesLoaded = false;

async function loadNotes() {
  const typeBtns = document.getElementById('notes-type-btns');
  const listEl   = document.getElementById('notes-list');
  if (notesLoaded) return;
  typeBtns.innerHTML = '<span style="color:#aaa;font-size:.85rem">載入中…</span>';
  const cached = lsGet('notes');
  if (cached) { notesData = cached; }
  else {
    const url = `${OPS_SCRIPT_URL}?token=${encodeURIComponent(OPS_TOKEN)}&sheet=${encodeURIComponent('備註')}`;
    const data = await fetchWithRetry(url);
    if (!data) {
      typeBtns.innerHTML = '<span style="color:#d93025;font-size:.85rem">載入失敗</span>';
      return;
    }
    notesData = data;
    lsSet('notes', notesData);
  }
  notesLoaded = true;

  // Render type buttons
  typeBtns.innerHTML = '';
  let activeType = null;
  const types = Object.keys(notesData);

  function showType(type) {
    activeType = type;
    typeBtns.querySelectorAll('.soap-type-chip').forEach(b =>
      b.classList.toggle('active', b.textContent === type));
    listEl.innerHTML = '';
    (notesData[type] || []).forEach(text => {
      const row = document.createElement('div');
      row.className = 'notes-row';
      row.textContent = text;
      let timer = null;
      row.addEventListener('click', () => {
        if (timer) return;
        timer = setTimeout(() => {
          timer = null;
          navigator.clipboard.writeText(text).catch(() => {});
          showToast(`已複製`);
          row.classList.add('notes-row-flash');
          setTimeout(() => row.classList.remove('notes-row-flash'), 500);
        }, 220);
      });
      row.addEventListener('dblclick', e => {
        e.stopPropagation();
        if (timer) { clearTimeout(timer); timer = null; }
        navigator.clipboard.writeText(text).catch(() => {});
        showToast(`已複製`);
      });
      listEl.appendChild(row);
    });
  }

  types.forEach(type => {
    const btn = document.createElement('button');
    btn.className = 'soap-type-chip';
    btn.textContent = type;
    btn.addEventListener('click', () => showType(type));
    typeBtns.appendChild(btn);
  });

  if (types.length) showType(types[0]);
}

// ─── localStorage cache (private device only) ─────────────────────────────
const LS_TTL = 6 * 60 * 60 * 1000; // 6 hours

function lsGet(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > LS_TTL) { localStorage.removeItem(key); return null; }
    return data;
  } catch(e) { return null; }
}

function lsSet(key, data) {
  try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data })); } catch(e) {}
}

async function loadOpsData() {
  if (opsData) return opsData;
  if (OPS_SCRIPT_URL === 'PASTE_YOUR_APPS_SCRIPT_URL_HERE') {
    opsStatusEl.textContent = '尚未設定 Apps Script URL';
    return [];
  }
  const cached = lsGet('ops');
  if (cached) { opsData = cached; opsStatusEl.textContent = ''; return opsData; }
  opsStatusEl.innerHTML = '<span class="spinner"></span>載入手術碼資料…';
  const url = `${OPS_SCRIPT_URL}?token=${encodeURIComponent(OPS_TOKEN)}`;
  const data = await fetchWithRetry(url);
  if (data) {
    opsData = data;
    lsSet('ops', opsData);
    opsStatusEl.textContent = '';
    return opsData;
  }
  opsStatusEl.textContent = '載入失敗，請按右上角重新整理';
  return [];
}


function opsSearch(query) {
  if (!opsData) return [];
  const q = query.toLowerCase().trim();
  if (!q) return opsData;
  return opsData.filter(r =>
    r.name.toLowerCase().includes(q) ||
    r.code.includes(q) ||
    r.part.toLowerCase().includes(q) ||
    r.side.toLowerCase().includes(q) ||
    r.proc.toLowerCase().includes(q)
  );
}

function renderOpsResults(items) {
  opsResultsEl.innerHTML = '';
  if (!items.length) {
    opsResultsEl.innerHTML = '<div class="no-results">查無結果</div>';
    return;
  }

  // Group by name+code
  const groups = new Map();
  for (const r of items) {
    const key = `${r.name}||${r.code}`;
    if (!groups.has(key)) groups.set(key, { name: r.name, code: r.code, rows: [] });
    groups.get(key).rows.push(r);
  }

  for (const [, g] of groups) {
    const card = document.createElement('div');
    card.className = 'ops-card';

    const header = document.createElement('div');
    header.className = 'ops-card-header';
    header.innerHTML = `
      <span class="ops-code-badge" title="點擊複製">${escHtml(g.code)}</span>
      <span class="ops-name">${escHtml(g.name)}</span>`;
    const codeBadge = header.querySelector('.ops-code-badge');
    codeBadge.addEventListener('click', e => {
      e.stopPropagation();
      copyText(g.code, codeBadge);
    });
    card.appendChild(header);

    const body = document.createElement('div');
    body.className = 'ops-card-body';
    for (const r of g.rows) {
      const row = document.createElement('div');
      row.className = 'ops-row';
      const sideLabel = r.side ? `<span class="ops-side ops-side-${r.side.toUpperCase()}">${escHtml(r.side)}</span>` : '';
      const procHtml = r.proc
        ? `<span class="ops-proc" title="點擊複製">${escHtml(r.proc)}</span>`
        : '<span class="ops-proc-empty">—</span>';
      row.innerHTML = `
        <span class="ops-part">${escHtml(r.part)}</span>
        ${sideLabel}
        <span class="ops-arrow">→</span>
        ${procHtml}`;
      if (r.proc) {
        row.querySelector('.ops-proc').addEventListener('click', function() {
          copyText(r.proc, this);
        });
      }
      body.appendChild(row);
    }
    card.appendChild(body);
    opsResultsEl.appendChild(card);
  }
}

function copyText(text, el) {
  const clean = text.replace(/\./g, '');
  navigator.clipboard.writeText(clean).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = clean; ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta); ta.focus(); ta.select();
    document.execCommand('copy'); document.body.removeChild(ta);
  });
  el.classList.add('copied-flash');
  showToast(`已複製 ${clean}`);
  setTimeout(() => el.classList.remove('copied-flash'), 900);
}

let opsDebounce = null;
opsSearchInput.addEventListener('input', () => {
  const q = opsSearchInput.value;
  opsClearBtn.classList.toggle('visible', q.length > 0);
  clearTimeout(opsDebounce);
  opsDebounce = setTimeout(async () => {
    await loadOpsData();
    const results = opsSearch(q);
    opsStatusEl.textContent = q.trim() && results.length ? `找到 ${results.length} 筆` : '';
    renderOpsResults(results);
  }, 250);
});

opsClearBtn.addEventListener('click', () => {
  opsSearchInput.value = '';
  opsClearBtn.classList.remove('visible');
  opsResultsEl.innerHTML = '';
  opsStatusEl.textContent = '';
  opsSearchInput.focus();
});

opsShowAllBtn.addEventListener('click', async () => {
  await loadOpsData();
  opsSearchInput.value = '';
  opsClearBtn.classList.remove('visible');
  const results = opsSearch('');
  opsStatusEl.textContent = `共 ${results.length} 筆`;
  renderOpsResults(results);
});

// ─── SOAP page ────────────────────────────────────────────────────────────────
const SOAP_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxCaJs3M9JxP6gm2jsSGD2mQn03y1Vdf2zmb1JSvCfJKxLm21HiUNnq--JaEevTeQno4Q/exec';
const SOAP_TOKEN      = 'cycicd-ops-X7m3K9pQ';

function addChipEvents(chip, onSingleClick, copyText) {
  let timer = null;
  chip.addEventListener('click', () => {
    if (timer) return;
    timer = setTimeout(() => { timer = null; onSingleClick(); }, 220);
  });
  chip.addEventListener('dblclick', e => {
    e.stopPropagation();
    if (timer) { clearTimeout(timer); timer = null; }
    navigator.clipboard.writeText(copyText).catch(() => {});
    const label = copyText.length > 14 ? copyText.slice(0, 14) + '…' : copyText;
    showToast(`已複製：${label}`);
  });
}

const soapTabBtns   = document.querySelectorAll('.soap-tab-btn');
const soapTypeBtns  = document.getElementById('soap-type-btns');
const soapPicker    = document.getElementById('soap-picker');
const soapTextarea  = document.getElementById('soap-textarea');
const soapCopyBtn   = document.getElementById('soap-copy-btn');
const soapRestoreBtn= document.getElementById('soap-restore-btn');

let soapCache   = {};        // { sheetName: groupedData }
let soapSheet   = 'SOAP中正';
let soapLastVal = '';

// helpers
function todayStr() {
  const d = new Date();
  const roc = d.getFullYear() - 1911;
  const mm  = String(d.getMonth()+1).padStart(2,'0');
  const dd  = String(d.getDate()).padStart(2,'0');
  return `${roc}${mm}${dd}`;
}
function todayRocFull() {
  const d = new Date();
  const roc = d.getFullYear() - 1911;
  const mm  = String(d.getMonth()+1).padStart(2,'0');
  const dd  = String(d.getDate()).padStart(2,'0');
  return { roc, mm, dd };
}
function fillCertDate(text) {
  const { mm, dd } = todayRocFull();
  if (/年月日至月日/.test(text)) {
    // 年月日至月日: only fill the 至月日 part
    return text.replace(/(?<!年)月日/g, `${mm}月${dd}日`);
  }
  // 年月日 alone: fill month+day after the 年
  return text.replace(/年月日/g, `年${mm}月${dd}日`);
}

let soapXrLabel = 'XR';

function soapIs中正() { return soapSheet === 'SOAP中正'; }

function soapLines() {
  const text = soapTextarea.value;
  const parse = {};
  if (soapIs中正()) {
    // First line: date + S content (no "S:" label)
    const firstLine = text.split('\n')[0] || '';
    const dateM = firstLine.match(/^\d{7}\s*(.*)/);
    parse.S = dateM ? dateM[1].trim() : firstLine.trim();
  } else {
    const m = text.match(/^S:(.*)$/m);
    parse.S = m ? m[1].trim() : '';
  }
  for (const key of ['PE','P']) {
    const m = text.match(new RegExp(`^${key}:(.*)$`, 'm'));
    parse[key] = m ? m[1].trim() : '';
  }
  const xrMatch = text.match(new RegExp(`^${soapXrLabel}:(.*)$`, 'm'));
  parse.XR = xrMatch ? xrMatch[1].trim() : '';
  return parse;
}

function buildSoapText(lines) {
  const sLine = soapIs中正()
    ? (lines.S ? `${todayStr()} ${lines.S}` : `${todayStr()} `)
    : `S: ${lines.S||''}`;
  return `${sLine}\nPE: ${lines.PE||''}\n${soapXrLabel}: ${lines.XR||''}\nP: ${lines.P||''}`;
}

function soapDefaultText(type) {
  if (soapIs中正()) {
    const d = { 'Trauma': `${todayStr()} pain after` };
    return `${d[type] || `${todayStr()} `}\nPE: \n${soapXrLabel}: \nP: `;
  }
  const d = { 'Trauma': `S: pain after` };
  return `${d[type] || 'S: '}\nPE: \n${soapXrLabel}: \nP: `;
}

function filterSoapText(text) {
  return text.split('\n')
    .filter(line => {
      const labelM = line.match(/^[A-Z]+:\s*(.*)$/);
      if (labelM) return labelM[1].trim() !== '';
      const dateM = line.match(/^\d{7}\s*(.*)$/);
      if (dateM) return dateM[1].trim() !== '';
      return line.trim() !== '';
    })
    .join('\n');
}

function appendToLine(key, value) {
  const lines = soapLines();
  const cur = lines[key];
  lines[key] = cur ? `${cur}, ${value}` : value;
  soapTextarea.value = buildSoapText(lines);
}


// Load SOAP data
async function fetchWithRetry(url, retries = 2, delay = 1500) {
  for (let i = 0; i <= retries; i++) {
    try {
      const resp = await fetch(url);
      const json = await resp.json();
      if (json.status === 'ok') return json.data;
    } catch(e) {}
    if (i < retries) await new Promise(r => setTimeout(r, delay));
  }
  return null;
}

async function loadSoapData(sheet) {
  if (soapCache[sheet]) return soapCache[sheet];
  const cached = lsGet(`soap_${sheet}`);
  if (cached) { soapCache[sheet] = cached; return cached; }
  const url = `${SOAP_SCRIPT_URL}?token=${encodeURIComponent(SOAP_TOKEN)}&sheet=${encodeURIComponent(sheet)}`;
  const data = await fetchWithRetry(url);
  if (data) { soapCache[sheet] = data; lsSet(`soap_${sheet}`, data); }
  return data;
}

// Render type buttons
async function renderSoapTypes(sheet) {
  soapTypeBtns.innerHTML = '<span style="color:#aaa;font-size:.85rem">載入中…</span>';
  soapPicker.hidden = true;
  const data = await loadSoapData(sheet);
  soapTypeBtns.innerHTML = '';
  if (!data) {
    soapTypeBtns.innerHTML = '<span style="color:#d93025;font-size:.85rem">載入失敗</span>';
    return;
  }
  Object.keys(data).forEach(type => {
    const btn = document.createElement('button');
    btn.className = 'soap-type-chip';
    btn.textContent = type;
    btn.addEventListener('click', () => {
      document.querySelectorAll('.soap-type-chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const typeData = data[type];
      soapXrLabel = (typeData.XR || []).some(v => v.startsWith('A:')) ? 'A' : 'XR';
      renderSoapPicker(typeData, type === 'X光');
      const isSingle = ['S','PE','XR','P','dx'].every(k => (typeData[k]||[]).length <= 1);
      if (isSingle) {
        const xrVal = (typeData.XR?.[0] || '').replace(/^A:\s*/, '');
        const lines = { S: typeData.S?.[0]||'', PE: typeData.PE?.[0]||'', XR: xrVal, P: typeData.P?.[0]||'' };
        let text = buildSoapText(lines);
        if (typeData.dx?.[0]) text += `\n${typeData.dx[0]}`;
        soapTextarea.value = text;
        navigator.clipboard.writeText(filterSoapText(text)).catch(() => {});
        showToast('已複製！');
        soapLastVal = text;
        soapRestoreBtn.disabled = false;
      } else {
        soapTextarea.value = soapDefaultText(type);
      }
    });
    soapTypeBtns.appendChild(btn);
  });
}

// Render chips for selected type
function renderSoapPicker(typeData, isXrType = false) {
  soapPicker.hidden = false;
  const sections = [
    { id: 'soap-s-chips',  key: 'S',  line: 'S'  },
    { id: 'soap-pe-chips', key: 'PE', line: 'PE' },
    { id: 'soap-xr-chips', key: 'XR', line: 'XR' },
    { id: 'soap-p-chips',  key: 'P',  line: 'P'  },
    { id: 'soap-dx-chips', key: 'dx', line: '__dx__' },
  ];
  sections.forEach(({ id, key, line }) => {
    const container = document.getElementById(id);
    const section   = container.closest('.soap-chip-section');
    const items     = typeData[key] || [];
    container.innerHTML = '';
    section.hidden = items.length === 0;
    items.forEach(item => {
      const chip = document.createElement('button');
      chip.className = 'soap-chip';
      chip.textContent = item;
      addChipEvents(chip, () => {
        if (line === '__dx__') {
          const dxText = item.includes(' / ') ? item : item.replace(/[（(][^）)]*[）)]\s*/g, '').trim();
          const cur = soapTextarea.value.trimEnd();
          soapTextarea.value = cur ? `${cur}\n${dxText}` : dxText;
        } else if (line === 'S' && /^(Lt|Rt)$/i.test(item)) {
          const lines = soapLines();
          const s = lines.S;
          if (s.includes('pain after')) {
            lines.S = s.replace(/^(.*?)(pain after)/, (_, pre, pa) => `${pre}${item} ${pa}`);
          } else {
            lines.S = s ? `${item} ${s}` : item;
          }
          soapTextarea.value = buildSoapText(lines);
        } else if (line === 'S') {
          const lines = soapLines();
          lines.S = lines.S ? lines.S + ' ' + item : item;
          soapTextarea.value = buildSoapText(lines);
        } else if (line === 'XR') {
          const xrText = item.startsWith('A: ') ? item.slice(3) : item;
          if (isXrType) {
            navigator.clipboard.writeText(xrText).catch(() => {});
            showToast('已複製！');
          } else {
            appendToLine('XR', xrText);
          }
        } else {
          appendToLine(line, item);
        }
        chip.classList.add('soap-chip-used');
        setTimeout(() => chip.classList.remove('soap-chip-used'), 600);
      }, line === '__dx__' ? (item.includes(' / ') ? item : item.replace(/[（(][^）)]*[）)]\s*/g, '').trim()) : item);
      container.appendChild(chip);
    });
  });
}

// Tab switch (中正/門診 only — HA handled separately)
soapTabBtns.forEach(btn => {
  if (!btn.dataset.soapSheet) return;
  btn.addEventListener('click', () => {
    soapTabBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    soapSheet = btn.dataset.soapSheet;
    haShowSoap();
    renderSoapTypes(soapSheet);
  });
});

// Editor buttons
soapCopyBtn.addEventListener('click', () => {
  const text = soapTextarea.value;
  navigator.clipboard.writeText(filterSoapText(text)).catch(() => {});
  showToast('已複製 SOAP');
  soapLastVal = text;
  soapTextarea.value = soapDefaultText('');
  soapRestoreBtn.disabled = false;
});

soapRestoreBtn.addEventListener('click', () => {
  soapTextarea.value = soapLastVal;
  soapRestoreBtn.disabled = true;
});

// Load when SOAP tab is activated (always reset HA, show main)
document.querySelectorAll('.tab').forEach(btn => {
  if (btn.dataset.page === 'soap') {
    btn.addEventListener('click', () => {
      haShowSoap();
      // restore active sheet button
      soapTabBtns.forEach(b => b.classList.remove('active'));
      document.querySelector(`.soap-tab-btn[data-soap-sheet="${soapSheet}"]`).classList.add('active');
      renderSoapTypes(soapSheet);
    }, { once: false });
  }
});

// ─── HA Calculator ────────────────────────────────────────────────────────────
const haContent   = document.getElementById('soap-ha-content');
const haMainSoap  = document.getElementById('soap-main-content');
const haYearInput = document.getElementById('ha-year');
const haMMDDInput = document.getElementById('ha-mmdd');

function haShowSoap() {
  haContent.hidden  = true;
  haMainSoap.hidden = false;
}
function haShowHA() {
  haContent.hidden  = false;
  haMainSoap.hidden = true;
  haYearInput.value = haYearInput.value || todayRocFull().roc;
}

// HA button: deselects 中正/門診, shows HA panel
document.getElementById('soap-ha-btn').addEventListener('click', () => {
  soapTabBtns.forEach(b => b.classList.remove('active'));
  document.getElementById('soap-ha-btn').classList.add('active');
  haShowHA();
});



// Date calculation
const ROC_WEEKDAYS = ['日','一','二','三','四','五','六'];
const WEEKDAY_NAMES = ['週一','週二','週三','週四','週五'];

function calcHA() {
  const year = parseInt(haYearInput.value);
  const raw  = haMMDDInput.value.replace('.','');
  if (!year || raw.replace(/\D/g,'').length < 4) {
    document.getElementById('ha-display').textContent = '';
    document.getElementById('ha-result-180').textContent = '';
    document.getElementById('ha-week').innerHTML = '';
    return;
  }
  const mm = parseInt(raw.slice(0,2)) - 1;
  const dd = parseInt(raw.slice(2,4));
  const base = new Date(year + 1911, mm, dd);
  if (isNaN(base.getTime())) return;

  // Display entered date
  const dispM = String(mm+1).padStart(2,'0');
  const dispD = String(dd).padStart(2,'0');
  document.getElementById('ha-display').textContent = `${year}.${dispM}.${dispD}`;

  // 180 days later
  const d180 = new Date(base);
  d180.setDate(d180.getDate() + 180);
  const r = todayRocFull();
  const y180 = d180.getFullYear() - 1911;
  const m180 = String(d180.getMonth()+1).padStart(2,'0');
  const d180d = String(d180.getDate()).padStart(2,'0');
  document.getElementById('ha-result-180').textContent =
    `180天後：${y180}.${m180}.${d180d} (週${ROC_WEEKDAYS[d180.getDay()]})`;

  // Find Monday on or after d180
  const dow = d180.getDay(); // 0=Sun,1=Mon,...
  const toMon = dow === 1 ? 0 : dow === 0 ? 1 : (8 - dow) % 7;
  const monday = new Date(d180);
  monday.setDate(monday.getDate() + toMon);

  const todayDow = new Date().getDay(); // today's weekday for highlight

  const weekEl = document.getElementById('ha-week');
  weekEl.innerHTML = '';
  for (let i = 0; i < 5; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const wy = d.getFullYear() - 1911;
    const wm = String(d.getMonth()+1).padStart(2,'0');
    const wd = String(d.getDate()).padStart(2,'0');
    const cell = document.createElement('div');
    const copyStr = `${wy}${wm}${wd}`;
    cell.className = 'ha-day-cell';
    if (i === 0 && todayDow === 1) cell.classList.add('ha-monday-hi');
    cell.innerHTML = `<span class="ha-day-name">${WEEKDAY_NAMES[i]}</span><span class="ha-day-date">${wy}.${wm}.${wd}</span>`;
    let haTimer = null;
    cell.addEventListener('click', () => {
      if (haTimer) return;
      haTimer = setTimeout(() => {
        haTimer = null;
        navigator.clipboard.writeText(copyStr).catch(() => {});
        showToast(`已複製：${copyStr}`);
      }, 220);
    });
    cell.addEventListener('dblclick', e => {
      e.stopPropagation();
      if (haTimer) { clearTimeout(haTimer); haTimer = null; }
      const bilStr = `預Bil HA ${copyStr}`;
      navigator.clipboard.writeText(bilStr).catch(() => {});
      showToast(`已複製：${bilStr}`);
    });
    weekEl.appendChild(cell);
  }
}

haMMDDInput.addEventListener('input', () => {
  const v = haMMDDInput.value.replace(/\D/g,'').slice(0, 4);
  haMMDDInput.value = v;
  if (v.length === 4) calcHA();
  else {
    document.getElementById('ha-display').textContent = '';
    document.getElementById('ha-result-180').textContent = '';
    document.getElementById('ha-week').innerHTML = '';
  }
});
haMMDDInput.addEventListener('blur', () => {
  const v = haMMDDInput.value.replace(/\D/g,'');
  if (v.length >= 2) haMMDDInput.value = v.slice(0,2) + (v.length > 2 ? '.' + v.slice(2) : '');
});
haMMDDInput.addEventListener('focus', () => {
  haMMDDInput.value = haMMDDInput.value.replace(/\D/g,'');
});
haYearInput.addEventListener('input', calcHA);
haYearInput.value = todayRocFull().roc;

// ─── 診斷書 page ──────────────────────────────────────────────────────────────
const certTabBtns   = document.querySelectorAll('[data-cert-sheet]');
const certTypeBtns  = document.getElementById('cert-type-btns');
const certPicker    = document.getElementById('cert-picker');
const certDisChips  = document.getElementById('cert-disease-chips');
const certProcChips = document.getElementById('cert-process-chips');
const certTextarea  = document.getElementById('cert-textarea');
const certCopyBtn   = document.getElementById('cert-copy-btn');
const certRestoreBtn= document.getElementById('cert-restore-btn');

let certSheet   = '診斷書中正';
let certLastVal = '';
const certCache = {};

async function loadCertData(sheet) {
  if (certCache[sheet]) return certCache[sheet];
  const cached = lsGet(`cert_${sheet}`);
  if (cached) { certCache[sheet] = cached; return cached; }
  const url = `${SOAP_SCRIPT_URL}?token=${encodeURIComponent(SOAP_TOKEN)}&sheet=${encodeURIComponent(sheet)}`;
  const data = await fetchWithRetry(url);
  if (data) { certCache[sheet] = data; lsSet(`cert_${sheet}`, data); }
  return data;
}

async function renderCertTypes(sheet) {
  certTypeBtns.innerHTML = '<span style="color:#aaa;font-size:.85rem">載入中…</span>';
  certPicker.hidden = true;
  const data = await loadCertData(sheet);
  certTypeBtns.innerHTML = '';
  if (!data) {
    certTypeBtns.innerHTML = '<span style="color:#d93025;font-size:.85rem">載入失敗</span>';
    return;
  }
  Object.keys(data).forEach(type => {
    const btn = document.createElement('button');
    btn.className = 'soap-type-chip';
    btn.textContent = type;
    btn.addEventListener('click', () => {
      document.querySelectorAll('#cert-type-btns .soap-type-chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      certTextarea.value = '';
      certRestoreBtn.disabled = true;
      const typeData = data[type];
      const diseases  = typeData.disease  || [];
      const processes = typeData.process  || [];
      // Single-row type: auto-build and copy immediately
      if (diseases.length <= 1 && processes.length <= 1 && diseases.length + processes.length > 0) {
        const lines = [];
        if (diseases.length === 1) lines.push(diseases[0] + '(以下空白)');
        else lines.push('');
        if (processes.length === 1) lines.push(fillCertDate(processes[0]));
        const text = lines.join('\n');
        certTextarea.value = text;
        navigator.clipboard.writeText(text.trimStart()).catch(() => {});
        showToast('已複製診斷書');
        certLastVal = text;
        certTextarea.value = '';
        certRestoreBtn.disabled = false;
        certPicker.hidden = true;
        return;
      }
      renderCertPicker(typeData, type);
    });
    certTypeBtns.appendChild(btn);
  });
  // Auto-select 一般
  const defaultBtn = certTypeBtns.querySelector('.soap-type-chip');
  if (defaultBtn) defaultBtn.click();
}

// Strip "(以下空白)" suffix from disease portion
function certStripSuffix(s) {
  return s.replace(/\s*[（(]以下空白[）)]\s*$/, '');
}

function renderCertPicker(typeData, typeName) {
  certPicker.hidden = false;
  const numChips  = document.getElementById('cert-num-chips');
  const disSect   = certDisChips.closest('.soap-chip-section');
  const procSect  = certProcChips.closest('.soap-chip-section');

  const diseases  = typeData.disease  || [];
  const processes = typeData.process  || [];

  numChips.innerHTML      = '';
  certDisChips.innerHTML  = '';
  certProcChips.innerHTML = '';
  disSect.hidden  = diseases.length === 0;
  procSect.hidden = processes.length === 0;

  // Number chips 1.–5. — appended inline with a space on the disease line
  ['1.','2.','3.','4.','5.'].forEach(num => {
    const chip = document.createElement('button');
    chip.className = 'soap-chip';
    chip.textContent = num;
    addChipEvents(chip, () => {
      const lines = certTextarea.value ? certTextarea.value.split('\n') : [''];
      const base = certStripSuffix(lines[0] || '');
      lines[0] = (base ? base + ' ' + num : num) + '(以下空白)';
      certTextarea.value = lines.join('\n');
      chip.classList.add('soap-chip-used');
      setTimeout(() => chip.classList.remove('soap-chip-used'), 600);
    }, num);
    numChips.appendChild(chip);
  });

  diseases.forEach(item => {
    const chip = document.createElement('button');
    chip.className = 'soap-chip';
    chip.textContent = item;
    addChipEvents(chip, () => {
      const lines = certTextarea.value ? certTextarea.value.split('\n') : [''];
      let dis = certStripSuffix(lines[0] || '');
      const isInjury = /[傷折]/.test(item);
      if (isInjury) {
        dis = dis.replace(/(骨折|[扭擦挫]*傷)$/, '') + item;
      } else {
        const m = dis.match(/^(.*?)(骨折|[扭擦挫]*傷)$/);
        dis = m ? m[1] + item + m[2] : dis + item;
      }
      lines[0] = dis + '(以下空白)';
      certTextarea.value = lines.join('\n');
      chip.classList.add('soap-chip-used');
      setTimeout(() => chip.classList.remove('soap-chip-used'), 600);
    }, item);
    certDisChips.appendChild(chip);
  });

  processes.forEach(item => {
    const chip = document.createElement('button');
    chip.className = 'soap-chip';
    chip.textContent = item;
    const procText = fillCertDate(item);
    addChipEvents(chip, () => {
      certInsertProcess(procText);
      chip.classList.add('soap-chip-used');
      setTimeout(() => chip.classList.remove('soap-chip-used'), 600);
    }, procText);
    certProcChips.appendChild(chip);
  });
}

function certInsertProcess(item) {
  const lines = certTextarea.value ? certTextarea.value.split('\n') : [''];
  if (lines.length < 2) lines.push('');
  const proc = lines[1];

  // Special case B: proc has 接受， and item contains 手術 → insert between 接受 and ，
  if (proc.includes('接受，') && item.includes('手術')) {
    lines[1] = proc.replace('接受，', `接受${item}，`);
    certTextarea.value = lines.join('\n');
    return;
  }

  // Special case: proc has 出院， and item is a post-discharge modifier
  const isShuHou = item.includes('術後');
  const isYi     = item.startsWith('宜');
  if (proc.includes('出院，') && (isShuHou || isYi)) {
    const idx    = proc.indexOf('出院，') + '出院，'.length;
    const prefix = proc.slice(0, idx);
    let suffix   = proc.slice(idx);
    // Extract existing modifiers (ends with ，not 。) from suffix
    let shuHou = '';
    let yi     = '';
    suffix = suffix.replace(/術後[^，]*，/, m => { shuHou = m; return ''; });
    suffix = suffix.replace(/宜[^，。\n]+，/, m => { yi = m; return ''; });
    const addComma = s => s && !s.endsWith('，') ? s + '，' : s;
    if (isShuHou) shuHou = addComma(item);
    else          yi     = addComma(item);
    let newProc = prefix + shuHou + yi + suffix;
    // If chip contains 及門診追蹤治療 and suffix has 宜門診追蹤治療。, merge into 及門診追蹤治療。
    newProc = newProc.replace(/及門診追蹤治療，宜門診追蹤治療。/g, '及門診追蹤治療。');
    lines[1] = newProc;
    certTextarea.value = lines.join('\n');
    return;
  }

  if (item.includes('接受治療') || item.includes('接受手術')) {
    lines[1] = item; // main sentence: replace
  } else if (proc.includes('，建議')) {
    lines[1] = proc.replace('，建議', `，${item}，建議`);
  } else if (proc.includes('接受治療，') || proc.includes('接受手術，')) {
    lines[1] = proc.replace(/(接受(?:治療|手術)，)/, `$1${item}，`);
  } else {
    lines[1] = proc ? `${proc}\n${item}` : item;
  }
  certTextarea.value = lines.join('\n');
}

certTabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    certTabBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    certSheet = btn.dataset.certSheet;
    renderCertTypes(certSheet);
  });
});

certCopyBtn.addEventListener('click', () => {
  const raw = certTextarea.value;
  const lines = raw.split('\n');
  if (lines[0] !== undefined && !lines[0].trim()) lines.shift();
  const text = lines.join('\n');
  navigator.clipboard.writeText(text).catch(() => {});
  showToast('已複製診斷書');
  certLastVal = raw;
  certTextarea.value = '';
  certRestoreBtn.disabled = false;
});

certRestoreBtn.addEventListener('click', () => {
  certTextarea.value = certLastVal;
  certRestoreBtn.disabled = true;
});

document.querySelectorAll('.tab').forEach(btn => {
  if (btn.dataset.page === 'cert') {
    btn.addEventListener('click', () => renderCertTypes(certSheet), { once: false });
  }
});

// ─── 衛教 tab ─────────────────────────────────────────────────────────────────
const EDU_PRES_ID = '1M2-ZfIjzO0mXN2nePp99eWvPHYpaTX1TFthmtVwh0Ms';
let eduLoaded = false;

async function loadEdu() {
  const container = document.getElementById('edu-btns');
  if (eduLoaded) return;
  container.innerHTML = '<span style="color:#aaa;font-size:.85rem">載入中…</span>';
  const cached = lsGet('edu');
  let data = cached;
  if (!data) {
    const url = `${OPS_SCRIPT_URL}?token=${encodeURIComponent(OPS_TOKEN)}&sheet=${encodeURIComponent('衛教')}`;
    data = await fetchWithRetry(url);
    if (!data) {
      container.innerHTML = '<span style="color:#d93025;font-size:.85rem">載入失敗</span>';
      return;
    }
    lsSet('edu', data);
  }
  eduLoaded = true;
  container.innerHTML = '';
  data.forEach(({ name, slideId }) => {
    const btn = document.createElement('button');
    btn.className = 'soap-type-chip';
    btn.textContent = name;
    btn.addEventListener('click', () => {
      const url = `https://docs.google.com/presentation/d/${EDU_PRES_ID}/preview#slide=${slideId}`;
      window.open(url, '_blank');
    });
    container.appendChild(btn);
  });
}

// ─── Pre-fetch all sheet data on unlock ──────────────────────────────────────
function prefetchAll() {
  loadOpsData();
  loadSoapData('SOAP中正');
  loadSoapData('SOAP門診');
  loadCertData('診斷書中正');
  loadCertData('診斷書門診');
  // notes loaded on demand
}

// ─── Refresh button ───────────────────────────────────────────────────────────
document.getElementById('refresh-btn').addEventListener('click', () => {
  ['ops','soap_SOAP中正','soap_SOAP門診','cert_診斷書中正','cert_診斷書門診','notes','edu'].forEach(k => {
    try { localStorage.removeItem(k); } catch(e) {}
  });
  location.reload();
});

// Default to SOAP page on load
document.querySelector('.tab[data-page="soap"]').click();

// ─── Service worker ───────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
