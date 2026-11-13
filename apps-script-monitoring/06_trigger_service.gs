function setupAllTriggers() {
  const properties = PropertiesService.getScriptProperties();
  const results = [];

  setupTriggers();
  results.push("Looker: 14:00 dan 16:00");
  setupFileStatusTrigger0900();
  results.push("File Status: 09:00");
  deleteLegacyDcpMonitoringTriggers_();
  replaceDailyTrigger_("runDcpMonitoringScheduled0700", 7);
  replaceDailyTrigger_("runDcpMonitoringScheduled0800", 8);
  results.push("DCP: weekday 07:00; weekend/holiday 08:00");
  removeRetiredVisualizationTriggers_();

  const dailyCopyHour = parseOptionalTriggerHour_(
    properties.getProperty("DAILY_COPY_HOUR")
  );
  if (dailyCopyHour !== null) {
    replaceDailyTrigger_("copyTemplateDaily", dailyCopyHour);
    results.push("Daily Copy: " + padTriggerHour_(dailyCopyHour) + ":00");
  } else {
    results.push("Daily Copy: skipped (set DAILY_COPY_HOUR)");
  }

  deleteAirflowMonitoringTriggers_();
  results.push("Airflow: manual dari sidebar (tanpa trigger)");
  installHolidayConfigurationEditTrigger_();
  results.push("Holiday: on-edit schedule refresh + pending warning");

  return { configured: results };
}

function deleteLegacyDcpMonitoringTriggers_() {
  const legacyHandlers = ["runDcpMonitoring0700"];
  ScriptApp.getProjectTriggers()
    .filter(trigger =>
      legacyHandlers.indexOf(trigger.getHandlerFunction()) !== -1
    )
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));
}

function installHolidayConfigurationEditTrigger_() {
  const handlerName = "handleHolidayConfigurationEdit";
  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === handlerName)
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));
  const config = getConfig();
  const template = SpreadsheetApp.openById(config.templateId);
  ScriptApp.newTrigger(handlerName)
    .forSpreadsheet(template)
    .onEdit()
    .create();
}

function deleteAirflowMonitoringTriggers_() {
  const handlerNames = [
    "updateAllAirflowDags",
    "runAirflowMonitoring0900",
    "runAirflowMonitoring1100",
    "runAirflowMonitoring1330",
    "runAirflowMonitoring1400",
    "runAirflowMonitoring1700"
  ];
  ScriptApp.getProjectTriggers()
    .filter(trigger =>
      handlerNames.indexOf(trigger.getHandlerFunction()) !== -1
    )
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));
}

function replaceDailyTrigger_(handlerName, hour) {
  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === handlerName)
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));

  ScriptApp.newTrigger(handlerName)
    .timeBased()
    .everyDays(1)
    .atHour(hour)
    .create();
}

function parseOptionalTriggerHour_(value) {
  const text = String(value === null ? "" : value).trim();
  if (!text) return null;
  if (!/^(?:[0-9]|1[0-9]|2[0-3])$/.test(text)) {
    throw new Error("Jam trigger harus berupa angka 0 sampai 23: " + text);
  }
  return Number(text);
}

function padTriggerHour_(hour) {
  return String(hour).padStart(2, "0");
}

// Remove previously installed triggers before deploying without the retired service.
function removeRetiredVisualizationTriggers_() {
  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === "refreshDagVisualizationHourly")
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));
}
