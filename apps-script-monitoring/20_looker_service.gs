const LOOKER_CONFIG = {
  TARGET_SHEET_NAME: "Ops Checkpoint",
  SUBJECT_COLUMN: 5,
  START_TIME_COLUMN: 6,
  END_TIME_COLUMN: 7,
  STATUS_COLUMN: 8,
  NOTES_COLUMN: 9,
  TIME_FORMAT: "HH:mm",
  MINIMUM_FILE_SIZE_BYTES: 4 * 1024 * 1024,
  MINIMUM_FILE_SIZE_SUBJECTS: [
    "[Alert] Stock Monitoring Frozen Dough Say Bread Per Toko Per Produk (DataD-2) Part 1/2",
    "[Alert] Stock Monitoring Frozen Dough Say Bread Per Toko Per Produk (DataD-2) Part 2/2"
  ],
  EARLY_SUBJECTS: [
    "Report Harian Say Bread Data H-1",
    "Alarm Harian Selisih HPP Per Toko Per PLU (acost vs lcost PR)"
  ],
  AFTERNOON_SUBJECTS: [
    "[Alert] Raw Material Fried Chicken Per Toko Per Produk",
    "[Alert] Stock Monitoring Frozen Dough Say Bread Per Toko Per Produk (DataD-2) Part 1/2",
    "[Alert] Stock Monitoring Frozen Dough Say Bread Per Toko Per Produk (DataD-2) Part 2/2",
    "[Alert] Frozen Dough Say Bread Per Toko Per Produk (Data D-2)",
    "[Alert] Stock Monitoring Onigiri dan RTE Per Toko Per Produk",
    "Laporan Monitoring Happy Hour - Detail Sales vs Promo",
    "Laporan Monitoring Happy Hour - Summary Sales vs Promo"
  ]
};

function runLookerMonitoringManual() {
  return processLookerReports_(
    LOOKER_CONFIG.EARLY_SUBJECTS,
    "MANUAL"
  );
}

function runLookerMonitoring1400() {
  return processLookerReports_(
    LOOKER_CONFIG.EARLY_SUBJECTS,
    "TRIGGER_1400"
  );
}

function runLookerMonitoring1600() {
  return processLookerReports_(
    LOOKER_CONFIG.AFTERNOON_SUBJECTS,
    "TRIGGER_1600"
  );
}

function processEmailReports() {
  return runLookerMonitoringManual();
}

function processLookerReports_(subjects, runSource) {
  const dayContext = getRuntimeMonitoringContext_();
  if (
    runSource === "TRIGGER_1600" &&
    dayContext.looker1600 === "SKIPPED_NOT_APPLICABLE"
  ) {
    console.log(
      "[Looker] SKIPPED_NOT_APPLICABLE source=" + runSource +
      " date=" + dayContext.dateKey
    );
    return {
      source: runSource,
      status: "SKIPPED_NOT_APPLICABLE",
      date: dayContext.dateKey
    };
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    throw new Error("Another Looker monitoring process is still running");
  }

  const startedAt = new Date();
  let timingSheet = null;
  const checkedRows = new Set();
  let summary = null;
  console.log(
    "[Looker] START source=" + runSource +
    " at=" + startedAt.toISOString()
  );

  try {
    const context = getLookerRuntimeContext_();
    const sheet = context.spreadsheet.getSheetByName(
      LOOKER_CONFIG.TARGET_SHEET_NAME
    );
    timingSheet = sheet;

    if (!sheet) {
      throw new Error(
        "Sheet not found in daily file: " + LOOKER_CONFIG.TARGET_SHEET_NAME
      );
    }

    console.log(
      "[Looker] Target file=" + context.spreadsheet.getName() +
      " id=" + context.spreadsheet.getId() +
      " reportDates=" + context.reportDates.join(", ")
    );

    const subjectRows = getLookerSubjectRows_(sheet);
    const changedRows = new Set();
    let successCount = 0;
    let skippedCount = 0;
    let missingCount = 0;
    let failedCount = 0;

    subjects.forEach(subject => {
      const rowNumber = subjectRows[normalizeLookerSubject_(subject)];

      if (!rowNumber) {
        console.warn(
          "[Looker] Subject row not found in Column E: " + subject
        );
        missingCount++;
        return;
      }

      if (!checkedRows.has(rowNumber)) {
        checkedRows.add(rowNumber);
        const startRange = sheet.getRange(
          rowNumber,
          LOOKER_CONFIG.START_TIME_COLUMN
        );
        const endRange = sheet.getRange(
          rowNumber,
          LOOKER_CONFIG.END_TIME_COLUMN
        );
        setLookerValueWithTrace_(
          startRange,
          startedAt,
          "processLookerReports_:setStartTime",
          LOOKER_CONFIG.TIME_FORMAT
        );
        logLookerMutation_(
          endRange,
          "processLookerReports_:clearEndTime",
          "CLEAR",
          ""
        );
        endRange.clearContent().setNumberFormat(LOOKER_CONFIG.TIME_FORMAT);
      }
      console.log(
        "[Looker] Subject row resolved: row=" + rowNumber +
        " subject=" + subject
      );
      const timeFormatRange = sheet.getRange(
        rowNumber,
        LOOKER_CONFIG.START_TIME_COLUMN,
        1,
        2
      );
      logLookerMutation_(
        timeFormatRange,
        "processLookerReports_:setTimeFormat",
        "FORMAT",
        LOOKER_CONFIG.TIME_FORMAT
      );
      timeFormatRange.setNumberFormat(LOOKER_CONFIG.TIME_FORMAT);

      const notesRange = sheet.getRange(
        rowNumber,
        LOOKER_CONFIG.NOTES_COLUMN
      );
      const existingNotes = String(notesRange.getValue() || "");
      const newResults = {};
      const requiresMinimumSize =
        LOOKER_CONFIG.MINIMUM_FILE_SIZE_SUBJECTS.indexOf(subject) !== -1;
      let meetsMinimumSize = true;

      context.reportDates.forEach(reportDate => {
        const dateLabel = formatLookerDateLabel_(
          reportDate,
          context.timeZone
        );

        if (hasSuccessfulLookerResult_(
          existingNotes,
          dateLabel,
          requiresMinimumSize ? LOOKER_CONFIG.MINIMUM_FILE_SIZE_BYTES : 0
        )) {
          console.log(
            "[Looker] SKIP existing subject=" + subject +
            " date=" + reportDate
          );
          skippedCount++;
          return;
        }

        let result;
        try {
          result = findAndProcessLookerEmail_(
            subject,
            reportDate,
            context.timeZone
          );
        } catch (error) {
          console.error(
            "[Looker] PROCESSING FAILED subject=" + subject +
            " date=" + reportDate +
            " error=" + error.message
          );
          failedCount++;
          meetsMinimumSize = false;
          return;
        }

        if (!result) {
          console.log(
            "[Looker] NOT FOUND subject=" + subject +
            " date=" + reportDate
          );
          missingCount++;
          meetsMinimumSize = false;
          return;
        }

        const passesMinimumSize = !requiresMinimumSize ||
          result.totalBytes >= LOOKER_CONFIG.MINIMUM_FILE_SIZE_BYTES;
        if (
          requiresMinimumSize &&
          !passesMinimumSize
        ) {
          meetsMinimumSize = false;
        }

        newResults[dateLabel] =
          dateLabel + " Size: " + formatLookerSizeMb_(result.totalBytes) +
          " ; Total Row: " + formatLookerRowCount_(result.totalRows) +
          (requiresMinimumSize
            ? " ; Size Check: " + (passesMinimumSize ? "OK" : "NOT OK")
            : "");

        console.log(
          "[Looker] SUCCESS subject=" + subject +
          " date=" + reportDate +
          " attachments=" + result.attachmentCount +
          " bytes=" + result.totalBytes +
          " rows=" + result.totalRows
        );
        successCount++;
      });

      if (requiresMinimumSize) {
        const statusRange = sheet.getRange(
          rowNumber,
          LOOKER_CONFIG.STATUS_COLUMN
        );
        setLookerValueWithTrace_(
          statusRange,
          meetsMinimumSize ? "OK" : "NOT OK",
          "processLookerReports_:setSizeStatus"
        );
      }

      if (Object.keys(newResults).length === 0) {
        return;
      }

      const mergedNotes = mergeLookerNotes_(
        existingNotes,
        newResults,
        context.reportDates,
        context.timeZone
      );
      setLookerValueWithTrace_(
        notesRange,
        mergedNotes,
        "processLookerReports_:setNotes"
      );
      notesRange.setWrap(true);
      changedRows.add(rowNumber);
    });

    SpreadsheetApp.flush();

    summary = {
      source: runSource,
      dailyFileId: context.spreadsheet.getId(),
      reportDates: context.reportDates,
      subjectsRequested: subjects.length,
      rowsUpdated: changedRows.size,
      rowsTimed: checkedRows.size,
      resultsWritten: successCount,
      existingResultsSkipped: skippedCount,
      resultsNotFound: missingCount,
      processingFailures: failedCount,
      startedAt: startedAt.toISOString(),
      endedAt: ""
    };
    return summary;
  } finally {
    try {
      const endedAt = new Date();
      if (timingSheet && checkedRows.size) {
        checkedRows.forEach(rowNumber => {
          const endRange = timingSheet.getRange(
            rowNumber,
            LOOKER_CONFIG.END_TIME_COLUMN
          );
          setLookerValueWithTrace_(
            endRange,
            validateDistinctLookerEndTime_(
              startedAt,
              endedAt,
              Session.getScriptTimeZone()
            ),
            "processLookerReports_:setEndTime",
            LOOKER_CONFIG.TIME_FORMAT
          );
        });
        SpreadsheetApp.flush();
      }
      if (summary) summary.endedAt = endedAt.toISOString();
      if (summary) {
        console.log("[Looker] COMPLETE " + JSON.stringify(summary));
      }
    } finally {
      lock.releaseLock();
    }
  }
}

function validateDistinctLookerEndTime_(startTime, endTime, timeZone) {
  if (!(startTime instanceof Date) || isNaN(startTime.getTime())) {
    return endTime;
  }

  const format = "HH:mm:ss";
  const startSecond = Utilities.formatDate(startTime, timeZone, format);
  const endSecond = Utilities.formatDate(endTime, timeZone, format);

  if (startSecond === endSecond) {
    return new Date(endTime.getTime() + 1000);
  }

  return endTime;
}

function getLookerWorkingDayState_() {
  const config = getConfig();
  const now = new Date();
  const template = SpreadsheetApp.openById(config.templateId);
  const holidayDates = getHolidayDateSet_(template, config.timeZone);
  return {
    dateStr: Utilities.formatDate(now, config.timeZone, "yyyy-MM-dd"),
    isNonWorkingDay: isProjectNonWorkingDate_(
      now,
      holidayDates,
      config.timeZone
    )
  };
}

function setLookerValueWithTrace_(range, value, source, numberFormat) {
  logLookerMutation_(range, source, "WRITE", value);
  range.setValue(value);
  if (numberFormat) range.setNumberFormat(numberFormat);
}

function logLookerMutation_(range, source, action, nextValue) {
  const mergedRanges = range.getMergedRanges()
    .map(item => item.getA1Notation())
    .join(",") || "-";
  const beforeValue = formatLookerLogValue_(range.getDisplayValue());
  const beforeFormula = formatLookerLogValue_(range.getFormula());
  const next = formatLookerLogValue_(nextValue);

  console.log(
    "[Looker] " + action +
    " source=" + source +
    " sheet=" + range.getSheet().getName() +
    " range=" + range.getA1Notation() +
    " merged=" + mergedRanges +
    " formatBefore=" + range.getNumberFormat() +
    " formulaBefore=" + beforeFormula +
    " valueBefore=" + beforeValue +
    " next=" + next
  );
}

function formatLookerLogValue_(value) {
  const text = value instanceof Date
    ? value.toISOString()
    : String(value === undefined || value === null ? "" : value);
  const oneLine = text.replace(/\r?\n/g, "\\n");
  return oneLine.length > 500 ? oneLine.slice(0, 500) + "..." : oneLine;
}

function getLookerRuntimeContext_() {
  const properties = PropertiesService.getScriptProperties();
  const dailyFileId = (
    properties.getProperty("DAILY_FILE_ID") || ""
  ).trim();
  const dailyFileDate = (
    properties.getProperty("DAILY_FILE_DATE") || ""
  ).trim();
  const reportDatesJson =
    properties.getProperty("LOOKER_REPORT_DATES") || "[]";
  const missingProperties = [];

  if (!dailyFileId) missingProperties.push("DAILY_FILE_ID");
  if (!dailyFileDate) missingProperties.push("DAILY_FILE_DATE");

  if (missingProperties.length) {
    throw new Error(
      "Missing runtime Script Properties: " +
      missingProperties.join(", ") +
      ". Run refreshDailyRuntimeProperties() first."
    );
  }

  let reportDates;
  try {
    reportDates = JSON.parse(reportDatesJson);
  } catch (error) {
    throw new Error(
      "Invalid LOOKER_REPORT_DATES JSON: " + error.message
    );
  }

  if (!Array.isArray(reportDates) || reportDates.length === 0) {
    throw new Error(
      "LOOKER_REPORT_DATES is empty. " +
      "Run refreshDailyRuntimeProperties() first."
    );
  }

  reportDates = reportDates
    .map(value => String(value))
    .filter((value, index, values) =>
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      values.indexOf(value) === index
    );

  if (reportDates.length === 0) {
    throw new Error("LOOKER_REPORT_DATES has no valid dates");
  }

  const timeZone = Session.getScriptTimeZone();
  const todayStr = Utilities.formatDate(
    new Date(),
    timeZone,
    "yyyy-MM-dd"
  );

  if (dailyFileDate !== todayStr) {
    throw new Error(
      "DAILY_FILE_DATE is stale: " + dailyFileDate +
      ". Expected: " + todayStr +
      ". Run refreshDailyRuntimeProperties() first."
    );
  }

  return {
    spreadsheet: SpreadsheetApp.openById(dailyFileId),
    dailyFileDate: dailyFileDate,
    reportDates: reportDates,
    timeZone: timeZone
  };
}

function getLookerSubjectRows_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 1) return {};

  const values = sheet.getRange(
    1,
    LOOKER_CONFIG.SUBJECT_COLUMN,
    lastRow,
    1
  ).getDisplayValues();
  const rows = {};

  values.forEach((row, index) => {
    const subject = normalizeLookerSubject_(row[0]);
    if (subject && !rows[subject]) {
      rows[subject] = index + 1;
    }
  });

  return rows;
}

function normalizeLookerSubject_(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function findAndProcessLookerEmail_(subject, reportDate, timeZone) {
  const searchDate = parseLookerDate_(reportDate);
  const nextDate = new Date(searchDate.getTime());
  nextDate.setDate(nextDate.getDate() + 1);

  const afterFilter = Utilities.formatDate(
    searchDate,
    timeZone,
    "yyyy/MM/dd"
  );
  const beforeFilter = Utilities.formatDate(
    nextDate,
    timeZone,
    "yyyy/MM/dd"
  );
  const safeSubject = subject.replace(/"/g, '\"');
  const query =
    'subject:"' + safeSubject + '" after:' + afterFilter +
    " before:" + beforeFilter;

  const messages = [];
  GmailApp.search(query, 0, 100).forEach(thread => {
    thread.getMessages().forEach(message => {
      const messageDate = Utilities.formatDate(
        message.getDate(),
        timeZone,
        "yyyy-MM-dd"
      );
      if (
        message.getSubject().trim() === subject &&
        messageDate === reportDate
      ) {
        messages.push(message);
      }
    });
  });

  messages.sort((a, b) => b.getDate().getTime() - a.getDate().getTime());

  for (let index = 0; index < messages.length; index++) {
    const attachments = messages[index].getAttachments()
      .filter(isSupportedLookerAttachment_);

    if (attachments.length === 0) {
      continue;
    }

    let totalBytes = 0;
    let totalRows = 0;

    console.log(
      "[Looker] EMAIL MATCHED subject=" + subject +
      " date=" + reportDate +
      " sentAt=" + messages[index].getDate().toISOString() +
      " attachments=" + attachments.length
    );

    attachments.forEach(attachment => {
      totalBytes += attachment.getSize();
      totalRows += countLookerRows_(attachment);
    });

    return {
      totalBytes: totalBytes,
      totalRows: totalRows,
      attachmentCount: attachments.length
    };
  }

  return null;
}

function isSupportedLookerAttachment_(attachment) {
  if (!attachment || typeof attachment.getName !== "function") {
    return false;
  }

  const fileName = attachment.getName().toLowerCase();
  const mimeType = String(attachment.getContentType() || "").toLowerCase();

  return fileName.endsWith(".csv") ||
    fileName.endsWith(".xlsx") ||
    mimeType === "text/csv" ||
    mimeType ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
}

function countLookerRows_(blob) {
  const fileName = blob.getName().toLowerCase();
  const mimeType = String(blob.getContentType() || "").toLowerCase();

  if (fileName.endsWith(".csv") || mimeType === "text/csv") {
    const rows = Utilities.parseCsv(blob.getDataAsString())
      .filter(row => row.some(cell => String(cell).trim() !== ""));
    return Math.max(rows.length - 1, 0);
  }

  if (fileName.endsWith(".xlsx")) {
    return countLookerXlsxRows_(blob);
  }

  throw new Error("Unsupported attachment format: " + blob.getName());
}

function countLookerXlsxRows_(blob) {
  let temporaryFileId = "";

  try {
    const temporaryName = "temp_looker_count_" + new Date().getTime();
    let temporaryFile;

    if (typeof Drive.Files.create === "function") {
      temporaryFile = Drive.Files.create(
        {
          name: temporaryName,
          mimeType: "application/vnd.google-apps.spreadsheet"
        },
        blob,
        { fields: "id" }
      );
    } else if (typeof Drive.Files.insert === "function") {
      temporaryFile = Drive.Files.insert(
        {
          title: temporaryName,
          mimeType: "application/vnd.google-apps.spreadsheet"
        },
        blob
      );
    } else {
      throw new Error(
        "Advanced Drive Service is unavailable. Enable Drive API v2 or v3."
      );
    }

    temporaryFileId = temporaryFile.id;

    const spreadsheet = SpreadsheetApp.openById(temporaryFileId);
    const rowCount = spreadsheet.getSheets()[0].getLastRow() - 1;
    return Math.max(rowCount, 0);
  } finally {
    if (temporaryFileId) {
      try {
        Drive.Files.remove(temporaryFileId);
      } catch (cleanupError) {
        console.error(
          "[Looker] Failed to remove temporary XLSX conversion: " +
          cleanupError.message
        );
      }
    }
  }
}

function hasSuccessfulLookerResult_(notes, dateLabel, minimumBytes) {
  const matchingLine = String(notes || "")
    .split(/\r?\n/)
    .find(line =>
      line.trim().indexOf(dateLabel + " Size:") === 0 &&
      line.indexOf("; Total Row:") !== -1
    );

  if (!matchingLine) return false;
  if (!minimumBytes) return true;
  return matchingLine.indexOf("; Size Check: OK") !== -1;
}

function mergeLookerNotes_(
  existingNotes,
  newResults,
  reportDates,
  timeZone
) {
  const resultLines = {};
  const otherLines = [];

  String(existingNotes || "")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .forEach(line => {
      const match = line.match(
        /^(\d{2} [A-Za-z]{3} \d{4}) Size:.*; Total Row:/
      );
      if (match) {
        resultLines[match[1]] = line;
      } else {
        otherLines.push(line);
      }
    });

  Object.keys(newResults).forEach(dateLabel => {
    resultLines[dateLabel] = newResults[dateLabel];
  });

  const orderedLines = [];
  reportDates.forEach(reportDate => {
    const dateLabel = formatLookerDateLabel_(reportDate, timeZone);
    if (resultLines[dateLabel]) {
      orderedLines.push(resultLines[dateLabel]);
      delete resultLines[dateLabel];
    }
  });

  Object.keys(resultLines)
    .sort()
    .reverse()
    .forEach(dateLabel => orderedLines.push(resultLines[dateLabel]));

  return orderedLines.concat(otherLines).join("\n");
}

function formatLookerDateLabel_(dateStr, timeZone) {
  return Utilities.formatDate(
    parseLookerDate_(dateStr),
    timeZone,
    "dd MMM yyyy"
  );
}

function parseLookerDate_(dateStr) {
  const parts = String(dateStr).split("-").map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0);
}

function formatLookerSizeMb_(bytes) {
  return (bytes / (1024 * 1024)).toFixed(2) + " MB";
}

function formatLookerRowCount_(rowCount) {
  return Number(rowCount).toLocaleString("en-US");
}

function setupTriggers() {
  deleteLookerTriggers_([
    "processEmailReports",
    "startLookerReportPolling",
    "pollLookerReportsUntilComplete",
    "runLookerMonitoring1400",
    "runLookerMonitoring1600",
    "runLookerMonitoring1700"
  ]);

  ScriptApp.newTrigger("runLookerMonitoring1400")
    .timeBased()
    .atHour(14)
    .everyDays(1)
    .create();

  ScriptApp.newTrigger("runLookerMonitoring1600")
    .timeBased()
    .atHour(16)
    .everyDays(1)
    .create();

  console.log("[Looker] Triggers enabled for 14:00 and 16:00");
}

function deleteLookerTriggers_(handlerNames) {
  const names = new Set(handlerNames);
  ScriptApp.getProjectTriggers()
    .filter(trigger => names.has(trigger.getHandlerFunction()))
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));
}

// Legacy trigger handlers are intentionally no-op until setupTriggers() removes them.
function startLookerReportPolling() {
  console.warn(
    "[Looker] Legacy trigger ignored. Run setupTriggers() to replace it."
  );
}

function pollLookerReportsUntilComplete() {
  console.warn(
    "[Looker] Legacy polling trigger ignored. Run setupTriggers() to remove it."
  );
}

function setupMonitoringMenus() {
  showMonitoringControlPanel();
}
