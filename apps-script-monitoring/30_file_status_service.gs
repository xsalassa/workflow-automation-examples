const FILE_STATUS_CONFIG = {
  PROJECT_ID: "example-project",
  TARGET_SHEET_NAME: "Ops Checkpoint",
  START_TIME_COLUMN: 6,
  END_TIME_COLUMN: 7,
  NOTES_COLUMN: 9,
  TIME_FORMAT: "HH:mm",
  COUNT_ROW: 7,
  AVAILABILITY_ROW: 8,
  HIGH_VOLUME_MINIMUM: 22000,
  BRANCH_MINIMUMS: {
    B001: 600,
    B002: 500
  },
  HIGH_VOLUME_SOURCES: [
    "crdh",
    "dt",
    "edc",
    "glslp",
    "ntb",
    "pr",
    "spr",
    "st",
    "stk",
    "wt"
  ]
};

const DCP_FILE_STATUS_CONFIG = {
  TARGET_SHEET_NAME: "DCP Checkpoint",
  ROW: 6,
  MINIMUM: 18000
};

const STATUS_FILE_COUNT_QUERY = [
  "SELECT",
  "  CAST(CURRENT_DATE('Asia/Jakarta') - 1 AS STRING) AS `File Date`,",
  "  source_name,",
  "  folder_name,",
  "  COUNT(DISTINCT b.object_id) AS total_count",
  "FROM `example-project.ops.master_filesource` a",
  "LEFT JOIN (",
  "  SELECT filename, event_date, object_id",
  "  FROM `example-project.ops.log_file_ingest_success`",
  "  WHERE event_date >= DATE_SUB(CURRENT_DATE('Asia/Jakarta'), INTERVAL 1 DAY)",
  ") b",
  "  ON b.object_id LIKE CONCAT('%', a.folder_name, '%', a.filename, '%')",
  "  AND b.filename LIKE CONCAT(",
  "    '%',",
  "    SUBSTR(a.filename, 1, 2),",
  "    '%',",
  "    UPPER(FORMAT_DATE(",
  "      a.date_format,",
  "      DATE_SUB(CURRENT_DATE('Asia/Jakarta'), INTERVAL a.update_interval DAY)",
  "    )),",
  "    '%'",
  "  )",
  "WHERE category LIKE 'Transaction'",
  "GROUP BY source_name, folder_name, job_name, order_num",
  "ORDER BY IFNULL(a.order_num, 99), total_count"
].join("\n");

const STATUS_FILE_BRANCH_COUNT_QUERY = [
  "SELECT",
  "  CAST(CURRENT_DATE('Asia/Jakarta') - 1 AS STRING) AS `File Date`,",
  "  a.source_name,",
  "  LEFT(b.object_id, 4) AS branch_cd,",
  "  COUNT(DISTINCT b.object_id) AS total_count",
  "FROM `example-project.ops.master_filesource` a",
  "JOIN (",
  "  SELECT filename, event_date, object_id",
  "  FROM `example-project.ops.log_file_ingest_success`",
  "  WHERE event_date >= DATE_SUB(CURRENT_DATE('Asia/Jakarta'), INTERVAL 1 DAY)",
  ") b",
  "  ON b.object_id LIKE CONCAT('%', a.folder_name, '%', a.filename, '%')",
  "  AND b.filename LIKE CONCAT(",
  "    '%',",
  "    SUBSTR(a.filename, 1, 2),",
  "    '%',",
  "    UPPER(FORMAT_DATE(",
  "      a.date_format,",
  "      DATE_SUB(CURRENT_DATE('Asia/Jakarta'), INTERVAL a.update_interval DAY)",
  "    )),",
  "    '%'",
  "  )",
  "WHERE a.category LIKE 'Transaction'",
  "  AND LOWER(TRIM(a.source_name)) IN (",
  "    'crdh', 'dt', 'edc', 'glslp', 'ntb',",
  "    'pr', 'spr', 'st', 'stk', 'wt'",
  "  )",
  "  AND LEFT(b.object_id, 4) IN ('B001', 'B002')",
  "GROUP BY a.source_name, branch_cd",
  "ORDER BY a.source_name, branch_cd"
].join("\n");

const STATUS_FILE_AVAILABILITY_QUERY = [
  "SELECT * EXCEPT(order_row)",
  "FROM (",
  "  SELECT",
  "    CAST(CURRENT_DATE('Asia/Jakarta') AS STRING) AS Date,",
  "    TRIM(a.filename, '_') AS Prefix_Filename,",
  "    folder_name,",
  "    CASE WHEN b.filename IS NULL THEN 1 ELSE 2 END AS order_row,",
  "    CASE",
  "      WHEN b.filename IS NULL THEN 'Not Available'",
  "      ELSE 'Available'",
  "    END AS file_availablity_status",
  "  FROM `example-project.ops.master_filesource` a",
  "  LEFT JOIN (",
  "    SELECT event_date, filename, object_id",
  "    FROM `example-project.ops.log_file_ingest_success`",
  "    WHERE event_date >= DATE_SUB(CURRENT_DATE('Asia/Jakarta'), INTERVAL 1 DAY)",
  "      AND object_id LIKE '%/%'",
  "      AND object_id NOT LIKE '/B%'",
  "      AND filename NOT LIKE 'list_example_file%'",
  "  ) b",
  "    ON b.object_id LIKE CONCAT(",
  "      '%',",
  "      a.folder_name,",
  "      '%',",
  "      a.filename,",
  "      '%',",
  "      CAST(FORMAT_DATE(",
  "        a.date_format,",
  "        DATE_SUB(",
  "          CURRENT_DATE('Asia/Jakarta'),",
  "          INTERVAL a.update_interval DAY",
  "        )",
  "      ) AS STRING),",
  "      '%'",
  "    )",
  "  WHERE a.category = 'Reference'",
  ")",
  "ORDER BY order_row"
].join("\n");

function runStatusFileCountCheck() {
  return runFileStatusTask_({
    name: "Status_File_Count_H-1",
    row: FILE_STATUS_CONFIG.COUNT_ROW,
    taskLabel: "Check Status_File_Count_H-1",
    query: STATUS_FILE_COUNT_QUERY,
    secondaryQuery: STATUS_FILE_BRANCH_COUNT_QUERY,
    evaluate: evaluateStatusFileCount_
  });
}

function runDcpStatusFileCountCheck() {
  return runFileStatusTask_({
    name: "Status_File_Count_H-1",
    row: DCP_FILE_STATUS_CONFIG.ROW,
    taskLabel: "Check Status_File_Count_H-1",
    targetSheetName: DCP_FILE_STATUS_CONFIG.TARGET_SHEET_NAME,
    singleLineNotes: true,
    preserveTypedColumnFormat: true,
    query: STATUS_FILE_COUNT_QUERY,
    evaluate: evaluateDcpStatusFileCount_
  });
}

function runStatusFileAvailabilityCheck() {
  return runFileStatusTask_({
    name: "Status_File_Availability_H-1",
    row: FILE_STATUS_CONFIG.AVAILABILITY_ROW,
    taskLabel: "Check Status_File_Availability_H-1",
    query: STATUS_FILE_AVAILABILITY_QUERY,
    evaluate: evaluateStatusFileAvailability_
  });
}

function runAllStatusFileChecks() {
  return [
    runStatusFileCountCheck(),
    runStatusFileAvailabilityCheck()
  ];
}

function setupFileStatusTrigger0900() {
  ScriptApp.getProjectTriggers()
    .filter(trigger =>
      trigger.getHandlerFunction() === "runAllStatusFileChecks"
    )
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));

  ScriptApp.newTrigger("runAllStatusFileChecks")
    .timeBased()
    .atHour(9)
    .everyDays(1)
    .create();

  console.log("[File Status] Trigger enabled for 09:00");
}

function runFileStatusTask_(task) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    throw new Error("Another file monitoring process is still running");
  }

  const startedAt = new Date();
  let sheet;

  try {
    sheet = getFileStatusTargetSheet_(task.targetSheetName);
    task.row = findFileStatusTaskRow_(sheet, task);
    validateFileStatusTaskRow_(sheet, task);

    const startRange = sheet.getRange(
      task.row,
      FILE_STATUS_CONFIG.START_TIME_COLUMN
    );
    const endRange = sheet.getRange(
      task.row,
      FILE_STATUS_CONFIG.END_TIME_COLUMN
    );
    const notesRange = sheet.getRange(
      task.row,
      FILE_STATUS_CONFIG.NOTES_COLUMN
    );

    startRange.setValue(startedAt);
    endRange.clearContent();
    if (!task.preserveTypedColumnFormat) {
      startRange.setNumberFormat(FILE_STATUS_CONFIG.TIME_FORMAT);
      endRange.setNumberFormat(FILE_STATUS_CONFIG.TIME_FORMAT);
    }
    SpreadsheetApp.flush();

    try {
      console.log("[File Status] START task=" + task.name);
      const rows = executeFileStatusQuery_(task.query);
      const secondaryRows = task.secondaryQuery
        ? executeFileStatusQuery_(task.secondaryQuery)
        : [];
      const evaluation = task.evaluate(rows, secondaryRows);
      notesRange.setValue(evaluation.notes).setWrap(true);
      console.log(
        "[File Status] COMPLETE task=" + task.name +
        " status=" + evaluation.status +
        " rows=" + rows.length
      );

      return {
        task: task.name,
        status: evaluation.status,
        queryRows: rows.length,
        secondaryQueryRows: secondaryRows.length,
        details: evaluation.details
      };
    } catch (error) {
      const dateLabel = Utilities.formatDate(
        new Date(),
        Session.getScriptTimeZone(),
        "dd MMM yyyy"
      );
      notesRange.setValue(
        dateLabel + " ERROR" +
        (task.singleLineNotes ? ", " : "\n") + error.message
      ).setWrap(true);
      console.error(
        "[File Status] ERROR task=" + task.name +
        " error=" + error.stack
      );

      return {
        task: task.name,
        status: "ERROR",
        error: error.message
      };
    } finally {
      endRange.setValue(new Date());
      if (!task.preserveTypedColumnFormat) {
        endRange.setNumberFormat(FILE_STATUS_CONFIG.TIME_FORMAT);
      }
      SpreadsheetApp.flush();
    }
  } finally {
    lock.releaseLock();
  }
}

function findFileStatusTaskRow_(sheet, task) {
  const label = String(task.taskLabel || task.name || "").trim();
  if (!label) return task.row;
  const lastRow = sheet.getLastRow();
  const values = sheet.getRange(1, 3, lastRow, 3).getDisplayValues();
  const normalizedTarget = normalizeFileStatusName_(label);
  for (let index = 0; index < values.length; index += 1) {
    const combined = values[index].join(" ");
    const normalized = normalizeFileStatusName_(combined);
    if (!normalized) continue;
    if (
      normalized.indexOf(normalizedTarget) !== -1 ||
      normalizedTarget.indexOf(normalized) !== -1
    ) {
      return index + 1;
    }
  }
  throw new Error(
    "Task row tidak ditemukan pada " + sheet.getName() + ": " + label
  );
}

function getFileStatusTargetSheet_(targetSheetName) {
  const properties = PropertiesService.getScriptProperties();
  const dailyFileId = (
    properties.getProperty("DAILY_FILE_ID") || ""
  ).trim();
  const dailyFileDate = (
    properties.getProperty("DAILY_FILE_DATE") || ""
  ).trim();
  const timeZone = Session.getScriptTimeZone();
  const todayStr = Utilities.formatDate(
    new Date(),
    timeZone,
    "yyyy-MM-dd"
  );

  if (!dailyFileId) {
    throw new Error(
      "DAILY_FILE_ID is empty. Run refreshDailyRuntimeProperties() first."
    );
  }

  if (dailyFileDate !== todayStr) {
    throw new Error(
      "DAILY_FILE_DATE is stale: " + dailyFileDate +
      ". Expected: " + todayStr +
      ". Run refreshDailyRuntimeProperties() first."
    );
  }

  const spreadsheet = SpreadsheetApp.openById(dailyFileId);
  const sheet = spreadsheet.getSheetByName(
    targetSheetName || FILE_STATUS_CONFIG.TARGET_SHEET_NAME
  );

  if (!sheet) {
    throw new Error(
      "Sheet not found in daily file: " +
      (targetSheetName || FILE_STATUS_CONFIG.TARGET_SHEET_NAME)
    );
  }

  console.log(
    "[File Status] Target file=" + spreadsheet.getName() +
    " id=" + spreadsheet.getId()
  );
  return sheet;
}

function evaluateDcpStatusFileCount_(rows) {
  if (!rows.length) {
    throw new Error("DCP Status_File_Count_H-1 query returned no rows");
  }

  const totals = {};
  let fileDate = "";
  rows.forEach(row => {
    if (!fileDate && row["File Date"]) fileDate = String(row["File Date"]);
    const source = normalizeFileStatusName_(row.source_name);
    if (FILE_STATUS_CONFIG.HIGH_VOLUME_SOURCES.indexOf(source) === -1) return;
    totals[source] = (totals[source] || 0) + Number(row.total_count || 0);
  });

  const failures = [];
  const sourceNotes = FILE_STATUS_CONFIG.HIGH_VOLUME_SOURCES.map(source => {
    if (!Object.prototype.hasOwnProperty.call(totals, source)) {
      failures.push(source.toUpperCase() + " missing");
      return source.toUpperCase() + ": MISSING";
    }
    const total = totals[source];
    if (total < DCP_FILE_STATUS_CONFIG.MINIMUM) {
      failures.push(
        source.toUpperCase() + " " + formatDcpFileStatusNumber_(total)
      );
    }
    return source.toUpperCase() + ": " + formatDcpFileStatusNumber_(total);
  });
  const status = failures.length ? "FAILED" : "PASS";
  const notes = [
    formatFileStatusDateLabel_(fileDate) + " " + status
  ].concat(sourceNotes, [
    "Minimum: " + formatDcpFileStatusNumber_(DCP_FILE_STATUS_CONFIG.MINIMUM)
  ]);
  if (failures.length) notes.push("Failed: " + failures.join("; "));

  return {
    status: status,
    notes: notes.join(", "),
    details: {
      minimum: DCP_FILE_STATUS_CONFIG.MINIMUM,
      sourcesChecked: FILE_STATUS_CONFIG.HIGH_VOLUME_SOURCES.length,
      failures: failures
    }
  };
}

function formatDcpFileStatusNumber_(value) {
  return Number(value || 0).toLocaleString("id-ID");
}

function validateFileStatusTaskRow_(sheet, task) {
  const label = String(
    sheet.getRange(task.row, 5).getDisplayValue() || ""
  ).trim();

  if (!label) {
    console.warn(
      "[File Status] Column E is empty at row " + task.row +
      " for task " + task.name
    );
    return;
  }

  const normalizedLabel = normalizeFileStatusName_(label);
  const normalizedTask = normalizeFileStatusName_(task.name);
  if (
    normalizedLabel.indexOf(normalizedTask) === -1 &&
    normalizedTask.indexOf(normalizedLabel) === -1
  ) {
    console.warn(
      "[File Status] Row label mismatch at row " + task.row +
      ": expected=" + task.name + " actual=" + label
    );
  }
}

function executeFileStatusQuery_(query) {
  const request = {
    query: query,
    useLegacySql: false,
    maxResults: 10000
  };
  let response = BigQuery.Jobs.query(
    request,
    FILE_STATUS_CONFIG.PROJECT_ID
  );
  const jobReference = response.jobReference;

  if (!jobReference || !jobReference.jobId) {
    throw new Error("BigQuery did not return a job ID");
  }

  const resultOptions = {
    maxResults: 10000
  };
  if (jobReference.location) {
    resultOptions.location = jobReference.location;
  }

  let attempts = 0;
  while (!response.jobComplete) {
    if (attempts >= 120) {
      throw new Error("BigQuery job timed out after 120 seconds");
    }
    Utilities.sleep(1000);
    response = BigQuery.Jobs.getQueryResults(
      FILE_STATUS_CONFIG.PROJECT_ID,
      jobReference.jobId,
      resultOptions
    );
    attempts++;
  }

  if (response.errors && response.errors.length) {
    throw new Error(
      response.errors.map(error => error.message).join("; ")
    );
  }

  const schema = response.schema;
  if (!schema || !schema.fields) {
    throw new Error("BigQuery result schema is unavailable");
  }

  let rawRows = response.rows || [];
  let pageToken = response.pageToken || "";

  while (pageToken) {
    const pageOptions = {
      maxResults: 10000,
      pageToken: pageToken
    };
    if (jobReference.location) {
      pageOptions.location = jobReference.location;
    }

    const page = BigQuery.Jobs.getQueryResults(
      FILE_STATUS_CONFIG.PROJECT_ID,
      jobReference.jobId,
      pageOptions
    );
    rawRows = rawRows.concat(page.rows || []);
    pageToken = page.pageToken || "";
  }

  return rawRows.map(row =>
    convertFileStatusBigQueryRow_(schema.fields, row)
  );
}

function convertFileStatusBigQueryRow_(fields, row) {
  const result = {};
  fields.forEach((field, index) => {
    const cell = row.f && row.f[index] ? row.f[index].v : null;
    result[field.name] = cell;
  });
  return result;
}

function evaluateStatusFileCount_(rows, branchRows) {
  if (!rows.length) {
    throw new Error("Status_File_Count_H-1 query returned no rows");
  }

  const requiredSources = new Set(
    FILE_STATUS_CONFIG.HIGH_VOLUME_SOURCES
  );
  const foundRequiredSources = new Set();
  const failedLines = [];
  const excludedSources = new Set();
  let otherCount = 0;
  let passedOtherCount = 0;
  let branchCheckCount = 0;
  let passedBranchCount = 0;
  let fileDate = "";

  rows.forEach(row => {
    if (!fileDate && row["File Date"]) {
      fileDate = String(row["File Date"]);
    }

    const sourceDisplay = String(row.source_name || "").trim();
    const source = normalizeFileStatusName_(sourceDisplay);
    const totalCount = Number(row.total_count || 0);
    if (isExcludedFileStatusSource_(source)) {
      excludedSources.add(sourceDisplay || source);
      return;
    }

    if (requiredSources.has(source)) {
      foundRequiredSources.add(source);
      if (totalCount < FILE_STATUS_CONFIG.HIGH_VOLUME_MINIMUM) {
        failedLines.push(
          sourceDisplay + ": " + formatFileStatusNumber_(totalCount) +
          " (minimum " +
          formatFileStatusNumber_(
            FILE_STATUS_CONFIG.HIGH_VOLUME_MINIMUM
          ) + ")"
        );
      }

      return;
    }

    otherCount++;
    if (totalCount > 0) {
      passedOtherCount++;
    } else {
      failedLines.push(sourceDisplay + ": 0 (must be > 0)");
    }
  });

  FILE_STATUS_CONFIG.HIGH_VOLUME_SOURCES.forEach(source => {
    if (!foundRequiredSources.has(source)) {
      failedLines.push(source.toUpperCase() + ": missing from query result");
    }
  });

  const branchCountsBySource = {};
  const branchFailures = {};
  Object.keys(FILE_STATUS_CONFIG.BRANCH_MINIMUMS)
    .forEach(branch => {
      branchFailures[branch] = [];
    });

  (branchRows || []).forEach(row => {
    const source = normalizeFileStatusName_(row.source_name);
    const branch = String(row.branch_cd || "").trim().toUpperCase();
    if (!requiredSources.has(source) ||
        !FILE_STATUS_CONFIG.BRANCH_MINIMUMS.hasOwnProperty(branch)) {
      return;
    }

    if (!branchCountsBySource[source]) {
      branchCountsBySource[source] = {};
    }
    branchCountsBySource[source][branch] = Number(row.total_count || 0);
  });

  FILE_STATUS_CONFIG.HIGH_VOLUME_SOURCES.forEach(source => {
    Object.keys(FILE_STATUS_CONFIG.BRANCH_MINIMUMS)
      .forEach(branch => {
        const minimum = FILE_STATUS_CONFIG.BRANCH_MINIMUMS[branch];
        const branchCount = branchCountsBySource[source] &&
          branchCountsBySource[source].hasOwnProperty(branch)
          ? branchCountsBySource[source][branch]
          : 0;
        branchCheckCount++;
        if (branchCount <= minimum) {
          branchFailures[branch].push(
            source.toUpperCase() + ": " +
            formatFileStatusNumber_(branchCount)
          );
        } else {
          passedBranchCount++;
        }
      });
  });

  const passedRequiredCount =
    FILE_STATUS_CONFIG.HIGH_VOLUME_SOURCES.length -
    FILE_STATUS_CONFIG.HIGH_VOLUME_SOURCES.filter(source =>
      failedLines.some(line =>
        normalizeFileStatusName_(line).indexOf(source + ":") === 0
      )
    ).length;
  const branchFailedLines = Object.keys(
    FILE_STATUS_CONFIG.BRANCH_MINIMUMS
  ).map(branch => {
    return branchFailures[branch].length
      ? branch + " - " + branchFailures[branch].join(", ")
      : branch + " PASS";
  });
  const hasBranchFailure = Object.keys(branchFailures)
    .some(branch => branchFailures[branch].length > 0);
  const dateLabel = formatFileStatusDateLabel_(fileDate);
  const status = failedLines.length || hasBranchFailure
    ? "FAILED"
    : "PASS";
  const notes = [
    dateLabel + " " + status,
    "High Volume: " + passedRequiredCount + "/" +
      FILE_STATUS_CONFIG.HIGH_VOLUME_SOURCES.length +
      " >= " +
      formatFileStatusNumber_(
        FILE_STATUS_CONFIG.HIGH_VOLUME_MINIMUM
      ),
    "Branch Minimums: B001 > " +
      formatFileStatusNumber_(
        FILE_STATUS_CONFIG.BRANCH_MINIMUMS.B001
      ) + ", B002 > " +
      formatFileStatusNumber_(
        FILE_STATUS_CONFIG.BRANCH_MINIMUMS.B002
      ) + " (" + passedBranchCount + "/" +
      branchCheckCount + " passed)"
  ].concat(
    branchFailedLines,
    [
    "Other Sources: " + passedOtherCount + "/" + otherCount + " > 0",
    "Excluded: " + (excludedSources.size
      ? Array.from(excludedSources).join(", ")
      : "None")
    ],
    failedLines
  ).join("\n");

  return {
    status: status,
    notes: notes,
    details: {
      highVolumePassed: passedRequiredCount,
      highVolumeTotal:
        FILE_STATUS_CONFIG.HIGH_VOLUME_SOURCES.length,
      branchPassed: passedBranchCount,
      branchTotal: branchCheckCount,
      otherPassed: passedOtherCount,
      otherTotal: otherCount,
      excluded: Array.from(excludedSources),
      failures: failedLines.concat(branchFailedLines.filter(line =>
        line.indexOf(" PASS") === -1
      ))
    }
  };
}

function evaluateStatusFileAvailability_(rows) {
  if (!rows.length) {
    throw new Error(
      "Status_File_Availability_H-1 query returned no rows"
    );
  }

  const uniqueFiles = {};
  let fileDate = "";

  rows.forEach(row => {
    if (!fileDate && row.Date) {
      fileDate = String(row.Date);
    }

    const prefix = String(row.Prefix_Filename || "").trim();
    const folder = String(row.folder_name || "").trim();
    const status = String(
      row.file_availablity_status || ""
    ).trim();
    const key =
      normalizeFileStatusName_(prefix) + "|" +
      normalizeFileStatusName_(folder);

    if (!uniqueFiles[key]) {
      uniqueFiles[key] = {
        prefix: prefix,
        folder: folder,
        available: true
      };
    }

    if (normalizeFileStatusName_(status) !== "available") {
      uniqueFiles[key].available = false;
    }
  });

  const files = Object.keys(uniqueFiles)
    .map(key => uniqueFiles[key]);
  const unavailableFiles = files.filter(file => !file.available);
  const availableCount = files.length - unavailableFiles.length;
  const dateLabel = formatFileStatusDateLabel_(fileDate);
  const status = unavailableFiles.length ? "FAILED" : "PASS";
  const notes = [
    dateLabel + " " + status,
    "Available: " + availableCount + "/" + files.length,
    "Not Available: " + unavailableFiles.length
  ].concat(
    unavailableFiles.map(file =>
      file.prefix + " | " + file.folder
    )
  ).join("\n");

  return {
    status: status,
    notes: notes,
    details: {
      available: availableCount,
      total: files.length,
      unavailable: unavailableFiles
    }
  };
}

function isExcludedFileStatusSource_(normalizedSource) {
  return normalizedSource.indexOf("sd3 -") === 0 ||
    normalizedSource === "btb_dc";
}

function normalizeFileStatusName_(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function formatFileStatusDateLabel_(dateStr) {
  const parts = String(dateStr || "").split("-").map(Number);
  const date = parts.length === 3 && parts.every(Number.isFinite)
    ? new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0)
    : new Date();

  return Utilities.formatDate(
    date,
    Session.getScriptTimeZone(),
    "dd MMM yyyy"
  );
}

function formatFileStatusNumber_(value) {
  return Number(value || 0).toLocaleString("en-US");
}
