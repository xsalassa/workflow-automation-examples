const CONFIG = {
  sheetsToDelete: [
    'Log', 'Run History', 'Holiday', 'Schedule', 'Employees',
    PROJECT_SHEETS.DAG_VISUALIZATION
  ],
  timeZone: Session.getScriptTimeZone()
};

function getConfig() {
  const properties = PropertiesService.getScriptProperties();
  const templateId = (properties.getProperty('TEMPLATE_ID') || '').trim();
  const rootFolderId = (properties.getProperty('ROOT_FOLDER_ID') || '').trim();
  const masterListId = (properties.getProperty('MASTER_LIST_ID') || '').trim();
  const missingProperties = [];

  if (!templateId) missingProperties.push('TEMPLATE_ID');
  if (!rootFolderId) missingProperties.push('ROOT_FOLDER_ID');
  if (!masterListId) missingProperties.push('MASTER_LIST_ID');

  if (missingProperties.length) {
    throw new Error(
      'Missing required Script Properties: ' + missingProperties.join(', ')
    );
  }

  return Object.assign({}, CONFIG, {
    templateId: templateId,
    rootFolderId: rootFolderId,
    masterListId: masterListId
  });
}

function copyTemplateDaily() {
  const config = getConfig();
  const now = new Date();
  const dateStr = Utilities.formatDate(now, config.timeZone, "yyyy-MM-dd");
  let templateSS;
  let fileAction = "";
  const processLogs = [];
  const logStep = message => {
    const logMessage = `[copyTemplateDaily] ${message}`;
    processLogs.push(logMessage);
    Logger.log(logMessage);
  };

  try {
    logStep(`START date=${dateStr}`);
    logStep(`Opening template: ${config.templateId}`);
    templateSS = SpreadsheetApp.openById(config.templateId);
    logStep(`Template opened: ${templateSS.getName()}`);
    validateTemplate_(templateSS, {
      includeFormulaCheck: true,
      throwOnError: true
    });
    logStep("Template validation passed");

    const dateCompact = Utilities.formatDate(now, config.timeZone, "yyyyMMdd");
    const yearStr = Utilities.formatDate(now, config.timeZone, "yyyy");
    const monthStr = Utilities.formatDate(now, config.timeZone, "yyyyMM");
    const newFileName = `EXAMPLE Daily Checkpoint - ${dateCompact}`;
    logStep(`Target file name: ${newFileName}`);

    const scheduleResult = generateScheduleForSpreadsheet_(templateSS);
    logStep(
      "Schedule refreshed: rows=" + scheduleResult.rowsGenerated +
      ", nonWorking=" + scheduleResult.nonWorkingRowsGenerated
    );
    const dayContext = getMonitoringDayContext_(
      templateSS,
      now,
      config.timeZone
    );
    const reportDates = [dateStr];
    logStep(
      "Monitoring context: dayType=" + dayContext.dayTypeDisplay +
      ", monitoringType=" + dayContext.monitoringType +
      ", assignmentSource=" + dayContext.assignmentSourceDate +
      ", Ops=" + dayContext.monitoring1 +
      ", DCP=" + dayContext.monitoring2
    );
    clearDailyRuntimeProperties();
    logStep("Previous daily runtime properties cleared before processing");

    const rootFolder = DriveApp.getFolderById(config.rootFolderId);
    logStep(`Root folder opened: ${config.rootFolderId}`);
    const yearFolder = getOrCreateFolder(rootFolder, yearStr);
    const targetFolder = getOrCreateFolder(yearFolder, monthStr);
    logStep(`Target folder ready: ${yearStr}/${monthStr}`);

    const existingFile = getFirstFileByName(targetFolder, newFileName);
    logStep(existingFile ? `Existing file found: ${existingFile.getId()}` : "Existing file not found");
    let copiedFile;
    let newSS;

    if (existingFile) {
      copiedFile = existingFile;
      fileAction = 'ALREADY_EXISTS';
      logStep('Opening existing target spreadsheet: ' + copiedFile.getId());
      newSS = SpreadsheetApp.openById(copiedFile.getId());
      validateExistingDailyFile_(newSS, dayContext);
      updateDailyRuntimeProperties(
        copiedFile.getId(),
        dateStr,
        reportDates,
        dayContext
      );
      logStep("ALREADY_EXISTS: existing contents preserved");
      logStatus(
        templateSS,
        dateStr,
        newFileName,
        "SUCCESS",
        "ALREADY_EXISTS | dayType=" + dayContext.dayTypeDisplay
      );
      return {
        status: "ALREADY_EXISTS",
        dailyFileId: copiedFile.getId(),
        dailyFileDate: dateStr,
        dayType: dayContext.dayTypeDisplay,
        monitoringType: dayContext.monitoringType
      };
    } else {
      logStep('Creating empty target spreadsheet without bound Apps Script');
      newSS = SpreadsheetApp.create(newFileName);
      copiedFile = DriveApp.getFileById(newSS.getId());
      copiedFile.moveTo(targetFolder);
      fileAction = 'CREATED_NEW';
      logStep('Empty target spreadsheet created and moved: ' + copiedFile.getId());
    }

    logStep(fileAction + ': ' + copiedFile.getId());
    logStep('Target spreadsheet opened: ' + newSS.getName());
    logStep('Replacing spreadsheet contents from template');
    replaceSpreadsheetContents(templateSS, newSS, config.sheetsToDelete, logStep);
    newSS.setSpreadsheetLocale(templateSS.getSpreadsheetLocale());
    newSS.setSpreadsheetTimeZone(templateSS.getSpreadsheetTimeZone());
    logStep('Spreadsheet contents, locale, and time zone replaced');
    applyDailyMonitoringProfile_(newSS, dayContext, logStep);

    const picOpsName = dayContext.monitoring1;
    const picDcpName = dayContext.monitoring2;
    logStep(`PIC resolved: Ops=${picOpsName}, DCP=${picDcpName}`);

    const updateSheet = (name, dateCell, picCell, picValue) => {
      const sheet = newSS.getSheetByName(name);
      if (sheet) {
        sheet.getRange(dateCell).setValue(dateStr);
        sheet.getRange(picCell).setValue(picValue);
        logStep(`Updated ${name}: ${dateCell}=${dateStr}, ${picCell}=${picValue}`);
      } else {
        logStep(`Sheet not found, skipped update: ${name}`);
      }
    };

    updateSheet('Ops Checkpoint', 'B2', 'B3', picOpsName);
    updateSheet('DCP Checkpoint', 'B2', 'B3', picDcpName);
    setDailyDayType_(newSS, dayContext, logStep);

    const notifUserSheet = newSS.getSheetByName('Notif User');
    if (notifUserSheet) {
      const b3Range = notifUserSheet.getRange('B3');
      b3Range.copyTo(b3Range, {contentsOnly: true});
      logStep("Notif User B3 converted to value");
    } else {
      logStep("Notif User sheet not found, skipped B3 value conversion");
    }

    config.sheetsToDelete.forEach(name => {
      const sheet = newSS.getSheetByName(name);
      if (sheet) {
        newSS.deleteSheet(sheet);
        logStep(`Deleted sheet: ${name}`);
      } else {
        logStep(`Sheet already absent, delete skipped: ${name}`);
      }
    });

    const airflowSheet = newSS.getSheetByName('Airflow');
    if (airflowSheet) {
      const airflowTargetName = 'Monitoring Airflow ' + dateCompact;
      airflowSheet.setName(airflowTargetName);
      logStep('Renamed Airflow to ' + airflowTargetName);
      updateAirflowFormulaReferences_(newSS, airflowTargetName, logStep);

      const dashboardOps = newSS.getSheetByName('Monitoring Dashboard Ops');

      if (dashboardOps) {
        newSS.setActiveSheet(airflowSheet);
        newSS.moveActiveSheet(dashboardOps.getIndex() + 1);
        logStep('Moved current Airflow sheet after Monitoring Dashboard Ops');
      }

      updateMonitoringAirflowDateFormula_(airflowSheet, logStep);
    } else {
      logStep("Airflow sheet not found, skipped Airflow rename/duplicate");
    }

    updateMonitoringAirflowDcpFormula_(newSS, logStep);
    reparseSheetFormulas_(newSS, "Monitoring Databricks Jobs", logStep);
    repairDcpSemanticGateFormula_(newSS, dayContext, logStep);
    reparseSheetFormulas_(newSS, "DCP Checkpoint", logStep);
    configureDynamicSummary_(newSS, dayContext, logStep);
    applyOpsCheckpointTimeValidation_(newSS, logStep);
    hideSummarySheet_(newSS, logStep);

    // --- BAGIAN UPDATE MASTER FILE ---
    try {
      logStep(`Opening master list: ${config.masterListId}`);
      const masterSS = SpreadsheetApp.openById(config.masterListId);
      const masterSheet = masterSS.getSheetByName("Plot Monitoring");

      if (masterSheet) {
        logStep("Master sheet opened: Plot Monitoring");
        const baseUrl = copiedFile.getUrl();
        const dcpSheet = newSS.getSheetByName("DCP Checkpoint");
        const opsSheet = newSS.getSheetByName("Ops Checkpoint");

        // 1. Update Link URL (Logic Lama)
        const setLink = (sourceSheet, rangeA1, targetCell) => {
          if (sourceSheet) {
            const url = baseUrl + "#gid=" + sourceSheet.getSheetId() + "&range=" + rangeA1;
            masterSheet.getRange(targetCell).setValue(url);
            logStep(`Master link updated: ${targetCell} -> ${sourceSheet.getName()}!${rangeA1}`);
          } else {
            logStep(`Master link skipped for ${targetCell}, source sheet not found`);
          }
        };

        const linkMappings = dayContext.isNonWorking
          ? [
            [dcpSheet, "C6:C12", "E2"],
            [opsSheet, "C6:C9", "E3"],
            [opsSheet, "C10:C11", "E7"],
            [opsSheet, "C12:C24", "E12"],
            [opsSheet, "C25", "E15"]
          ]
          : [
            [dcpSheet, "C6:C16", "E2"],
            [opsSheet, "C6:C12", "E3"],
            [opsSheet, "C13", "E7"],
            [opsSheet, "C14:C15", "E12"],
            [opsSheet, "C27:C28", "E15"]
          ];
        linkMappings.forEach(item => setLink(item[0], item[1], item[2]));

        // 2. Update PIC Name di Kolom F berdasarkan Kolom B (Logic Baru)
        const masterValues = masterSheet.getDataRange().getValues();
        for (let i = 0; i < masterValues.length; i++) {
          const rowLabel = masterValues[i][1]; // Index 1 adalah Kolom B

          if (rowLabel === "Monitoring EXAMPLE") {
            // Update Kolom F (Index 5) di baris tersebut
            masterSheet.getRange(i + 1, 6).setValue(picOpsName);
            logStep(`Master PIC updated row ${i + 1}: Monitoring EXAMPLE -> ${picOpsName}`);
          } else if (rowLabel === "Monitoring DCP + NON EXAMPLE") {
            // Update Kolom F (Index 5) di baris tersebut
            masterSheet.getRange(i + 1, 6).setValue(picDcpName);
            logStep(`Master PIC updated row ${i + 1}: Monitoring DCP + NON EXAMPLE -> ${picDcpName}`);
          }
        }

      } else {
        logStep("Master sheet not found: Plot Monitoring");
      }
    } catch (linkErr) {
      logStep("Failed to save links/PIC to master: " + linkErr.message);
    }

    updateDailyRuntimeProperties(
      copiedFile.getId(),
      dateStr,
      reportDates,
      dayContext
    );
    logStep(
      "Daily runtime properties updated: file=" + copiedFile.getId() +
      ", date=" + dateStr + ", reportDates=" + reportDates.join(", ")
    );
    try {
      const cleanupResult = cleanupStatusFormulaProperties_(newSS);
      logStep(
        "Airflow formula properties cleaned: " + cleanupResult.deletedCount
      );
    } catch (cleanupError) {
      logStep(
        "Airflow formula property cleanup failed: " + cleanupError.message
      );
    }

    logStep("SUCCESS");
    logStatus(
      templateSS,
      dateStr,
      newFileName,
      "SUCCESS",
      fileAction +
      " | dayType=" + dayContext.dayTypeDisplay +
      " | monitoringType=" + dayContext.monitoringType +
      " | source=" + dayContext.assignmentSourceDate
    );

    return {
      status: "CREATED_NEW",
      dailyFileId: copiedFile.getId(),
      dailyFileDate: dateStr,
      dayType: dayContext.dayTypeDisplay,
      monitoringType: dayContext.monitoringType,
      monitoring1: picOpsName,
      monitoring2: picDcpName
    };

  } catch (err) {
    logStep(`ERROR: ${err.message}`);
    if (templateSS) {
      const lastStep = processLogs.length ? processLogs[processLogs.length - 1] : "-";
      logStatus(templateSS, dateStr, "-", "ERROR", `${err.message} | Last: ${lastStep}`);
    }
    throw err;
  }
}

function applyDailyMonitoringProfile_(spreadsheet, context, logStep) {
  const weekdayOps = spreadsheet.getSheetByName(PROJECT_SHEETS.OPS_CHECKPOINT);
  const weekendOps = spreadsheet.getSheetByName(
    PROJECT_SHEETS.OPS_CHECKPOINT_WEEKEND
  );

  if (context.isNonWorking) {
    if (!weekendOps) {
      throw new Error("Sheet Ops Checkpoint Weekend tidak ditemukan");
    }
    if (weekdayOps) spreadsheet.deleteSheet(weekdayOps);
    weekendOps.setName(PROJECT_SHEETS.OPS_CHECKPOINT);
    logStep("Activated Ops Checkpoint Weekend as Ops Checkpoint");

    const semanticSheet = spreadsheet.getSheetByName(
      "Refresh Semantic Power BI"
    );
    if (semanticSheet) {
      spreadsheet.deleteSheet(semanticSheet);
      logStep("Deleted Refresh Semantic Power BI for non-working date");
    }
    removeDcpSemanticTask_(spreadsheet, logStep);
    setDcpCheckingTime_(spreadsheet, 9, logStep);
  } else {
    if (!weekdayOps) throw new Error("Sheet Ops Checkpoint tidak ditemukan");
    if (weekendOps) {
      spreadsheet.deleteSheet(weekendOps);
      logStep("Deleted Ops Checkpoint Weekend for weekday file");
    }
    setDcpCheckingTime_(spreadsheet, 8, logStep);
  }
}

function removeDcpSemanticTask_(spreadsheet, logStep) {
  const sheet = spreadsheet.getSheetByName("DCP Checkpoint");
  if (!sheet) throw new Error("Sheet DCP Checkpoint tidak ditemukan");
  const lastRow = sheet.getLastRow();
  const labels = sheet.getRange(1, 3, lastRow, 1).getDisplayValues();
  const index = labels.findIndex(row =>
    /Check Refresh Semantic Power BI/i.test(String(row[0] || ""))
  );
  if (index === -1) {
    logStep("DCP Semantic task already absent");
    return;
  }
  sheet.deleteRow(index + 1);
  logStep("Deleted DCP Semantic task at row " + (index + 1));
}

function setDcpCheckingTime_(spreadsheet, hour, logStep) {
  const sheet = spreadsheet.getSheetByName("DCP Checkpoint");
  if (!sheet) throw new Error("Sheet DCP Checkpoint tidak ditemukan");
  const lastRow = sheet.getLastRow();
  if (lastRow < 6) return;
  const taskValues = sheet.getRange(6, 3, lastRow - 5, 1)
    .getDisplayValues();
  taskValues.forEach((row, index) => {
    if (!String(row[0] || "").trim()) return;
    sheet.getRange(index + 6, 2)
      .setValue(hour / 24)
      .setNumberFormat("HH:mm");
  });
  logStep("Set DCP checking time to " + String(hour).padStart(2, "0") + ":00");
}

function setDailyDayType_(spreadsheet, context, logStep) {
  ["Ops Checkpoint", "DCP Checkpoint"].forEach(name => {
    const sheet = spreadsheet.getSheetByName(name);
    if (!sheet) return;
    sheet.getRange("A4").setValue("DAY TYPE");
    sheet.getRange("B4").setValue(context.dayTypeDisplay);
  });
  logStep("Set DAY TYPE=" + context.dayTypeDisplay);
}

function repairDcpSemanticGateFormula_(spreadsheet, context, logStep) {
  if (context.isNonWorking) return;
  const sheet = spreadsheet.getSheetByName("DCP Checkpoint");
  if (!sheet) return;
  const formula = sheet.getRange("H9").getFormula();
  if (!formula) return;
  const repaired = formula
    .replace(/\bF8\b/g, "F9")
    .replace(/\bG8\b/g, "G9");
  if (repaired !== formula) {
    sheet.getRange("H9").setFormula(repaired);
    logStep("Repaired DCP Checkpoint H9 gate to F9/G9");
  }
}

function validateExistingDailyFile_(spreadsheet, context) {
  const ops = spreadsheet.getSheetByName("Ops Checkpoint");
  const dcp = spreadsheet.getSheetByName("DCP Checkpoint");
  if (!ops || !dcp) {
    throw new Error("Existing daily file tidak memiliki Ops/DCP Checkpoint");
  }
  const dayType = String(ops.getRange("B4").getDisplayValue() || "").trim();
  if (dayType && dayType !== context.dayTypeDisplay) {
    queueHolidayChangeWarning_(
      context.dateKey,
      dayType,
      context.dayTypeDisplay
    );
  }
}

function updateMonitoringAirflowDateFormula_(sheet, logStep) {
  const range = sheet.getRange("B2");
  range.clearContent();
  SpreadsheetApp.flush();
  range.setFormula("='Ops Checkpoint'!B2");
  SpreadsheetApp.flush();

  logStep(
    "Reparsed " + sheet.getName() + "!B2 -> 'Ops Checkpoint'!B2" +
    ", result=" + range.getDisplayValue()
  );
}

function updateMonitoringAirflowDcpFormula_(spreadsheet, logStep) {
  const sheet = spreadsheet.getSheetByName("Monitoring Airflow DCP");
  const opsSheet = spreadsheet.getSheetByName("Ops Checkpoint");

  if (!sheet || !opsSheet) {
    logStep("Monitoring Airflow DCP B2 formula update skipped: sheet not found");
    return;
  }

  const range = sheet.getRange("B2");
  range.clearContent();
  SpreadsheetApp.flush();
  range.setFormula("='Ops Checkpoint'!B2");
  SpreadsheetApp.flush();

  logStep(
    "Reparsed Monitoring Airflow DCP!B2 -> 'Ops Checkpoint'!B2" +
    ", result=" + range.getDisplayValue()
  );
}

function reparseSheetFormulas_(spreadsheet, sheetName, logStep) {
  const sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    logStep(sheetName + " formula reparse skipped: sheet not found");
    return;
  }

  const dataRange = sheet.getDataRange();
  const formulas = dataRange.getFormulas();
  const formulaCells = [];

  formulas.forEach((row, rowIndex) => {
    row.forEach((formula, columnIndex) => {
      if (!formula) return;
      formulaCells.push({
        range: dataRange.getCell(rowIndex + 1, columnIndex + 1),
        formula: formula
      });
    });
  });

  if (!formulaCells.length) {
    logStep(sheetName + " formula reparse skipped: no formulas found");
    return;
  }

  formulaCells.forEach(item => item.range.clearContent());
  SpreadsheetApp.flush();
  formulaCells.forEach(item => item.range.setFormula(item.formula));
  SpreadsheetApp.flush();

  const refErrors = formulaCells
    .filter(item => item.range.getDisplayValue().indexOf("#REF!") !== -1)
    .map(item => item.range.getA1Notation());

  logStep(
    "Reparsed " + formulaCells.length + " formulas in " + sheetName +
    ", remaining #REF!=" + (refErrors.length ? refErrors.join(",") : "none")
  );
}

function applyOpsCheckpointTimeValidation_(spreadsheet, logStep) {
  const sheet = spreadsheet.getSheetByName("Ops Checkpoint");
  if (!sheet) {
    logStep("Ops Checkpoint time validation skipped: sheet not found");
    return;
  }

  const timeRange = applyOpsCheckpointTimeValidationRule_(sheet);
  if (!timeRange) {
    logStep("Ops Checkpoint time validation skipped: no data rows");
    return;
  }

  installOpsCheckpointTimeEditTrigger_(spreadsheet);
  logStep(
    "Applied unique Start/End Time validation to " + timeRange.getA1Notation()
  );
}

function applyOpsCheckpointTimeValidationRule_(sheet) {
  const firstDataRow = 6;
  const rowCount = sheet.getMaxRows() - firstDataRow + 1;
  if (rowCount < 1) return null;

  const lastDataRow = firstDataRow + rowCount - 1;
  const timeRange = sheet.getRange(firstDataRow, 6, rowCount, 2);
  const validation = SpreadsheetApp.newDataValidation()
    .requireFormulaSatisfied(
      '=OR(F' + firstDataRow + '="",COUNTIF($F$' + firstDataRow +
      ':$G$' + lastDataRow + ',F' + firstDataRow + ')=1)'
    )
    .setAllowInvalid(false)
    .setHelpText("Tolong isi dengan real time monitoring Anda")
    .build();

  timeRange.setDataValidation(validation);
  timeRange.setNumberFormat("HH:mm");
  return timeRange;
}

function installOpsCheckpointTimeEditTrigger_(spreadsheet) {
  const handlerName = "validateOpsCheckpointTimeOnEdit";
  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === handlerName)
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));

  ScriptApp.newTrigger(handlerName)
    .forSpreadsheet(spreadsheet)
    .onEdit()
    .create();
}

function validateOpsCheckpointTimeOnEdit(e) {
  if (!e || !e.range) return;

  const editedRange = e.range;
  const sheet = editedRange.getSheet();
  if (sheet.getName() !== "Ops Checkpoint") return;

  const firstDataRow = 6;
  const firstEditedRow = Math.max(firstDataRow, editedRange.getRow());
  const lastEditedRow = editedRange.getLastRow();
  const firstEditedColumn = Math.max(6, editedRange.getColumn());
  const lastEditedColumn = Math.min(7, editedRange.getLastColumn());
  if (
    lastEditedRow < firstDataRow ||
    firstEditedColumn > lastEditedColumn
  ) return;

  const lastDataRow = sheet.getMaxRows();
  const values = sheet
    .getRange(firstDataRow, 6, lastDataRow - firstDataRow + 1, 2)
    .getValues();
  const timeZone = e.source.getSpreadsheetTimeZone();
  const cellsToClear = new Set();

  // If Start Time and End Time on an affected row match, always clear G.
  for (let row = firstEditedRow; row <= lastEditedRow; row += 1) {
    const rowValues = values[row - firstDataRow];
    const startTime = normalizeOpsCheckpointTime_(rowValues[0], timeZone);
    const endTime = normalizeOpsCheckpointTime_(rowValues[1], timeZone);
    if (startTime !== null && startTime === endTime) {
      cellsToClear.add("G" + row);
    }
  }

  const isEditedCell = (row, column) => (
    row >= firstEditedRow && row <= lastEditedRow &&
    column >= firstEditedColumn && column <= lastEditedColumn
  );
  const usedTimes = new Set();

  // Values that existed outside the paste/edit range take precedence.
  values.forEach((rowValues, rowIndex) => {
    const row = firstDataRow + rowIndex;
    rowValues.forEach((value, columnIndex) => {
      const column = 6 + columnIndex;
      const a1 = (column === 6 ? "F" : "G") + row;
      if (isEditedCell(row, column) || cellsToClear.has(a1)) return;

      const normalizedTime = normalizeOpsCheckpointTime_(value, timeZone);
      if (normalizedTime !== null) usedTimes.add(normalizedTime);
    });
  });

  // A pasted value is removed if the same time exists anywhere above or below
  // it in either F or G. For a multi-cell paste, only the first value is kept.
  for (let row = firstEditedRow; row <= lastEditedRow; row += 1) {
    for (
      let column = firstEditedColumn;
      column <= lastEditedColumn;
      column += 1
    ) {
      const a1 = (column === 6 ? "F" : "G") + row;
      if (cellsToClear.has(a1)) continue;

      const value = values[row - firstDataRow][column - 6];
      const normalizedTime = normalizeOpsCheckpointTime_(value, timeZone);
      if (normalizedTime === null) continue;

      if (usedTimes.has(normalizedTime)) {
        cellsToClear.add(a1);
      } else {
        usedTimes.add(normalizedTime);
      }
    }
  }

  if (cellsToClear.size) {
    sheet.getRangeList(Array.from(cellsToClear)).clearContent();
    e.source.toast(
      "Tolong isi dengan real time monitoring Anda",
      "Invalid",
      5
    );
  }

  // Ctrl+C / Ctrl+V can overwrite validation metadata. Restore the rule after
  // every user edit that touches F:G.
  applyOpsCheckpointTimeValidationRule_(sheet);
}

function normalizeOpsCheckpointTime_(value, timeZone) {
  if (value === "" || value === null) return null;
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, timeZone, "HH:mm:ss");
  }
  if (typeof value === "number" && isFinite(value)) {
    const secondsPerDay = 24 * 60 * 60;
    return Math.round(((value % 1) + 1) % 1 * secondsPerDay) % secondsPerDay;
  }
  return String(value).trim();
}

function hideSummarySheet_(spreadsheet, logStep) {
  const sheet = spreadsheet.getSheetByName("Summary");
  if (!sheet) {
    logStep("Summary sheet hide skipped: sheet not found");
    return;
  }
  if (!sheet.isSheetHidden()) sheet.hideSheet();
  logStep("Summary sheet hidden; results remain available to Control Panel");
}

function updateAirflowFormulaReferences_(spreadsheet, targetSheetName, logStep) {
  const opsSheet = spreadsheet.getSheetByName("Ops Checkpoint");
  if (!opsSheet) {
    logStep("Ops Checkpoint not found, Airflow formula update skipped");
    return;
  }

  const formulaRange = opsSheet.getDataRange();
  const formulas = formulaRange.getFormulas();
  const escapedTargetName = targetSheetName.replace(/'/g, "''");
  const targetReference = "'" + escapedTargetName + "'!";
  let updatedCount = 0;

  formulas.forEach((row, rowIndex) => {
    row.forEach((formula, columnIndex) => {
      if (!formula) return;

      const updatedFormula = formula.replace(
        /(?:'Airflow'|Airflow)!/g,
        targetReference
      );
      if (updatedFormula === formula) return;

      formulaRange.getCell(rowIndex + 1, columnIndex + 1)
        .setFormula(updatedFormula);
      updatedCount++;
    });
  });

  logStep(
    "Updated Ops Checkpoint Airflow formula references: " + updatedCount
  );
}

function updateDailyRuntimeProperties(
  fileId,
  fileDate,
  reportDates,
  dayContext
) {
  const values = {
    DAILY_FILE_ID: fileId,
    DAILY_FILE_DATE: fileDate,
    LOOKER_REPORT_DATES: JSON.stringify(reportDates)
  };
  if (dayContext) {
    values.DAILY_DAY_TYPE = dayContext.dayTypeDisplay;
    values.DAILY_MONITORING_TYPE = dayContext.monitoringType;
    values.DAILY_ASSIGNMENT_SOURCE_DATE =
      dayContext.assignmentSourceDate;
  }
  PropertiesService.getScriptProperties().setProperties(values, false);
}

function clearDailyRuntimeProperties() {
  const properties = PropertiesService.getScriptProperties();
  properties.deleteProperty("DAILY_FILE_ID");
  properties.deleteProperty("DAILY_FILE_DATE");
  properties.deleteProperty("LOOKER_REPORT_DATES");
  properties.deleteProperty("DAILY_DAY_TYPE");
  properties.deleteProperty("DAILY_MONITORING_TYPE");
  properties.deleteProperty("DAILY_ASSIGNMENT_SOURCE_DATE");
}

function getPreviousNonWorkingDates(referenceDate, holidayDates, timeZone) {
  const dates = [];
  const candidate = new Date(referenceDate.getTime());
  const maxLookbackDays = 31;

  for (let offset = 1; offset <= maxLookbackDays; offset++) {
    candidate.setDate(candidate.getDate() - 1);

    const dateStr = Utilities.formatDate(candidate, timeZone, "yyyy-MM-dd");
    const isNonWorking = isProjectNonWorkingDate_(
      candidate,
      holidayDates,
      timeZone
    );

    if (!isNonWorking) {
      return dates;
    }

    dates.push({
      dateStr: dateStr,
      dateCompact: Utilities.formatDate(candidate, timeZone, "yyyyMMdd")
    });
  }

  throw new Error(
    "Non-working date sequence exceeds " + maxLookbackDays + " days"
  );
}

function getOrCreateFolder(parentFolder, folderName) {
  const folders = parentFolder.getFoldersByName(folderName);
  if (folders.hasNext()) {
    Logger.log(`[copyTemplateDaily] Folder exists: ${folderName}`);
    return folders.next();
  }

  Logger.log(`[copyTemplateDaily] Creating folder: ${folderName}`);
  return parentFolder.createFolder(folderName);
}

function getFirstFileByName(folder, fileName) {
  const files = folder.getFilesByName(fileName);
  return files.hasNext() ? files.next() : null;
}

function replaceSpreadsheetContents(sourceSS, targetSS, excludedSheetNames, logStep) {
  const log = logStep || (message => Logger.log(`[copyTemplateDaily] ${message}`));
  const excludedNames = excludedSheetNames || [];
  log(`Reading template sheets from: ${sourceSS.getId()}`);
  const sourceSheets = sourceSS.getSheets().slice().sort((left, right) => {
    if (left.getName() === "Airflow") return -1;
    if (right.getName() === "Airflow") return 1;
    return 0;
  });
  log(`Template sheet count: ${sourceSheets.length}`);

  log(`Creating temporary sheet in target: ${targetSS.getId()}`);
  const tempSheet = targetSS.insertSheet(`TEMP_REPLACE_${Date.now()}`);
  const tempSheetId = tempSheet.getSheetId();
  log(`Temporary sheet created: ${tempSheet.getName()}`);

  targetSS.getSheets().forEach(sheet => {
    if (sheet.getSheetId() !== tempSheetId) {
      log(`Deleting existing sheet: ${sheet.getName()}`);
      targetSS.deleteSheet(sheet);
    }
  });

  sourceSheets.forEach(sourceSheet => {
    const sheetName = sourceSheet.getName();
    if (excludedNames.includes(sheetName)) {
      log(`Skipped template sheet because it will be deleted later: ${sheetName}`);
      return;
    }

    try {
      log(`Copying template sheet: ${sheetName}`);
      const copiedSheet = copySheetWithRetry(sourceSheet, targetSS, sheetName, log);
      copiedSheet.setName(sheetName);
      log(`Copied template sheet: ${sheetName}`);
    } catch (err) {
      throw new Error(`Failed copying template sheet "${sheetName}": ${err.message}`);
    }
  });

  log(`Deleting temporary sheet: ${tempSheet.getName()}`);
  targetSS.deleteSheet(tempSheet);
  log("Temporary sheet deleted");
}

function copySheetWithRetry(sourceSheet, targetSS, sheetName, log) {
  const maxAttempts = 3;
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (attempt > 1) {
        log(`Retrying copy for ${sheetName}, attempt ${attempt}/${maxAttempts}`);
      }
      const copiedSheet = sourceSheet.copyTo(targetSS);
      SpreadsheetApp.flush();
      Utilities.sleep(500);
      return copiedSheet;
    } catch (err) {
      lastError = err;
      log(`Copy failed for ${sheetName}, attempt ${attempt}/${maxAttempts}: ${err.message}`);
      Utilities.sleep(1000 * attempt);
    }
  }

  throw lastError;
}

function logStatus(ss, date, fileName, status, note) {
  const now = new Date();
  recordRunHistory_(
    ss,
    "copyTemplateDaily",
    now,
    now,
    status,
    "date=" + date + " | file=" + fileName + " | " + note
  );
}
