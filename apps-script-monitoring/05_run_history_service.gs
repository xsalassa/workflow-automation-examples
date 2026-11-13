function recordRunHistory_(
  spreadsheet,
  functionName,
  startedAt,
  endedAt,
  status,
  details
) {
  if (!spreadsheet) return;
  try {
    let sheet = spreadsheet.getSheetByName(PROJECT_SHEETS.RUN_HISTORY);
    if (!sheet) {
      sheet = spreadsheet.insertSheet(PROJECT_SHEETS.RUN_HISTORY);
      sheet.getRange(1, 1, 1, 6).setValues([[
        "Started_At",
        "Ended_At",
        "Function",
        "Status",
        "Duration_Seconds",
        "Details"
      ]]);
      sheet.setFrozenRows(1);
    }

    const duration = Math.max(
      0,
      Math.round((endedAt.getTime() - startedAt.getTime()) / 1000)
    );
    sheet.appendRow([
      startedAt,
      endedAt,
      functionName,
      status,
      duration,
      String(details || "").slice(0, 2000)
    ]);
    sheet.getRange(sheet.getLastRow(), 1, 1, 2)
      .setNumberFormat("yyyy-MM-dd HH:mm:ss");
  } catch (error) {
    console.error("[Run History] " + error.message);
  }
}
