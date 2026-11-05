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
  try {
    const data = JSON.parse(e.postData.contents);
    if (data.token !== SECRET_TOKEN) return out('unauthorized', 'invalid token');
    if (data.action !== 'injection') return out('error', 'unknown action');

    const key = String(data.category || '') + '_' + String(data.name || '').replace(/\s+/g, '');
    const p = PRODUCTS[key];
    if (!p) return out('error', 'unknown: ' + key);

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
  }
}

// ─── 主要入口 ─────────────────────────────────────────────────────────────────
function doGet(e) {
  const output = (data, status) =>
    ContentService
      .createTextOutput(JSON.stringify({ status, data }))
      .setMimeType(ContentService.MimeType.JSON);

  if (!e || !e.parameter || e.parameter.token !== SECRET_TOKEN)
    return output(null, 'unauthorized');

  const sheetName = e.parameter.sheet || '手術碼';

  try {
    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return output(null, 'sheet_not_found: ' + sheetName);

    const values = sheet.getDataRange().getValues();
    const header = values[0].map(h => String(h).trim());
    const rows   = values.slice(1);

    // ── 復健 ────────────────────────────────────────────────────────────────
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
      return output(grouped, 'ok');
    }

    // ── 備註 ────────────────────────────────────────────────────────────────
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
      return output(grouped, 'ok');
    }

    // ── 診斷碼 ──────────────────────────────────────────────────────────────
    if (sheetName === '診斷碼') {
      const data = rows
        .map(r => ({
          name: String(r[0]||'').trim(),
          code: String(r[1]||'').trim(),
        }))
        .filter(r => r.name && r.code);
      return output(data, 'ok');
    }

    // ── 手術碼 ──────────────────────────────────────────────────────────────
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
      return output(data, 'ok');
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
      return output(grouped, 'ok');
    }

    // ── SOAP 分頁（中正 / 門診）─────────────────────────────────────────────
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

    return output(grouped, 'ok');
  } catch(err) {
    return output(null, 'error: ' + err.message);
  }
}
