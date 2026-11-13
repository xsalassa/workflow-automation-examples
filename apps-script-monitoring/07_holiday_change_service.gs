function queueHolidayChangeWarning_(dateKey, previousType, currentType) {
  const properties = PropertiesService.getScriptProperties();
  const warnings = getPendingHolidayWarnings_();
  warnings.push({
    date: String(dateKey || ""),
    previousType: String(previousType || ""),
    currentType: String(currentType || ""),
    detectedAt: new Date().toISOString()
  });
  properties.setProperty(
    "PENDING_HOLIDAY_WARNING",
    JSON.stringify(warnings.slice(-20))
  );
}

function getPendingHolidayWarnings_() {
  const raw = PropertiesService.getScriptProperties()
    .getProperty("PENDING_HOLIDAY_WARNING") || "[]";
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function consumePendingHolidayWarnings_() {
  const warnings = getPendingHolidayWarnings_();
  PropertiesService.getScriptProperties()
    .deleteProperty("PENDING_HOLIDAY_WARNING");
  return warnings;
}

function handleHolidayConfigurationEdit(e) {
  if (!e || !e.range || !e.source) return;
  const sheet = e.range.getSheet();
  if (
    sheet.getName() !== PROJECT_SHEETS.HOLIDAY ||
    e.range.getColumn() > 1 ||
    e.range.getLastColumn() < 1 ||
    e.range.getLastRow() < 2
  ) {
    return;
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    e.source.toast(
      "Schedule belum diperbarui karena proses lain sedang berjalan",
      "Holiday changed",
      8
    );
    return;
  }
  try {
    const affectedDates = getHolidayEditDateKeys_(
      e.range,
      e.source.getSpreadsheetTimeZone()
    );
    generateScheduleForSpreadsheet_(e.source);
    (affectedDates.length ? affectedDates : ["Holiday"]).forEach(dateKey => {
      queueHolidayChangeWarning_(
        dateKey,
        "CONFIG_CHANGED",
        "SCHEDULE_REFRESHED"
      );
    });
    e.source.toast(
      "Schedule A:H sudah diperbarui. Daily file yang sudah ada tidak diubah.",
      "Holiday changed",
      10
    );
  } finally {
    lock.releaseLock();
  }
}

function getHolidayEditDateKeys_(range, timeZone) {
  const firstColumn = range.getColumn();
  const dateColumnOffset = 1 - firstColumn;
  if (dateColumnOffset < 0 || dateColumnOffset >= range.getNumColumns()) {
    return [];
  }
  const keys = [];
  range.getValues().forEach(row => {
    const value = row[dateColumnOffset];
    if (!(value instanceof Date) || isNaN(value.getTime())) return;
    const key = formatProjectDate_(value, timeZone);
    if (keys.indexOf(key) === -1) keys.push(key);
  });
  return keys;
}

function showPendingHolidayWarning_() {
  const warnings = consumePendingHolidayWarnings_();
  if (!warnings.length) return;
  const dates = warnings
    .map(item => item.date)
    .filter((value, index, values) => value && values.indexOf(value) === index)
    .join(", ");
  SpreadsheetApp.getUi().alert(
    "Holiday configuration changed",
    "Schedule sudah diperbarui, tetapi daily file yang sudah ada tidak " +
    "diubah otomatis." + (dates ? "\n\nAffected: " + dates : "") +
    "\n\nLakukan rebuild manual hanya bila benar-benar diperlukan.",
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}
