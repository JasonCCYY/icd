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

// ─── Tab navigation ───────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`page-${btn.dataset.page}`).classList.add('active');
    document.getElementById('header-title').textContent = btn.dataset.title;
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

let opsData = null; // parsed rows

async function loadOpsData() {
  if (opsData) return opsData;
  if (OPS_SCRIPT_URL === 'PASTE_YOUR_APPS_SCRIPT_URL_HERE') {
    opsStatusEl.textContent = '尚未設定 Apps Script URL';
    return [];
  }
  opsStatusEl.innerHTML = '<span class="spinner"></span>載入手術碼資料…';
  try {
    const url  = `${OPS_SCRIPT_URL}?token=${encodeURIComponent(OPS_TOKEN)}`;
    const resp = await fetch(url);
    const json = await resp.json();
    if (json.status !== 'ok') {
      opsStatusEl.textContent = `載入失敗：${json.status}`;
      return [];
    }
    opsData = json.data;
    opsStatusEl.textContent = '';
    return opsData;
  } catch(e) {
    opsStatusEl.textContent = '載入失敗，請檢查網路或 Apps Script 設定';
    return [];
  }
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

const soapTabBtns   = document.querySelectorAll('.soap-tab-btn');
const soapTypeBtns  = document.getElementById('soap-type-btns');
const soapPicker    = document.getElementById('soap-picker');
const soapDateBtn   = document.getElementById('soap-date-btn');
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

let soapXrLabel = 'XR';

function soapLines() {
  const text = soapTextarea.value;
  const parse = {};
  for (const key of ['S','PE','P']) {
    const m = text.match(new RegExp(`^${key}:(.*)$`, 'm'));
    parse[key] = m ? m[1].trim() : '';
  }
  const xrMatch = text.match(new RegExp(`^${soapXrLabel}:(.*)$`, 'm'));
  parse.XR = xrMatch ? xrMatch[1].trim() : '';
  return parse;
}

function buildSoapText(lines) {
  return `S: ${lines.S||''}\nPE: ${lines.PE||''}\n${soapXrLabel}: ${lines.XR||''}\nP: ${lines.P||''}`;
}

function filterSoapText(text) {
  return text.split('\n')
    .filter(line => {
      const m = line.match(/^[A-Z]+:\s*(.*)$/);
      return !m || m[1].trim() !== '';
    })
    .join('\n');
}

function appendToLine(key, value) {
  const lines = soapLines();
  const cur = lines[key];
  lines[key] = cur ? `${cur}, ${value}` : value;
  soapTextarea.value = buildSoapText(lines);
}

// Date chip
soapDateBtn.textContent = todayStr();
soapDateBtn.addEventListener('click', () => {
  soapDateBtn.textContent = todayStr();
  appendToLine('S', todayStr());
});

// Load SOAP data
async function loadSoapData(sheet) {
  if (soapCache[sheet]) return soapCache[sheet];
  try {
    const url  = `${SOAP_SCRIPT_URL}?token=${encodeURIComponent(SOAP_TOKEN)}&sheet=${encodeURIComponent(sheet)}`;
    const resp = await fetch(url);
    const json = await resp.json();
    if (json.status === 'ok') { soapCache[sheet] = json.data; return json.data; }
  } catch(e) {}
  return null;
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
      renderSoapPicker(typeData);
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
        const defaults = { 'Trauma': `S: pain after\nPE: \n${soapXrLabel}: \nP: ` };
        soapTextarea.value = defaults[type] || `S: \nPE: \n${soapXrLabel}: \nP: `;
      }
    });
    soapTypeBtns.appendChild(btn);
  });
}

// Render chips for selected type
function renderSoapPicker(typeData) {
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
      chip.addEventListener('click', () => {
        if (line === '__dx__') {
          // Append dx code at end, no label
          const cur = soapTextarea.value.trimEnd();
          soapTextarea.value = cur ? `${cur}\n${item}` : item;
        } else if (line === 'S' && /^(Lt|Rt)$/i.test(item)) {
          // For Lt/Rt chips, insert before "pain after" if present, else prepend
          const lines = soapLines();
          const s = lines.S;
          if (s.includes('pain after')) {
            lines.S = s.replace(/^(.*?)(pain after)/, (_, pre, pa) => `${pre}${item} ${pa}`);
          } else {
            lines.S = s ? `${item} ${s}` : item;
          }
          soapTextarea.value = buildSoapText(lines);
        } else if (line === 'XR') {
          // Strip leading "A: " prefix if present (label already in textarea)
          appendToLine('XR', item.startsWith('A: ') ? item.slice(3) : item);
        } else {
          appendToLine(line, item);
        }
        chip.classList.add('soap-chip-used');
        setTimeout(() => chip.classList.remove('soap-chip-used'), 600);
      });
      container.appendChild(chip);
    });
  });
}

// Tab switch
soapTabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    soapTabBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    soapSheet = btn.dataset.soapSheet;
    renderSoapTypes(soapSheet);
  });
});

// Editor buttons
soapCopyBtn.addEventListener('click', () => {
  const text = soapTextarea.value;
  navigator.clipboard.writeText(filterSoapText(text)).catch(() => {});
  showToast('已複製 SOAP');
  soapLastVal = text;
  soapTextarea.value = `S: \nPE: \n${soapXrLabel}: \nP: `;
  soapRestoreBtn.disabled = false;
});

soapRestoreBtn.addEventListener('click', () => {
  soapTextarea.value = soapLastVal;
  soapRestoreBtn.disabled = true;
});

// Load when SOAP tab is activated
document.querySelectorAll('.tab').forEach(btn => {
  if (btn.dataset.page === 'soap') {
    btn.addEventListener('click', () => renderSoapTypes(soapSheet), { once: false });
  }
});

// ─── Service worker ───────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
