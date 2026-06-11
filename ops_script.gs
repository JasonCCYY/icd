// ─── 設定 ────────────────────────────────────────────────────────────────────
const SECRET_TOKEN = 'cycicd-ops-X7m3K9pQ';  // 可自行更改，需與 app.js 一致
const SHEET_NAME   = '手術碼';               // 工作表分頁名稱

// ─── 主要入口 ─────────────────────────────────────────────────────────────────
function doGet(e) {
  // CORS headers
  const output = (data, status) =>
    ContentService
      .createTextOutput(JSON.stringify({ status, data }))
      .setMimeType(ContentService.MimeType.JSON);

  // 驗證 token
  if (!e || !e.parameter || e.parameter.token !== SECRET_TOKEN) {
    return output(null, 'unauthorized');
  }

  try {
    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) return output(null, 'sheet_not_found');

    const values = sheet.getDataRange().getValues();
    // 跳過第一列 header（名稱, 手術碼, 部位, 左/右, 處置）
    const rows = values.slice(1)
      .map(r => ({
        name: String(r[0] || '').trim(),
        code: String(r[1] || '').trim(),
        part: String(r[2] || '').trim(),
        side: String(r[3] || '').trim(),
        proc: String(r[4] || '').trim(),
      }))
      .filter(r => r.name || r.code || r.part || r.proc);

    return output(rows, 'ok');
  } catch(err) {
    return output(null, 'error: ' + err.message);
  }
}
