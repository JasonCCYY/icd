function cleanProcessingCodes() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const lastRow = sheet.getLastRow();

  // Column E = index 5
  const range = sheet.getRange(2, 5, lastRow - 1, 1);
  const values = range.getValues();

  const cleaned = values.map(([cell]) => {
    if (!cell) return [''];
    // Remove all Chinese characters and extra whitespace, keep alphanumeric only
    const result = String(cell)
      .replace(/[一-鿿]/g, '')  // remove all CJK characters
      .replace(/\s+/g, '')               // remove all spaces
      .trim();
    return [result];
  });

  range.setValues(cleaned);
  SpreadsheetApp.getUi().alert(`完成！共處理 ${values.length} 列。`);
}
