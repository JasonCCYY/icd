// ─── 設定 ────────────────────────────────────────────────────────────────────
const SECRET_TOKEN = 'cycicd-ops-X7m3K9pQ';

// ─── 針劑 → 手術紀錄試算表 ────────────────────────────────────────────────────
const ORTHO_SS_ID = '1g_nw2_rzJfrzu0KEOPaW3lSDNxxaDweN2FeWzONqCbg';

// key = category(mat/clinic) + '_' + 按鈕文字(去空白)
const PRODUCTS = {
  'mat_羊膜10mg':    ['小施', '羊膜10mg',  5000],
  'mat_羊膜20mg':    ['小施', '羊膜20mg', 14000],
  'mat_PRP15K':      ['小施', 'PRP 15K',   5650],
  'mat_PRP36K':      ['小施', 'PRP 36K',  13420],
  'mat_RevoTend':    ['浩群', 'RevoTend',  6860],
  'clinic_外泌體':   ['外泌體',   3000],
  'clinic_PRP':      ['PRP',      3000],
  'clinic_門診護具': ['門診護具',    0],
  'clinic_增生':     ['增生',      400],
  'clinic_玻尿酸':   ['玻尿酸',    345],
  'clinic_震波':     ['震波',      250],
};

function doPost(e) {
  const out = (status, msg) =>
    ContentService
      .createTextOutput(JSON.stringify({ status, msg }))
      .setMimeType(ContentService.MimeType.JSON);
  const lock = LockService.getScriptLock();
  let locked = false;
  try {
    const data = JSON.parse(e.postData.contents);
    if (data.token !== SECRET_TOKEN) return out('unauthorized', 'invalid token');
    if (data.action !== 'injection') return out('error', 'unknown action');

    const key = String(data.category || '') + '_' + String(data.name || '').replace(/\s+/g, '');
    const p = PRODUCTS[key];
    if (!p) return out('error', 'unknown: ' + key);

    // 同時送出多筆時排隊寫入，避免寫到同一列
    lock.waitLock(10000);
    locked = true;

    const ss  = SpreadsheetApp.openById(ORTHO_SS_ID);
    const day = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy/MM/dd');
    if (data.category === 'mat') {
      const [brand, product, price] = p;
      ss.getSheetByName('骨材記錄').appendRow([day, brand, product, price, 1, '門診', 'false']);
    } else {
      const [product, price] = p;
      ss.getSheetByName('門診記錄').appendRow([day, product, price, 1]);
    }
    return out('ok', 'ok');
  } catch (err) {
    return out('error', err.message);
  } finally {
    if (locked) lock.releaseLock();
  }
}

// ─── 讀取快取（5 分鐘）────────────────────────────────────────────────────────
// CacheService 單筆上限約 100KB，所以把內容切成小段存放。
const CACHE_SEC   = 300;
const CACHE_CHUNK = 30000; // 字元數（中文 1 字最多 3 bytes → 約 90KB）

function cacheGet_(name) {
  try {
    const c    = CacheService.getScriptCache();
    const meta = c.get('m:' + name);
    if (!meta) return null;
    const keys  = Array.from({ length: Number(meta) }, (_, i) => 'c:' + name + ':' + i);
    const parts = c.getAll(keys);
    let s = '';
    for (const k of keys) {
      if (parts[k] == null) return null;
      s += parts[k];
    }
    return s;
  } catch (err) {
    return null;
  }
}

function cachePut_(name, str) {
  try {
    const n = Math.ceil(str.length / CACHE_CHUNK);
    if (n > 40) return;
    const obj = {};
    for (let i = 0; i < n; i++) {
      obj['c:' + name + ':' + i] = str.slice(i * CACHE_CHUNK, (i + 1) * CACHE_CHUNK);
    }
    obj['m:' + name] = String(n);
    CacheService.getScriptCache().putAll(obj, CACHE_SEC);
  } catch (err) {
    // 快取失敗不影響回應
  }
}

// ─── 主要入口 ─────────────────────────────────────────────────────────────────
function doGet(e) {
  const respond = body =>
    ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JSON);

  if (!e || !e.parameter || e.parameter.token !== SECRET_TOKEN)
    return respond(JSON.stringify({ status: 'unauthorized', data: null }));

  const sheetName = e.parameter.sheet || '手術碼';
  const fresh     = e.parameter.fresh === '1';   // App 按「重新整理」時略過快取
  const cacheable = sheetName.length <= 40;

  if (cacheable && !fresh) {
    const hit = cacheGet_(sheetName);
    if (hit) return respond(hit);
  }

  let result;
  try {
    result = readSheet_(sheetName);
  } catch (err) {
    result = { status: 'error: ' + err.message, data: null };
  }
  const body = JSON.stringify(result);
  if (cacheable && result.status === 'ok') cachePut_(sheetName, body);
  return respond(body);
}

// ─── 讀取並整理各分頁 ─────────────────────────────────────────────────────────
function readSheet_(sheetName) {
  const ok = data => ({ status: 'ok', data });

  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return { status: 'sheet_not_found: ' + sheetName, data: null };

  const values = sheet.getDataRange().getValues();
  const header = values[0].map(h => String(h).trim());
  const rows   = values.slice(1);

  // ── 復健 ──────────────────────────────────────────────────────────────────
  if (sheetName === '復健') {
    const grouped = {};
    rows.forEach(r => {
      const cat  = String(r[0]||'').trim();
      const name = String(r[1]||'').trim();
      if (!cat || !name) return;
      const items = r.slice(2).map(v => String(v||'').trim()).filter(v => v);
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push({ name, items });
    });
    return ok(grouped);
  }

  // ── 備註 ──────────────────────────────────────────────────────────────────
  if (sheetName === '備註') {
    const grouped = {};
    rows.forEach(r => {
      const type = String(r[0]||'').trim();
      if (!type) return;
      // 「常用-」或「常見-」開頭：B~F 欄每格一項；其餘只取 B 欄
      const cells = /^(常用|常見)/.test(type)
        ? r.slice(1, 6).map(v => String(v||'').trim()).filter(v => v)
        : [String(r[1]||'').trim()].filter(v => v);
      if (!cells.length) return;
      if (!grouped[type]) grouped[type] = [];
      grouped[type].push(...cells);
    });
    return ok(grouped);
  }

  // ── 診斷碼 ────────────────────────────────────────────────────────────────
  if (sheetName === '診斷碼') {
    const data = rows
      .map(r => ({
        name: String(r[0]||'').trim(),
        code: String(r[1]||'').trim(),
      }))
      .filter(r => r.name && r.code);
    return ok(data);
  }

  // ── 手術碼 ────────────────────────────────────────────────────────────────
  if (sheetName === '手術碼') {
    const data = rows
      .map(r => ({
        name: String(r[0]||'').trim(),
        code: String(r[1]||'').trim(),
        part: String(r[2]||'').trim(),
        side: String(r[3]||'').trim(),
        proc: String(r[4]||'').trim(),
      }))
      .filter(r => r.name || r.code || r.part || r.proc);
    return ok(data);
  }

  // ── 診斷書分頁 ────────────────────────────────────────────────────────────
  // Columns: 類型(0) 疾病(1) 過程(2)
  if (sheetName.startsWith('診斷書')) {
    const grouped = {};
    rows.forEach(r => {
      const type = String(r[0]||'').trim();
      if (!type) return;
      if (!grouped[type]) grouped[type] = { disease:[], process:[] };
      const add = (arr, val) => { const v = String(val||'').trim(); if (v) arr.push(v); };
      add(grouped[type].disease, r[1]);
      add(grouped[type].process, r[2]);
    });
    Object.values(grouped).forEach(g => {
      g.disease = [...new Set(g.disease)];
      g.process = [...new Set(g.process)];
    });
    return ok(grouped);
  }

  // ── SOAP 分頁（中正 / 門診）───────────────────────────────────────────────
  // Header-driven: supports multiple columns with same name (e.g. two 診斷碼 cols)
  const COL_KEY = { 'S':'S', 'PE':'PE', 'XR':'XR', 'P':'P', '診斷碼':'dx' };

  // Build column groups: key -> [ [colIdx, ...], ... ] grouped by consecutive same-name spans
  const colGroups = {}; // key -> array of column-index arrays (one sub-array per group)
  header.forEach((h, i) => {
    if (i === 0) return;
    const key = COL_KEY[h];
    if (!key) return;
    if (!colGroups[key]) colGroups[key] = [[]];
    // New group when the previous column had a different header
    else if (header[i - 1] !== h) colGroups[key].push([]);
    colGroups[key][colGroups[key].length - 1].push(i);
  });

  // Collect per type, per key, per column-group
  const raw = {}; // type -> key -> [ [values in group0], [values in group1], ... ]
  rows.forEach(r => {
    const type = String(r[0]||'').trim();
    if (!type) return;
    if (!raw[type]) {
      raw[type] = {};
      Object.values(COL_KEY).forEach(k => { raw[type][k] = (colGroups[k]||[[]]).map(() => []); });
    }
    Object.entries(colGroups).forEach(([key, groups]) => {
      groups.forEach((cols, gIdx) => {
        cols.forEach(ci => {
          const v = String(r[ci]||'').trim();
          if (v) raw[type][key][gIdx].push(v);
        });
      });
    });
  });

  // Deduplicate within each group (preserve all '---'), then join groups with '---'
  const dedup = arr => arr.reduce((acc, v) => {
    if (v === '---' || !acc.includes(v)) acc.push(v);
    return acc;
  }, []);

  const grouped = {};
  Object.entries(raw).forEach(([type, sections]) => {
    grouped[type] = {};
    Object.entries(sections).forEach(([key, groups]) => {
      const flat = [];
      groups.forEach((g, i) => {
        const d = dedup(g);
        if (d.length === 0) return;
        if (flat.length > 0) flat.push('---');
        flat.push(...d);
      });
      grouped[type][key] = flat;
    });
  });

  return ok(grouped);
}
