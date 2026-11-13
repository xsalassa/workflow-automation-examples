function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu("EXAMPLE Monitoring")
    .addItem("Open Control Panel", "showMonitoringControlPanel")
    .addItem("Open PIC Guide", "showPicGuide")
    .addSeparator()
    .addItem("Create Daily File", "uiCreateDailyFile")
    .addItem("Run DCP Now", "uiRunDcpMonitoring0700")
    .addItem(
      "Apply Ops Validation to Existing Daily File",
      "uiApplyOpsValidationToExistingDailyFile"
    )
    .addItem("Generate Schedule", "uiGenerateSchedule")
    .addItem("Validate Template", "uiValidateTemplate")
    .addSeparator()
    .addItem("Setup All Triggers", "uiSetupAllTriggers")
    .addToUi();
}

function showMonitoringControlPanel() {
  showPendingHolidayWarning_();
  const output = HtmlService.createHtmlOutputFromFile("81_ui_sidebar")
    .setWidth(1000)
    .setHeight(700);
  SpreadsheetApp.getUi().showModalDialog(
    output,
    "EXAMPLE Monitoring Control Panel"
  );
}

function showPicGuide() {
  const output = HtmlService.createHtmlOutputFromFile("83_pic_guide")
    .setWidth(1000)
    .setHeight(700);
  SpreadsheetApp.getUi().showModalDialog(
    output,
    "Panduan PIC Monitoring"
  );
}

function getPicGuideState() {
  const config = getConfig();
  const template = SpreadsheetApp.openById(config.templateId);
  const context = getMonitoringDayContext_(
    template,
    new Date(),
    config.timeZone
  );
  const properties = PropertiesService.getScriptProperties();
  const dailyFileId = String(
    properties.getProperty("DAILY_FILE_ID") || ""
  ).trim();
  const dailyFileDate = String(
    properties.getProperty("DAILY_FILE_DATE") || ""
  ).trim();
  let dailyFileName = "";
  let dailyFileUrl = "";
  let dailyFileStatus = "NOT_READY";
  let dailyFileMessage = "Daily file hari ini belum terdeteksi.";

  if (dailyFileId) {
    try {
      const file = DriveApp.getFileById(dailyFileId);
      dailyFileName = file.getName();
      dailyFileUrl = file.getUrl();
      if (dailyFileDate === context.dateKey) {
        dailyFileStatus = "READY";
        dailyFileMessage = "Daily file hari ini siap digunakan.";
      } else {
        dailyFileStatus = "STALE";
        dailyFileMessage =
          "Runtime masih menunjuk daily file " + dailyFileDate + ".";
      }
    } catch (error) {
      dailyFileStatus = "UNAVAILABLE";
      dailyFileMessage = "Daily file runtime tidak dapat dibuka.";
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    dateKey: context.dateKey,
    dayName: context.dayName,
    dayType: context.dayTypeDisplay,
    monitoringType: context.monitoringType,
    isNonWorking: context.isNonWorking,
    monitoring1: context.monitoring1,
    monitoring2: context.monitoring2,
    assignmentSourceDate: context.assignmentSourceDate,
    dcpAutomationTime:
      String(context.dcpAutomationHour).padStart(2, "0") + ":00",
    dcpCheckingTime: context.dcpCheckingTime,
    airflowWindows: context.airflowWindows,
    looker1400: context.looker1400,
    looker1600: context.looker1600,
    dailyFileId: dailyFileId,
    dailyFileDate: dailyFileDate,
    dailyFileName: dailyFileName,
    dailyFileUrl: dailyFileUrl,
    dailyFileStatus: dailyFileStatus,
    dailyFileMessage: dailyFileMessage,
    pendingHolidayWarnings: getPendingHolidayWarnings_().length
  };
}

function getMonitoringUiState() {
  const properties = PropertiesService.getScriptProperties();
  const dailyFileId = String(
    properties.getProperty("DAILY_FILE_ID") || ""
  ).trim();
  let dailyFileName = "";
  let dailyFileUrl = "";
  let dailySummary = [];
  let dailySummaryError = "";
  let monitoring1 = "";
  let monitoring2 = "";
  let picScheduleDate = "";
  let picSource = "";
  let dayType = properties.getProperty("DAILY_DAY_TYPE") || "";
  let monitoringType =
    properties.getProperty("DAILY_MONITORING_TYPE") || "";
  let assignmentSourceDate =
    properties.getProperty("DAILY_ASSIGNMENT_SOURCE_DATE") || "";
  let airflowWindows = [];

  if (dailyFileId) {
    try {
      const file = DriveApp.getFileById(dailyFileId);
      dailyFileName = file.getName();
      dailyFileUrl = file.getUrl();
      try {
        dailySummary = getDailySummary_(dailyFileId);
      } catch (summaryError) {
        dailySummaryError = summaryError.message;
      }
    } catch (error) {
      dailyFileName = "Daily file tidak dapat dibuka";
    }
  }

  try {
    const config = getConfig();
    const spreadsheet = SpreadsheetApp.openById(config.templateId);
    const schedule = spreadsheet.getSheetByName(PROJECT_SHEETS.SCHEDULE);
    const timeZone = spreadsheet.getSpreadsheetTimeZone();
    const today = formatProjectDate_(new Date(), timeZone);
    const employeeNames = getEmployeeNamesById_(spreadsheet);
    if (schedule && schedule.getLastRow() >= 2) {
      const row = schedule.getRange(2, 1, schedule.getLastRow() - 1, 3)
        .getValues()
        .find(item => normalizeUiScheduleDate_(item[0], timeZone) === today);
      if (row) {
        const firstId = String(row[1] || "").trim();
        const secondId = String(row[2] || "").trim();
        monitoring1 = employeeNames[firstId] || firstId;
        monitoring2 = employeeNames[secondId] || secondId;
        picScheduleDate = today;
        picSource = "Schedule terbaru";
      }
    }
    const context = getMonitoringDayContext_(
      spreadsheet,
      new Date(),
      timeZone
    );
    dayType = context.dayTypeDisplay;
    monitoringType = context.monitoringType;
    assignmentSourceDate = context.assignmentSourceDate;
    airflowWindows = context.airflowWindows;
  } catch (error) {
    console.warn("[UI] PIC state unavailable: " + error.message);
  }

  return {
    dailyFileId: dailyFileId,
    dailyFileDate: properties.getProperty("DAILY_FILE_DATE") || "",
    dailyFileName: dailyFileName,
    dailyFileUrl: dailyFileUrl,
    dailySummary: dailySummary,
    dailySummaryError: dailySummaryError,
    monitoring1: monitoring1,
    monitoring2: monitoring2,
    picScheduleDate: picScheduleDate,
    picSource: picSource,
    dayType: dayType,
    monitoringType: monitoringType,
    assignmentSourceDate: assignmentSourceDate,
    airflowWindows: airflowWindows,
    pendingHolidayWarnings: getPendingHolidayWarnings_().length
  };
}

function normalizeUiScheduleDate_(value, timeZone) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return formatProjectDate_(value, timeZone);
  }
  const text = String(value || "").trim();
  const isoMatch = text.match(/^(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})$/);
  if (isoMatch) return isoMatch[1] + "-" + isoMatch[2] + "-" + isoMatch[3];
  return "";
}

function getDailySummary_(dailyFileId) {
  const spreadsheet = SpreadsheetApp.openById(dailyFileId);
  const sheet = spreadsheet.getSheetByName("Summary");
  if (!sheet) {
    throw new Error("Sheet Summary tidak ditemukan di daily file");
  }

  SpreadsheetApp.flush();
  if (sheet.getRange("A1").getDisplayValue() === "Report_Date") {
    return getStructuredDailySummary_(sheet);
  }

  const values = sheet.getRange("A1:D9").getDisplayValues();
  return [0, 1, 2, 3].map(columnIndex => {
    const blocks = [];
    for (let rowIndex = 1; rowIndex < values.length; rowIndex++) {
      const value = String(values[rowIndex][columnIndex] || "").trim();
      if (value) {
        blocks.push({
          row: rowIndex + 1,
          text: value
        });
      }
    }
    return {
      column: columnIndex + 1,
      time: String(values[0][columnIndex] || "").trim(),
      blocks: blocks
    };
  }).filter(item => item.time || item.blocks.length);
}

function getStructuredDailySummary_(sheet) {
  const values = sheet.getRange("A2:M5").getDisplayValues();
  return values
    .filter(row => row[0] || row[1])
    .map((row, index) => {
      const metrics = [
        "OK: " + (row[2] || "0"),
        "No Schedule: " + (row[3] || "0"),
        "Running: " + (row[4] || "0"),
        "Cancelled: " + (row[5] || "0"),
        "Failed: " + (row[6] || "0")
      ].join("\n");
      const statuses = [
        ["Pubsub", row[7]],
        ["EXAMPLE", row[8]],
        ["Dashboard", row[9]],
        ["Store", row[10]],
        ["Remaining File", row[11]]
      ]
        .filter(item => item[1])
        .map(item => item[0] + ": " + item[1])
        .join("\n");
      const blocks = [
        { row: index + 2, text: metrics }
      ];
      if (statuses) blocks.push({ row: index + 2, text: statuses });
      if (row[12]) {
        blocks.push({
          row: index + 2,
          text: row[12],
          copyMessage: true
        });
      }
      return {
        column: index + 1,
        date: row[0],
        time: row[1],
        blocks: blocks
      };
    });
}

function runMonitoringUiAction(action) {
  const actions = {
    createDailyFile: () => copyTemplateDaily(),
    applyOpsValidation: () => applyOpsValidationToExistingDailyFile(),
    generateSchedule: () => generateSchedule(),
    refreshRuntime: () => refreshDailyRuntimeProperties(),
    runLooker: () => runLookerMonitoringManual(),
    runFileStatus: () => runAllStatusFileChecks(),
    runDcp0700: () => runDcpMonitoring(),
    runDcp: () => runDcpMonitoring(),
    runAirflow0900: () => runAirflowMonitoring0900(),
    runAirflow1100: () => runAirflowMonitoring1100(),
    runAirflow1330: () => runAirflowMonitoring1330(),
    runAirflow1400: () => runAirflowMonitoring1400(),
    runAirflow1700: () => runAirflowMonitoring1700(),
    validateTemplate: () => validateTemplate(),
    setupTriggers: () => setupAllTriggers()
  };

  if (!actions[action]) throw new Error("UI action tidak dikenal: " + action);
  const startedAt = new Date();
  try {
    const result = actions[action]();
    return {
      ok: true,
      action: action,
      result: result === undefined ? null : result,
      durationSeconds: Math.round((new Date() - startedAt) / 1000)
    };
  } catch (error) {
    return {
      ok: false,
      action: action,
      error: error.message,
      durationSeconds: Math.round((new Date() - startedAt) / 1000)
    };
  }
}

function uiCreateDailyFile() {
  showUiActionAlert_("createDailyFile");
}

function uiRunDcpMonitoring0700() {
  showUiActionAlert_("runDcp");
}

function uiApplyOpsValidationToExistingDailyFile() {
  showUiActionAlert_("applyOpsValidation");
}

function uiGenerateSchedule() {
  showUiActionAlert_("generateSchedule");
}

function uiValidateTemplate() {
  showUiActionAlert_("validateTemplate");
}

function uiSetupAllTriggers() {
  showUiActionAlert_("setupTriggers");
}

function showUiActionAlert_(action) {
  const response = runMonitoringUiAction(action);
  SpreadsheetApp.getUi().alert(
    response.ok
      ? "Selesai\n\n" + JSON.stringify(response.result, null, 2)
      : "Error\n\n" + response.error
  );
}
