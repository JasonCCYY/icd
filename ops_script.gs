// ─── 設定 ────────────────────────────────────────────────────────────────────
const SECRET_TOKEN = 'cycicd-ops-X7m3K9pQ';

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

    // ── SOAP 分頁（中正 / 門診）─────────────────────────────────────────────
    // Columns: 類型(0) S(1) PE(2) XR(3) P(4) 診斷碼(5)
    const grouped = {};
    rows.forEach(r => {
      const type = String(r[0]||'').trim();
      if (!type) return;
      if (!grouped[type]) grouped[type] = { S:[], PE:[], XR:[], P:[], dx:[] };
      const add = (arr, val) => { const v = String(val||'').trim(); if (v) arr.push(v); };
      add(grouped[type].S,  r[1]);
      add(grouped[type].PE, r[2]);
      add(grouped[type].XR, r[3]);
      add(grouped[type].P,  r[4]);
      add(grouped[type].dx, r[5]);
    });

    // Deduplicate
    Object.values(grouped).forEach(g => {
      ['S','PE','XR','P','dx'].forEach(k => {
        g[k] = [...new Set(g[k])];
      });
    });

    return output(grouped, 'ok');
  } catch(err) {
    return output(null, 'error: ' + err.message);
  }
}
