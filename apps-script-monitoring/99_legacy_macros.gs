function legacyReorderJob() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Schedule');
  if (!sheet) {
    SpreadsheetApp.getUi().alert("Error: Sheet 'Schedule' tidak ditemukan!");
    return;
  }

  sheet.getRange('B9:M').sort({ column: 5, ascending: true });
}
