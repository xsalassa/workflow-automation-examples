/**
 * Refresh runtime properties for today's existing daily spreadsheet.
 * This function does not modify the spreadsheet contents.
 */
function refreshDailyRuntimeProperties() {
  const config = getConfig();
  const now = new Date();
  const dateStr = Utilities.formatDate(now, config.timeZone, "yyyy-MM-dd");
  const dateCompact = Utilities.formatDate(now, config.timeZone, "yyyyMMdd");
  const yearStr = Utilities.formatDate(now, config.timeZone, "yyyy");
  const monthStr = Utilities.formatDate(now, config.timeZone, "yyyyMM");
  const fileName = "EXAMPLE Daily Checkpoint - " + dateCompact;

  const templateSS = SpreadsheetApp.openById(config.templateId);
  const dayContext = getMonitoringDayContext_(
    templateSS,
    now,
    config.timeZone
  );

  const rootFolder = DriveApp.getFolderById(config.rootFolderId);
  const yearFolder = getExistingRuntimeFolder_(rootFolder, yearStr);
  const monthFolder = getExistingRuntimeFolder_(yearFolder, monthStr);
  const dailyFile = getFirstFileByName(monthFolder, fileName);

  if (!dailyFile) {
    clearDailyRuntimeProperties();
    throw new Error(
      "Daily spreadsheet not found: " + yearStr + "/" + monthStr +
      "/" + fileName
    );
  }

  const reportDates = [dateStr];
  updateDailyRuntimeProperties(
    dailyFile.getId(),
    dateStr,
    reportDates,
    dayContext
  );

  const result = {
    dailyFileId: dailyFile.getId(),
    dailyFileDate: dateStr,
    reportDates: reportDates,
    dayType: dayContext.dayTypeDisplay,
    monitoringType: dayContext.monitoringType,
    assignmentSourceDate: dayContext.assignmentSourceDate
  };
  Logger.log(
    "[refreshDailyRuntimeProperties] Updated: " + JSON.stringify(result)
  );
  return result;
}

/**
 * Apply the latest Ops Checkpoint edit validation to today's existing daily
 * spreadsheet without recreating or replacing its contents.
 */
function applyOpsValidationToExistingDailyFile() {
  const runtime = refreshDailyRuntimeProperties();
  const spreadsheet = SpreadsheetApp.openById(runtime.dailyFileId);
  const logs = [];
  const logStep = message => {
    const logMessage = "[applyOpsValidationToExistingDailyFile] " + message;
    logs.push(logMessage);
    Logger.log(logMessage);
  };

  applyOpsCheckpointTimeValidation_(spreadsheet, logStep);

  return {
    dailyFileId: runtime.dailyFileId,
    dailyFileDate: runtime.dailyFileDate,
    dailyFileName: spreadsheet.getName(),
    status: "APPLIED",
    logs: logs
  };
}

function refreshDailyAirflowFormulaReferences() {
  const properties = PropertiesService.getScriptProperties();
  const dailyFileId = (properties.getProperty("DAILY_FILE_ID") || "").trim();
  const dailyFileDate = (
    properties.getProperty("DAILY_FILE_DATE") || ""
  ).trim();

  if (!dailyFileId || !/^\d{4}-\d{2}-\d{2}$/.test(dailyFileDate)) {
    throw new Error(
      "Daily runtime properties are unavailable. " +
      "Run refreshDailyRuntimeProperties() first."
    );
  }

  const spreadsheet = SpreadsheetApp.openById(dailyFileId);
  const targetSheetName =
    "Monitoring Airflow " + dailyFileDate.replace(/-/g, "");

  if (!spreadsheet.getSheetByName(targetSheetName)) {
    throw new Error("Airflow sheet not found: " + targetSheetName);
  }

  updateMonitoringAirflowDateFormula_(
    spreadsheet.getSheetByName(targetSheetName),
    message => Logger.log(
      "[refreshDailyAirflowFormulaReferences] " + message
    )
  );
  updateAirflowFormulaReferences_(
    spreadsheet,
    targetSheetName,
    message => Logger.log(
      "[refreshDailyAirflowFormulaReferences] " + message
    )
  );
  updateMonitoringAirflowDcpFormula_(
    spreadsheet,
    message => Logger.log(
      "[refreshDailyAirflowFormulaReferences] " + message
    )
  );

  return {
    dailyFileId: dailyFileId,
    targetSheetName: targetSheetName
  };
}

function getRuntimeHolidayDates_(templateSS, timeZone) {
  if (!templateSS.getSheetByName(PROJECT_SHEETS.HOLIDAY)) {
    Logger.log(
      "[refreshDailyRuntimeProperties] Holiday sheet not found; " +
      "continuing without public holidays"
    );
  }
  return getHolidayDateSet_(templateSS, timeZone);
}

function getExistingRuntimeFolder_(parentFolder, folderName) {
  const folders = parentFolder.getFoldersByName(folderName);

  if (!folders.hasNext()) {
    throw new Error("Folder not found: " + folderName);
  }

  return folders.next();
}
