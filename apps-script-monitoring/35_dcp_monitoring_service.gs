const DCP_MONITORING_CONFIG = {
  TIMEZONE: "Asia/Jakarta",
  CHECKPOINT_SHEET_NAME: "DCP Checkpoint",
  AIRFLOW_SHEET_NAME: "Monitoring Airflow DCP",
  DATABRICKS_SHEET_NAME: "Monitoring Databricks Jobs",
  AIRFLOW_CHECKPOINT_ROW: 7,
  DATABRICKS_CHECKPOINT_ROW: 8,
  CHECKPOINT_START_COLUMN: 6,
  CHECKPOINT_END_COLUMN: 7,
  AIRFLOW_FIRST_ROW: 9,
  DATABRICKS_FIRST_ROW: 5,
  PARAMETER_COLUMN: 3,
  SCHEDULE_RESULT_COLUMN: 4,
  SCHEDULE_COLUMN: 5,
  JOB_NAME_COLUMN: 6,
  DETAIL_START_COLUMN: 9,
  DETAIL_END_COLUMN: 10,
  DETAIL_STATUS_COLUMN: 12,
  DETAIL_NOTES_COLUMN: 13,
  EMAIL_GRACE_MINUTES: 30,
  EMAIL_MATCH_TOLERANCE_MINUTES: 12 * 60,
  DATABRICKS_SUCCESS_SUBJECT: "Your Azure Databricks job has finished its run",
  DATABRICKS_FAILED_SUBJECT: "A job run has terminated with the error: in Azure Databricks",
  DATABRICKS_WORKSPACE: "example-workspace",
  DATABRICKS_WORKSPACE_ID: "DATABRICKS_WORKSPACE_ID"
};

function runDcpMonitoring0700() {
  const tasks = [
    { name: "fileCount", run: () => runDcpStatusFileCountCheck() },
    { name: "airflow", run: () => runDcpAirflowMonitoring0700() },
    { name: "databricks", run: () => runDcpDatabricksMonitoring() }
  ];
  const results = {};
  tasks.forEach(task => {
    try {
      results[task.name] = task.run();
    } catch (error) {
      results[task.name] = {
        status: "ERROR",
        error: String(error.message || error)
      };
    }
  });
  return results;
}

function runDcpMonitoring() {
  return runDcpMonitoring0700();
}

function runDcpMonitoringScheduled0700() {
  const context = getRuntimeMonitoringContext_();
  if (context.isNonWorking) {
    return {
      status: "SKIPPED_NOT_APPLICABLE",
      date: context.dateKey,
      expectedAutomationHour: 8
    };
  }
  return runDcpMonitoring();
}

function runDcpMonitoringScheduled0800() {
  const context = getRuntimeMonitoringContext_();
  if (!context.isNonWorking) {
    return {
      status: "SKIPPED_NOT_APPLICABLE",
      date: context.dateKey,
      expectedAutomationHour: 7
    };
  }
  return runDcpMonitoring();
}

function runDcpAirflowMonitoring0700() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    throw new Error("Another monitoring process is still running");
  }

  const startedAt = new Date();
  let checkpointSheet = null;
  try {
    const context = getDcpMonitoringRuntimeContext_();
    checkpointSheet = context.spreadsheet.getSheetByName(
      DCP_MONITORING_CONFIG.CHECKPOINT_SHEET_NAME
    );
    if (!checkpointSheet) throw new Error("Sheet DCP Checkpoint tidak ditemukan");
    startDcpCheckpointTiming_(
      checkpointSheet,
      DCP_MONITORING_CONFIG.AIRFLOW_CHECKPOINT_ROW,
      startedAt
    );
    const airflowSheet = context.spreadsheet.getSheetByName(
      DCP_MONITORING_CONFIG.AIRFLOW_SHEET_NAME
    );
    if (!airflowSheet) throw new Error("Sheet Monitoring Airflow DCP tidak ditemukan");
    const airflowBaseUrl = getRequiredProperty_(
      PropertiesService.getScriptProperties(),
      "AIRFLOW_BASE_URL"
    ).replace(/\/+$/, "");
    const results = processDcpAirflowSheet_(
      airflowSheet,
      airflowBaseUrl,
      context.dailyFileDate
    );
    return summarizeAirflowWindowSheet_(airflowSheet.getName(), results);
  } finally {
    try {
      if (checkpointSheet) {
        finishDcpCheckpointTiming_(
          checkpointSheet,
          DCP_MONITORING_CONFIG.AIRFLOW_CHECKPOINT_ROW,
          startedAt,
          new Date()
        );
      }
    } finally {
      lock.releaseLock();
    }
  }
}

function processDcpAirflowSheet_(sheet, airflowBaseUrl, dailyFileDate) {
  const monitoringDate = parseSheetDate_(
    sheet.getRange(AIRFLOW_CONFIG.MONITORING_DATE_CELL).getValue()
  );
  if (!monitoringDate) throw new Error("Tanggal Monitoring Airflow DCP tidak valid");

  const firstRow = DCP_MONITORING_CONFIG.AIRFLOW_FIRST_ROW;
  const lastRow = sheet.getLastRow();
  if (lastRow < firstRow) return [];
  const rowCount = lastRow - firstRow + 1;
  const rawRows = sheet.getRange(firstRow, 3, rowCount, 11).getValues();
  const displayRows = sheet.getRange(firstRow, 3, rowCount, 11).getDisplayValues();
  const now = new Date();
  const summaries = [];

  rawRows.forEach((row, index) => {
    const rowNumber = firstRow + index;
    const dagId = String(row[3] || "").trim();
    if (!dagId) return;
    const currentStatus = String(displayRows[index][9] || "").trim().toUpperCase();
    if (currentStatus === "OK") return;

    try {
      const schedule = parseSheetTime_(row[2], DCP_MONITORING_CONFIG.TIMEZONE);
      if (!schedule) throw new Error("Schedule pada Column E tidak valid");
      const targetRunDate = getTargetRunDate_(monitoringDate, schedule);
      const targetDateTime = combineDateAndSchedule_(targetRunDate, schedule);
      const shouldRun = shouldJobRunOnDate_(
        displayRows[index][0] || row[0],
        targetRunDate,
        DCP_MONITORING_CONFIG.TIMEZONE
      );
      if (!shouldRun) {
        setDcpDetailNoSchedule_(sheet, rowNumber, "NO SCHEDULE");
        summaries.push({ row: rowNumber, dagId: dagId, status: "NO SCHEDULE" });
        return;
      }
      if (!isScheduleDue_(targetDateTime, now)) {
        summaries.push({ row: rowNumber, dagId: dagId, status: "NOT DUE" });
        return;
      }

      const dagRun = getDagRunByTargetSchedule_(
        airflowBaseUrl,
        dagId,
        targetDateTime,
        DCP_MONITORING_CONFIG.TIMEZONE
      );
      if (!dagRun) {
        if (isGracePeriodPassed_(
          targetDateTime,
          now,
          AIRFLOW_CONFIG.NOT_FOUND_GRACE_MINUTES
        )) {
          setDcpDetailFailure_(
            sheet,
            rowNumber,
            "NOT FOUND",
            "DAG run tidak ditemukan untuk " +
              formatDateTimeObject_(targetDateTime, DCP_MONITORING_CONFIG.TIMEZONE)
          );
          summaries.push({ row: rowNumber, dagId: dagId, status: "NOT FOUND" });
        } else {
          summaries.push({ row: rowNumber, dagId: dagId, status: "WAITING GRACE PERIOD" });
        }
        return;
      }

      let taskInstances;
      try {
        taskInstances = getTaskInstances_(airflowBaseUrl, dagId, dagRun.dag_run_id);
      } catch (taskError) {
        if (
          String(dagRun.state || "").toUpperCase() === "RUNNING" &&
          isAirflowPermissionDenied_(taskError)
        ) {
          taskInstances = [];
        } else {
          throw taskError;
        }
      }
      const result = buildMonitoringResult_(
        dagRun,
        taskInstances,
        DCP_MONITORING_CONFIG.TIMEZONE
      );
      const childResult = evaluateTriggeredChildDags_(
        airflowBaseUrl,
        dagId,
        dagRun.dag_run_id,
        taskInstances
      );
      if (result.status !== "SUCCESS") addParentDagNote_(result, airflowBaseUrl);
      if (childResult) {
        result.status = resolveChildTreeStatus_(result.status, [childResult]);
        appendChildResultToParent_(result, childResult);
      }
      updateDcpAirflowRow_(sheet, rowNumber, result);
      summaries.push({
        row: rowNumber,
        dagId: dagId,
        dagRunId: result.dagRunId,
        status: result.status,
        start: result.startTime,
        end: result.endTime
      });
    } catch (error) {
      setDcpDetailFailure_(
        sheet,
        rowNumber,
        "ERROR",
        String(error.message || error)
      );
      summaries.push({
        row: rowNumber,
        dagId: dagId,
        status: "ERROR",
        error: String(error.message || error)
      });
    }
  });
  sheet.autoResizeRows(firstRow, rowCount);
  SpreadsheetApp.flush();
  return summaries;
}

function updateDcpAirflowRow_(sheet, rowNumber, result) {
  const startRange = sheet.getRange(rowNumber, DCP_MONITORING_CONFIG.DETAIL_START_COLUMN);
  const endRange = sheet.getRange(rowNumber, DCP_MONITORING_CONFIG.DETAIL_END_COLUMN);
  const statusRange = sheet.getRange(rowNumber, DCP_MONITORING_CONFIG.DETAIL_STATUS_COLUMN);
  const notesRange = sheet.getRange(rowNumber, DCP_MONITORING_CONFIG.DETAIL_NOTES_COLUMN);
  backupStatusFormulaTemplate_(statusRange);
  writeDcpDetailTime_(startRange, result.rawStartDate);
  writeDcpDetailTime_(endRange, result.rawEndDate);
  if (result.status === "SUCCESS") {
    restoreDcpStatusFormula_(statusRange);
    notesRange.clearContent();
  } else {
    statusRange.setValue(result.status);
    writeAirflowNotes_(notesRange, getNotesForStatus_(result), result.noteLinks || []);
  }
  notesRange.setWrap(true).setVerticalAlignment("top");
}

function runDcpDatabricksMonitoring() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    throw new Error("Another monitoring process is still running");
  }

  const startedAt = new Date();
  let checkpointSheet = null;
  try {
    const context = getDcpMonitoringRuntimeContext_();
    checkpointSheet = context.spreadsheet.getSheetByName(
      DCP_MONITORING_CONFIG.CHECKPOINT_SHEET_NAME
    );
    if (!checkpointSheet) throw new Error("Sheet DCP Checkpoint tidak ditemukan");
    startDcpCheckpointTiming_(
      checkpointSheet,
      DCP_MONITORING_CONFIG.DATABRICKS_CHECKPOINT_ROW,
      startedAt
    );
    const sheet = context.spreadsheet.getSheetByName(
      DCP_MONITORING_CONFIG.DATABRICKS_SHEET_NAME
    );
    if (!sheet) throw new Error("Sheet Monitoring Databricks Jobs tidak ditemukan");
    return processDcpDatabricksSheet_(sheet, context.dailyFileDate);
  } finally {
    try {
      if (checkpointSheet) {
        finishDcpCheckpointTiming_(
          checkpointSheet,
          DCP_MONITORING_CONFIG.DATABRICKS_CHECKPOINT_ROW,
          startedAt,
          new Date()
        );
      }
    } finally {
      lock.releaseLock();
    }
  }
}

function processDcpDatabricksSheet_(sheet, dailyFileDate) {
  const monitoringDate = parseSheetDate_(sheet.getRange("B2").getValue());
  if (!monitoringDate) throw new Error("Tanggal Monitoring Databricks Jobs tidak valid");
  const firstRow = DCP_MONITORING_CONFIG.DATABRICKS_FIRST_ROW;
  const lastRow = sheet.getLastRow();
  if (lastRow < firstRow) return { checked: 0, statuses: {} };
  const rowCount = lastRow - firstRow + 1;
  const rawRows = sheet.getRange(firstRow, 2, rowCount, 12).getValues();
  const displayRows = sheet.getRange(firstRow, 2, rowCount, 12).getDisplayValues();
  const now = new Date();
  const results = [];

  rawRows.forEach((row, index) => {
    const rowNumber = firstRow + index;
    const jobName = String(row[4] || "").trim();
    if (!jobName) return;
    try {
      const schedule = parseSheetTime_(row[3], DCP_MONITORING_CONFIG.TIMEZONE);
      if (!schedule) throw new Error("Schedule pada Column E tidak valid");
      const targetRunDate = getTargetRunDate_(monitoringDate, schedule);
      const targetDateTime = combineDateAndSchedule_(targetRunDate, schedule);
      const shouldRun = shouldDcpDatabricksJobRun_(
        row[1],
        displayRows[index][1],
        row[2],
        targetRunDate
      );
      if (!shouldRun) {
        setDcpDetailNoSchedule_(sheet, rowNumber, "NO SCHED");
        results.push({ row: rowNumber, jobName: jobName, status: "NO SCHED" });
        return;
      }
      if (!isScheduleDue_(targetDateTime, now)) {
        results.push({ row: rowNumber, jobName: jobName, status: "NOT DUE" });
        return;
      }

      const email = findDcpDatabricksEmail_(jobName, targetDateTime);
      if (!email) {
        if (isGracePeriodPassed_(
          targetDateTime,
          now,
          DCP_MONITORING_CONFIG.EMAIL_GRACE_MINUTES
        )) {
          setDcpDetailFailure_(
            sheet,
            rowNumber,
            "NOT FOUND",
            "Email Databricks tidak ditemukan untuk " + jobName + " pada " +
              formatDateTimeObject_(targetDateTime, DCP_MONITORING_CONFIG.TIMEZONE)
          );
          results.push({ row: rowNumber, jobName: jobName, status: "NOT FOUND" });
        } else {
          results.push({ row: rowNumber, jobName: jobName, status: "WAITING GRACE PERIOD" });
        }
        return;
      }
      updateDcpDatabricksRow_(sheet, rowNumber, email);
      results.push({
        row: rowNumber,
        jobName: jobName,
        runId: email.runId,
        status: email.status,
        start: email.startedAt.toISOString(),
        end: email.endedAt.toISOString()
      });
    } catch (error) {
      setDcpDetailFailure_(sheet, rowNumber, "ERROR", String(error.message || error));
      results.push({
        row: rowNumber,
        jobName: jobName,
        status: "ERROR",
        error: String(error.message || error)
      });
    }
  });
  SpreadsheetApp.flush();
  const statuses = {};
  results.forEach(result => {
    statuses[result.status] = (statuses[result.status] || 0) + 1;
  });
  return { checked: results.length, statuses: statuses, jobs: results };
}

function shouldDcpDatabricksJobRun_(rawParameter, displayParameter, formulaResult, targetDate) {
  if (rawParameter instanceof Date && !isNaN(rawParameter.getTime())) {
    const encodedDates = [
      rawParameter.getMonth() + 1,
      rawParameter.getDate(),
      rawParameter.getFullYear() % 100
    ];
    return encodedDates.indexOf(targetDate.getDate()) !== -1;
  }
  const parameter = String(displayParameter || rawParameter || "").trim();
  if (parameter) {
    return shouldJobRunOnDate_(
      parameter,
      targetDate,
      DCP_MONITORING_CONFIG.TIMEZONE
    );
  }
  return typeof formulaResult === "boolean" ? formulaResult : false;
}

function findDcpDatabricksEmail_(jobName, targetDateTime) {
  const start = new Date(targetDateTime.getTime());
  start.setDate(start.getDate() - 1);
  const end = new Date(targetDateTime.getTime());
  end.setDate(end.getDate() + 2);
  const afterFilter = Utilities.formatDate(start, DCP_MONITORING_CONFIG.TIMEZONE, "yyyy/MM/dd");
  const beforeFilter = Utilities.formatDate(end, DCP_MONITORING_CONFIG.TIMEZONE, "yyyy/MM/dd");
  const query =
    '{subject:"view run" ' +
    'subject:"' + DCP_MONITORING_CONFIG.DATABRICKS_SUCCESS_SUBJECT + '" ' +
    'subject:"' + DCP_MONITORING_CONFIG.DATABRICKS_FAILED_SUBJECT + '"} ' +
    "after:" + afterFilter + " before:" + beforeFilter;
  const candidates = [];
  let messagesChecked = 0;
  GmailApp.search(query, 0, 100).forEach(thread => {
    thread.getMessages().forEach(message => {
      messagesChecked++;
      const parsed = parseDcpDatabricksEmail_(message, jobName);
      if (!parsed || parsed.jobName !== jobName) return;
      const differenceMinutes = Math.abs(
        parsed.startedAt.getTime() - targetDateTime.getTime()
      ) / 60000;
      if (differenceMinutes <= DCP_MONITORING_CONFIG.EMAIL_MATCH_TOLERANCE_MINUTES) {
        parsed.differenceMinutes = differenceMinutes;
        candidates.push(parsed);
      }
    });
  });
  candidates.sort((left, right) => {
    if (left.differenceMinutes !== right.differenceMinutes) {
      return left.differenceMinutes - right.differenceMinutes;
    }
    return right.messageDate.getTime() - left.messageDate.getTime();
  });
  console.log(
    "[Databricks] Gmail search job=" + jobName +
    " messagesChecked=" + messagesChecked +
    " matchingCandidates=" + candidates.length
  );
  return candidates[0] || null;
}

function parseDcpDatabricksEmail_(message, expectedJobName) {
  const subject = String(message.getSubject() || "").trim();
  const isNewSuccessSubject = /\bSuccess\s*[\u2014\u2013-]\s*view run\b/i.test(subject);
  const isNewFailedSubject = /\b(?:Failed|Failure|Error)\s*[\u2014\u2013-]\s*view run\b/i.test(subject);
  if (
    subject.indexOf(DCP_MONITORING_CONFIG.DATABRICKS_SUCCESS_SUBJECT) === -1 &&
    subject.indexOf(DCP_MONITORING_CONFIG.DATABRICKS_FAILED_SUBJECT) === -1 &&
    !isNewSuccessSubject &&
    !isNewFailedSubject
  ) return null;
  const body = String(message.getPlainBody() || "");
  const workspaceMatched =
    body.toLowerCase().indexOf(
      DCP_MONITORING_CONFIG.DATABRICKS_WORKSPACE.toLowerCase()
    ) !== -1 ||
    subject.indexOf("[" + DCP_MONITORING_CONFIG.DATABRICKS_WORKSPACE_ID + "]") !== -1;
  if (!workspaceMatched) return null;
  const expectedJob = String(expectedJobName || "").trim();
  const searchableContent = subject + "\n" + body;
  const jobNameMatch = expectedJob &&
    searchableContent.toLowerCase().indexOf(expectedJob.toLowerCase()) !== -1
    ? [expectedJob]
    : searchableContent.match(/\bjob_[A-Za-z0-9_]+\b/i);
  const statusText = extractDcpDatabricksField_(body, "Status") ||
    (isNewSuccessSubject ? "Succeeded" : isNewFailedSubject ? "Failed" : "");
  const startedText = extractDcpDatabricksField_(body, "Started at");
  const durationText = extractDcpDatabricksField_(body, "Duration");
  const runId = searchableContent.match(/\bview run\s+(\d{6,})\b/i) || body.match(
    /(?:^|\n)\s*(?:\|\s*)?(?:\*\*)?Job run(?:\*\*)?[\s\S]{0,300}?\b(\d{6,})\b/i
  );
  const startedMatch = startedText.match(
    /(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\s+UTC/i
  );
  if (!jobNameMatch || !statusText || !startedMatch || !durationText) return null;
  const startedAt = new Date(startedMatch[1] + "T" + startedMatch[2] + "Z");
  const durationSeconds = parseDcpDatabricksDuration_(durationText);
  if (isNaN(startedAt.getTime()) || durationSeconds === null) return null;
  const normalizedStatus = statusText.toLowerCase().indexOf("succeed") !== -1
    ? "OK"
    : statusText.toLowerCase().indexOf("fail") !== -1
      ? "FAILED"
      : statusText.toUpperCase();
  const messageMatch = body.match(
    /(?:^|\n)\s*(?:#+\s*)?(?:\*\*)?Message(?:\*\*)?\s*([\s\S]*?)(?:\n\s*(?:#+\s*)?(?:\*\*)?Run details|$)/i
  );
  return {
    jobName: jobNameMatch[0],
    runId: runId ? runId[1] : "",
    status: normalizedStatus,
    startedAt: startedAt,
    endedAt: new Date(startedAt.getTime() + durationSeconds * 1000),
    durationText: durationText,
    errorMessage: messageMatch
      ? normalizeDcpEmailText_(messageMatch[1])
      : "",
    messageDate: message.getDate()
  };
}

function extractDcpDatabricksField_(body, label) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(body).match(
    new RegExp(
      "(?:^|\\n)\\s*(?:\\|\\s*)?(?:\\*\\*)?" + escapedLabel +
      "(?:\\*\\*)?\\s*:?\\s*([^\\r\\n]+)",
      "i"
    )
  );
  return match ? normalizeDcpEmailText_(match[1]) : "";
}

function normalizeDcpEmailText_(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\|\s*/, "")
    .replace(/\s*\|$/, "");
}

function parseDcpDatabricksDuration_(value) {
  const text = String(value || "").toLowerCase();
  const day = text.match(/(\d+)\s*d/);
  const hour = text.match(/(\d+)\s*h/);
  const minute = text.match(/(\d+)\s*m/);
  const second = text.match(/(\d+)\s*s/);
  if (!day && !hour && !minute && !second) return null;
  return Number(day ? day[1] : 0) * 86400 +
    Number(hour ? hour[1] : 0) * 3600 +
    Number(minute ? minute[1] : 0) * 60 +
    Number(second ? second[1] : 0);
}

function updateDcpDatabricksRow_(sheet, rowNumber, result) {
  const startRange = sheet.getRange(rowNumber, DCP_MONITORING_CONFIG.DETAIL_START_COLUMN);
  const endRange = sheet.getRange(rowNumber, DCP_MONITORING_CONFIG.DETAIL_END_COLUMN);
  const statusRange = sheet.getRange(rowNumber, DCP_MONITORING_CONFIG.DETAIL_STATUS_COLUMN);
  const notesRange = sheet.getRange(rowNumber, DCP_MONITORING_CONFIG.DETAIL_NOTES_COLUMN);
  backupStatusFormulaTemplate_(statusRange);
  writeDcpDetailTime_(startRange, result.startedAt);
  writeDcpDetailTime_(endRange, result.endedAt);
  const notes = [
    result.status === "FAILED" ? "FAILED" : "Succeeded",
    result.runId ? "Run ID: " + result.runId : "",
    "Duration: " + result.durationText,
    result.errorMessage ? "Message: " + result.errorMessage : ""
  ].filter(Boolean).join(", ");
  notesRange.setValue(notes).setWrap(true);
  if (result.status === "OK") {
    restoreDcpStatusFormula_(statusRange);
  } else {
    statusRange.setValue(result.status);
  }
}

function setDcpDetailNoSchedule_(sheet, rowNumber, statusText) {
  const statusRange = sheet.getRange(rowNumber, DCP_MONITORING_CONFIG.DETAIL_STATUS_COLUMN);
  backupStatusFormulaTemplate_(statusRange);
  sheet.getRange(rowNumber, DCP_MONITORING_CONFIG.DETAIL_START_COLUMN).clearContent();
  sheet.getRange(rowNumber, DCP_MONITORING_CONFIG.DETAIL_END_COLUMN).clearContent();
  sheet.getRange(rowNumber, DCP_MONITORING_CONFIG.DETAIL_NOTES_COLUMN).clearContent();
  restoreDcpStatusFormula_(statusRange);
  if (!statusRange.getFormula()) statusRange.setValue(statusText);
}

function setDcpDetailFailure_(sheet, rowNumber, status, notes) {
  const statusRange = sheet.getRange(rowNumber, DCP_MONITORING_CONFIG.DETAIL_STATUS_COLUMN);
  backupStatusFormulaTemplate_(statusRange);
  sheet.getRange(rowNumber, DCP_MONITORING_CONFIG.DETAIL_START_COLUMN).clearContent();
  sheet.getRange(rowNumber, DCP_MONITORING_CONFIG.DETAIL_END_COLUMN).clearContent();
  statusRange.setValue(status);
  sheet.getRange(rowNumber, DCP_MONITORING_CONFIG.DETAIL_NOTES_COLUMN)
    .setValue(normalizeDcpEmailText_(notes))
    .setWrap(true);
}

function writeDcpDetailTime_(range, value) {
  const date = value instanceof Date ? value : parseIsoDate_(value);
  if (!date || isNaN(date.getTime())) {
    range.clearContent();
    return;
  }
  range.setValue(date);
}

function restoreDcpStatusFormula_(statusRange) {
  if (statusRange.getFormulaR1C1()) return;
  const sheet = statusRange.getSheet();
  const propertyKey = getStatusFormulaTemplateKey_(sheet.getName());
  const properties = PropertiesService.getScriptProperties();
  let formulaR1C1 = properties.getProperty(propertyKey);
  const firstRow = sheet.getName() === DCP_MONITORING_CONFIG.AIRFLOW_SHEET_NAME
    ? DCP_MONITORING_CONFIG.AIRFLOW_FIRST_ROW
    : DCP_MONITORING_CONFIG.DATABRICKS_FIRST_ROW;
  if (!formulaR1C1) {
    for (let row = firstRow; row <= sheet.getLastRow(); row++) {
      const candidate = sheet.getRange(row, statusRange.getColumn()).getFormulaR1C1();
      if (!candidate) continue;
      formulaR1C1 = candidate;
      properties.setProperty(propertyKey, formulaR1C1);
      break;
    }
  }
  if (formulaR1C1) statusRange.setFormulaR1C1(formulaR1C1);
}

function getDcpMonitoringRuntimeContext_() {
  const properties = PropertiesService.getScriptProperties();
  const dailyFileId = String(properties.getProperty("DAILY_FILE_ID") || "").trim();
  const dailyFileDate = String(properties.getProperty("DAILY_FILE_DATE") || "").trim();
  const today = Utilities.formatDate(
    new Date(),
    DCP_MONITORING_CONFIG.TIMEZONE,
    "yyyy-MM-dd"
  );
  if (!dailyFileId) {
    throw new Error("DAILY_FILE_ID kosong. Jalankan Refresh Runtime lebih dulu");
  }
  if (dailyFileDate !== today) {
    throw new Error(
      "DAILY_FILE_DATE stale: " + dailyFileDate + ". Expected: " + today
    );
  }
  return {
    spreadsheet: SpreadsheetApp.openById(dailyFileId),
    dailyFileDate: dailyFileDate
  };
}

function startDcpCheckpointTiming_(sheet, rowNumber, startedAt) {
  sheet.getRange(rowNumber, DCP_MONITORING_CONFIG.CHECKPOINT_START_COLUMN)
    .setValue(startedAt);
  sheet.getRange(rowNumber, DCP_MONITORING_CONFIG.CHECKPOINT_END_COLUMN)
    .clearContent();
  SpreadsheetApp.flush();
}

function finishDcpCheckpointTiming_(sheet, rowNumber, startedAt, endedAt) {
  const effectiveEnd = ensureDistinctAirflowCheckpointEnd_(startedAt, endedAt);
  sheet.getRange(rowNumber, DCP_MONITORING_CONFIG.CHECKPOINT_END_COLUMN)
    .setValue(effectiveEnd);
  SpreadsheetApp.flush();
}
