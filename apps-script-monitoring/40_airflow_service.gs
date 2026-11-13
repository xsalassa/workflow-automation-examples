const AIRFLOW_CONFIG = {
  TIMEZONE: "Asia/Jakarta",
  MONITORING_DATE_CELL: "B2",
  FIRST_DATA_ROW: 5,
  PARAMETER_COLUMN: 3, // C
  SCHEDULE_COLUMN: 5, // E
  DAG_ID_COLUMN: 6, // F
  START_COLUMN: 8, // H
  END_COLUMN: 9, // I
  STATUS_COLUMN: 11, // K
  NOTES_COLUMN: 12, // L
  OPS_SHEET_NAME: "Ops Checkpoint",
  OPS_LABEL_COLUMN: 3, // C
  OPS_START_COLUMN: 6, // F
  OPS_END_COLUMN: 7, // G
  OPS_TIME_FORMAT: "HH:mm",
  CHECKPOINTS: ["09:00", "11:00", "13:30", "14:00", "17:00"],
  NIGHT_JOB_START_HOUR: 17,
  NOT_FOUND_GRACE_MINUTES: 15,
  DAG_RUN_FETCH_LIMIT: 100,
  TASK_FETCH_LIMIT: 100,
};

function runAirflowMonitoring0900() {
  return runAirflowMonitoringWindow_("09:00");
}

function runAirflowMonitoring1100() {
  return runAirflowMonitoringWindow_("11:00");
}

function runAirflowMonitoring1330() {
  return runAirflowMonitoringWindow_("13:30");
}

function runAirflowMonitoring1400() {
  return runAirflowMonitoringWindow_("14:00");
}

function runAirflowMonitoring1700() {
  return runAirflowMonitoringWindow_("17:00");
}

/**
 * Entry point lama sengaja tidak memilih window secara otomatis.
 */
function updateAllAirflowDags() {
  throw new Error(
    "Pilih window Airflow yang tersedia untuk jenis hari ini dari sidebar."
  );
}

function runAirflowMonitoringWindow_(checkpointValue) {
  const checkpoint = normalizeAirflowCheckpoint_(checkpointValue);
  if (AIRFLOW_CONFIG.CHECKPOINTS.indexOf(checkpoint.key) === -1) {
    throw new Error("Window Airflow tidak valid: " + checkpoint.key);
  }

  const dayContext = getRuntimeMonitoringContext_();
  if (dayContext.airflowWindows.indexOf(checkpoint.key) === -1) {
    throw new Error(
      "Window Airflow " + checkpoint.key + " tidak berlaku untuk " +
      dayContext.dayTypeDisplay + ". Window aktif: " +
      dayContext.airflowWindows.join(", ") + "."
    );
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    throw new Error("Another monitoring process is still running");
  }

  const startedAt = new Date();
  let spreadsheet = null;
  let checkpointRow = null;

  try {
    const properties = PropertiesService.getScriptProperties();

    const airflowBaseUrl = getRequiredProperty_(
      properties,
      "AIRFLOW_BASE_URL"
    ).replace(/\/+$/, "");

    const dailyFileId = getRequiredProperty_(properties, "DAILY_FILE_ID");

    const dailyFileDate = getRequiredProperty_(properties, "DAILY_FILE_DATE");

    const today = Utilities.formatDate(
      new Date(),
      AIRFLOW_CONFIG.TIMEZONE,
      "yyyy-MM-dd"
    );

    if (dailyFileDate !== today) {
      throw new Error(
        `DAILY_FILE_DATE stale: ${dailyFileDate}. Expected: ${today}.`
      );
    }

    spreadsheet = SpreadsheetApp.openById(dailyFileId);
    const opsSheet = spreadsheet.getSheetByName(AIRFLOW_CONFIG.OPS_SHEET_NAME);
    if (!opsSheet) {
      throw new Error("Sheet Ops Checkpoint tidak ditemukan di daily file.");
    }

    checkpointRow = findAirflowCheckpointRow_(opsSheet, checkpoint);
    startAirflowCheckpointTiming_(opsSheet, checkpointRow, startedAt);

    const checkpointCutoff = createAirflowCheckpointCutoff_(
      dailyFileDate,
      checkpoint
    );

    const dailyFileDateCompact = dailyFileDate.replace(/-/g, "");
    const sheets = spreadsheet
      .getSheets()
      .filter((sheet) =>
        sheet.getName() === "Monitoring Airflow " + dailyFileDateCompact
      )
      .sort((left, right) => left.getName().localeCompare(right.getName()));

    if (sheets.length === 0) {
      throw new Error("Sheet Monitoring Airflow YYYYMMDD tidak ditemukan.");
    }

    const sheetResults = sheets.map((sheet) => {
      const results = processAirflowSheet_(
        sheet,
        airflowBaseUrl,
        dailyFileDate,
        checkpoint
      );
      return summarizeAirflowWindowSheet_(sheet.getName(), results);
    });

    return {
      checkpoint: checkpoint.key,
      cutoff: checkpointCutoff.toISOString(),
      sheets: sheetResults
    };
  } finally {
    try {
      if (spreadsheet && checkpointRow !== null) {
        finishAirflowCheckpointTiming_(
          spreadsheet.getSheetByName(AIRFLOW_CONFIG.OPS_SHEET_NAME),
          checkpointRow,
          new Date()
        );
      }
    } catch (timingError) {
      console.error(
        "[Airflow] Failed to write checkpoint End Time: " +
        timingError.message
      );
    }

    try {
      if (spreadsheet) cleanupStatusFormulaProperties_(spreadsheet);
    } catch (cleanupError) {
      console.error(
        "[Airflow] Failed to clean formula properties: " +
        cleanupError.message
      );
    }

    lock.releaseLock();
  }
}

function summarizeAirflowWindowSheet_(sheetName, results) {
  const statuses = {};
  (results || []).forEach((result) => {
    const status = String(result.status || "UNKNOWN");
    statuses[status] = (statuses[status] || 0) + 1;
  });
  return {
    sheet: sheetName,
    checked: (results || []).length,
    statuses: statuses
  };
}

function processAirflowSheet_(
  sheet,
  airflowBaseUrl,
  dailyFileDate,
  checkpoint
) {
  console.log(
    `=== AIRFLOW SHEET START: ${sheet.getName()} ` +
    `WINDOW ${checkpoint.key} ===`
  );

  /*
   * Pastikan template formula Status sudah tersimpan.
   * Hanya satu property per sheet.
   */
  initializeStatusFormulaTemplate_(sheet);

  const monitoringDateRaw = sheet.getRange(AIRFLOW_CONFIG.MONITORING_DATE_CELL).getValue();

  const monitoringDate = parseSheetDate_(monitoringDateRaw);

  if (!monitoringDate) {
    throw new Error(
      `Tanggal monitoring pada ` + `${AIRFLOW_CONFIG.MONITORING_DATE_CELL} tidak valid.`,
    );
  }

  // Historical weekend/holiday sheets are fully due when the next working-day
  // file is monitored. The current-date sheet still uses the selected window.
  const sheetMonitoringDate = Utilities.formatDate(
    monitoringDate,
    AIRFLOW_CONFIG.TIMEZONE,
    "yyyy-MM-dd"
  );
  const checkpointCutoff = createAirflowSheetCutoff_(
    sheetMonitoringDate,
    dailyFileDate,
    checkpoint
  );

  const firstRow = AIRFLOW_CONFIG.FIRST_DATA_ROW;

  const lastRow = sheet.getLastRow();

  if (lastRow < firstRow) {
    console.log("Tidak ada data DAG untuk diproses.");
    return;
  }

  const rowCount = lastRow - firstRow + 1;

  /*
   * Ambil Column C sampai M.
   *
   * Index:
   * 0  = C Parameter
   * 1  = D
   * 2  = E Schedule
   * 3  = F DAG ID
   * 4  = G
   * 5  = H
   * 6  = I Start
   * 7  = J End
   * 8  = K Duration
   * 9  = L Status
   * 10 = M Notes
   */
  const rows = sheet.getRange(firstRow, AIRFLOW_CONFIG.PARAMETER_COLUMN, rowCount, 11).getValues();

  const now = new Date();
  const summaries = [];

  for (let index = 0; index < rows.length; index++) {
    const rowNumber = firstRow + index;

    const parameterValue = rows[index][0];

    const scheduleValue = rows[index][2];

    const dagId = String(rows[index][3] || "").trim();

    if (!dagId) {
      continue;
    }

    const currentStatus = String(
      rows[index][AIRFLOW_CONFIG.STATUS_COLUMN - AIRFLOW_CONFIG.PARAMETER_COLUMN] || "",
    )
      .trim()
      .toUpperCase();

    if (currentStatus === "OK") {
      continue;
    }

    try {
      const schedule = parseSheetTime_(
        scheduleValue,
        AIRFLOW_CONFIG.TIMEZONE
      );

      if (!schedule) {
        throw new Error("Schedule pada Column E tidak valid.");
      }

      /*
       * Job malam:
       * schedule 17:00–23:59 memakai B2 - 1 hari.
       */
      const targetRunDate = getTargetRunDate_(monitoringDate, schedule);

      const targetDateTime = combineDateAndSchedule_(targetRunDate, schedule);

      /*
       * Window bersifat cumulative. Job pada window sebelumnya yang belum OK
       * ikut diperiksa ulang, sedangkan job pada/di atas cutoff belum disentuh.
       */
      if (
        targetDateTime.getTime() >= checkpointCutoff.getTime() ||
        !isScheduleDue_(targetDateTime, now)
      ) {
        console.log(
          `[Airflow] SKIP OUTSIDE WINDOW row=${rowNumber} dag=${dagId} ` +
          `target=${formatDateTimeObject_(targetDateTime, AIRFLOW_CONFIG.TIMEZONE)} ` +
          `cutoff=${formatDateTimeObject_(checkpointCutoff, AIRFLOW_CONFIG.TIMEZONE)}`
        );
        continue;
      }

      console.log(
        `[Airflow] CHECK DAG row=${rowNumber} dag=${dagId} ` +
        `target=${formatDateTimeObject_(targetDateTime, AIRFLOW_CONFIG.TIMEZONE)}`
      );

      /*
       * Column C dievaluasi berdasarkan tanggal target run.
       */
      const shouldRun = shouldJobRunOnDate_(parameterValue, targetRunDate, AIRFLOW_CONFIG.TIMEZONE);

      if (!shouldRun) {
        handleNoSchedule_(sheet, rowNumber);

        summaries.push({
          row: rowNumber,
          dagId: dagId,
          status: "NO SCHEDULE",
          reason: "Parameter Column C tidak sesuai.",
        });

        continue;
      }

      const dagRun = getDagRunByTargetSchedule_(
        airflowBaseUrl,
        dagId,
        targetDateTime,
        AIRFLOW_CONFIG.TIMEZONE,
      );

      if (!dagRun) {
        const gracePassed = isGracePeriodPassed_(
          targetDateTime,
          now,
          AIRFLOW_CONFIG.NOT_FOUND_GRACE_MINUTES,
        );

        if (gracePassed) {
          handleDagNotFound_(sheet, rowNumber, targetDateTime);

          summaries.push({
            row: rowNumber,
            dagId: dagId,
            status: "NOT FOUND",
          });
        } else {
          handleNotDueYet_(rowNumber, dagId, targetDateTime);

          summaries.push({
            row: rowNumber,
            dagId: dagId,
            status: "WAITING GRACE PERIOD",
          });
        }

        continue;
      }

      let taskInstances;
      try {
        taskInstances = getTaskInstances_(
          airflowBaseUrl,
          dagId,
          dagRun.dag_run_id
        );
      } catch (taskError) {
        const dagRunState = String(dagRun.state || "").trim().toUpperCase();
        if (dagRunState === "RUNNING" && isAirflowPermissionDenied_(taskError)) {
          const limitedResult = buildMonitoringResult_(
            dagRun,
            [],
            AIRFLOW_CONFIG.TIMEZONE
          );
          limitedResult.notes =
            "Status berdasarkan DAG run. Detail task tidak dapat dibaca " +
            "karena Airflow API mengembalikan HTTP 403.";
          updateDagRow_(sheet, rowNumber, limitedResult);
          summaries.push({
            row: rowNumber,
            dagId: dagId,
            dagRunId: limitedResult.dagRunId,
            status: limitedResult.status,
            start: limitedResult.startTime,
            end: limitedResult.endTime,
            warning: "Task detail HTTP 403; menggunakan status DAG run.",
          });
          console.warn(
            `[Airflow] LIMITED ACCESS dag=${dagId} run=${dagRun.dag_run_id} ` +
            `status=${dagRunState} taskInstances=HTTP403`
          );
          continue;
        }
        throw new Error(
          `Gagal membaca task instances untuk ${dagId}: ` +
          String(taskError.message || taskError)
        );
      }

      logAirflowTasks_(dagId, dagRun.dag_run_id, taskInstances);

      const result = buildMonitoringResult_(dagRun, taskInstances, AIRFLOW_CONFIG.TIMEZONE);

      const childResult = evaluateTriggeredChildDags_(
        airflowBaseUrl,
        dagId,
        dagRun.dag_run_id,
        taskInstances,
      );

      if (result.status !== "SUCCESS") {
        addParentDagNote_(result, airflowBaseUrl);
      }
      if (childResult) {
        result.status = resolveChildTreeStatus_(result.status, [childResult]);
        appendChildResultToParent_(result, childResult);
      }

      updateDagRow_(sheet, rowNumber, result);

      summaries.push({
        row: rowNumber,
        dagId: dagId,
        dagRunId: result.dagRunId,
        status: result.status,
        start: result.startTime,
        end: result.endTime,
      });
    } catch (error) {
      handleMonitoringError_(sheet, rowNumber, error);

      summaries.push({
        row: rowNumber,
        dagId: dagId,
        status: "ERROR",
        error: String(error.message || error),
      });

      console.error(`Row ${rowNumber} | ` + `${dagId} | ${error}`);
    }
  }

  sheet.autoResizeRows(firstRow, rowCount);
  SpreadsheetApp.flush();

  console.log(`=== AIRFLOW SHEET COMPLETED: ${sheet.getName()} ===`);

  console.log(JSON.stringify(summaries, null, 2));
  return summaries;
}

function normalizeAirflowCheckpoint_(checkpointValue) {
  if (
    checkpointValue &&
    typeof checkpointValue === "object" &&
    checkpointValue.key
  ) {
    return checkpointValue;
  }

  const raw = typeof checkpointValue === "number"
    ? String(checkpointValue).padStart(2, "0") + ":00"
    : String(checkpointValue || "").trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    throw new Error("Format window Airflow tidak valid: " + raw);
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) {
    throw new Error("Window Airflow tidak valid: " + raw);
  }
  return {
    key: String(hour).padStart(2, "0") + ":" +
      String(minute).padStart(2, "0"),
    hour: hour,
    minute: minute,
    totalMinutes: (hour * 60) + minute
  };
}

function createAirflowCheckpointCutoff_(dailyFileDate, checkpointValue) {
  const match = String(dailyFileDate).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new Error("DAILY_FILE_DATE tidak valid: " + dailyFileDate);
  }
  const checkpoint = normalizeAirflowCheckpoint_(checkpointValue);
  return new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    checkpoint.hour,
    checkpoint.minute,
    0,
    0
  );
}

function createAirflowSheetCutoff_(
  sheetMonitoringDate,
  dailyFileDate,
  checkpointValue
) {
  return createAirflowCheckpointCutoff_(
    sheetMonitoringDate,
    checkpointValue
  );
}

function findAirflowCheckpointRow_(sheet, checkpointValue) {
  const checkpoint = normalizeAirflowCheckpoint_(checkpointValue);
  const lastRow = sheet.getLastRow();
  const labels = sheet.getRange(
    1,
    AIRFLOW_CONFIG.OPS_LABEL_COLUMN,
    lastRow,
    1
  ).getDisplayValues();
  const hourPattern = checkpoint.hour < 10
    ? "0?" + checkpoint.hour
    : String(checkpoint.hour);
  const marker = new RegExp(
    "<\\s*" + hourPattern + "\\s*:\\s*" +
      String(checkpoint.minute).padStart(2, "0"),
    "i"
  );

  for (let index = 0; index < labels.length; index++) {
    const label = String(labels[index][0] || "");
    if (/Monitor\s+Schedule\s+Jobs/i.test(label) && marker.test(label)) {
      return index + 1;
    }
  }

  throw new Error(
    "Row Ops Checkpoint untuk window " + checkpoint.key + " tidak ditemukan."
  );
}

function startAirflowCheckpointTiming_(sheet, rowNumber, startedAt) {
  sheet.getRange(rowNumber, AIRFLOW_CONFIG.OPS_START_COLUMN)
    .setValue(startedAt)
    .setNumberFormat(AIRFLOW_CONFIG.OPS_TIME_FORMAT);
  sheet.getRange(rowNumber, AIRFLOW_CONFIG.OPS_END_COLUMN)
    .clearContent()
    .setNumberFormat(AIRFLOW_CONFIG.OPS_TIME_FORMAT);
  SpreadsheetApp.flush();
}

function finishAirflowCheckpointTiming_(sheet, rowNumber, endedAt) {
  if (!sheet) return;
  const startTime = sheet.getRange(
    rowNumber,
    AIRFLOW_CONFIG.OPS_START_COLUMN
  ).getValue();
  const effectiveEndTime = ensureDistinctAirflowCheckpointEnd_(
    startTime,
    endedAt
  );
  sheet.getRange(rowNumber, AIRFLOW_CONFIG.OPS_END_COLUMN)
    .setValue(effectiveEndTime)
    .setNumberFormat(AIRFLOW_CONFIG.OPS_TIME_FORMAT);
  SpreadsheetApp.flush();
}

function ensureDistinctAirflowCheckpointEnd_(startTime, endTime) {
  if (!(startTime instanceof Date) || isNaN(startTime.getTime())) {
    return endTime;
  }
  const format = "HH:mm:ss";
  const startSecond = Utilities.formatDate(
    startTime,
    AIRFLOW_CONFIG.TIMEZONE,
    format
  );
  const endSecond = Utilities.formatDate(
    endTime,
    AIRFLOW_CONFIG.TIMEZONE,
    format
  );
  return startSecond === endSecond
    ? new Date(endTime.getTime() + 1000)
    : endTime;
}

/**
 * Menentukan tanggal target run.
 *
 * Schedule >= 17:00 menggunakan B2 - 1 hari.
 */
function getTargetRunDate_(monitoringDate, schedule) {
  const targetDate = new Date(
    monitoringDate.getFullYear(),
    monitoringDate.getMonth(),
    monitoringDate.getDate(),
  );

  if (schedule.hours >= AIRFLOW_CONFIG.NIGHT_JOB_START_HOUR) {
    targetDate.setDate(targetDate.getDate() - 1);
  }

  return targetDate;
}

/**
 * Evaluasi parameter Column C.
 *
 * Contoh:
 * 1, 2, 3, ..., 31
 * 6
 * 15
 * Thursday
 * Monday, 2,11
 * Sunday, 2,4,14
 *
 * Angka = tanggal.
 * Nama hari = hari.
 * Campuran menggunakan OR.
 */
function shouldJobRunOnDate_(parameterValue, targetDate, timezone) {
  const parameterText = String(parameterValue || "").trim();

  if (!parameterText) {
    return false;
  }

  const tokens = parameterText
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (tokens.length === 0) {
    return false;
  }

  const targetDayOfMonth = Number(Utilities.formatDate(targetDate, timezone, "d"));

  const targetDayName = normalizeDayName_(Utilities.formatDate(targetDate, timezone, "EEEE"));

  return tokens.some((token) => {
    const normalizedToken = String(token).trim().toLowerCase();

    if (/^\d+$/.test(normalizedToken)) {
      return Number(normalizedToken) === targetDayOfMonth;
    }

    return normalizeDayName_(normalizedToken) === targetDayName;
  });
}

/**
 * Normalisasi nama hari English/Indonesia.
 */
function normalizeDayName_(dayName) {
  const normalized = String(dayName || "")
    .trim()
    .toLowerCase();

  const aliases = {
    sunday: "sunday",
    minggu: "sunday",

    monday: "monday",
    senin: "monday",

    tuesday: "tuesday",
    selasa: "tuesday",

    wednesday: "wednesday",
    rabu: "wednesday",

    thursday: "thursday",
    kamis: "thursday",

    friday: "friday",
    jumat: "friday",
    "jum'at": "friday",

    saturday: "saturday",
    sabtu: "saturday",
  };

  return aliases[normalized] || normalized;
}

/**
 * Gabungkan tanggal target dan jam schedule.
 */
function combineDateAndSchedule_(targetDate, schedule) {
  if (!targetDate || !schedule) {
    return null;
  }

  return new Date(
    targetDate.getFullYear(),
    targetDate.getMonth(),
    targetDate.getDate(),
    schedule.hours,
    schedule.minutes,
    schedule.seconds,
    0,
  );
}

/**
 * Apakah jadwal sudah tiba.
 */
function isScheduleDue_(targetDateTime, currentDateTime) {
  return currentDateTime.getTime() >= targetDateTime.getTime();
}

/**
 * Apakah grace period sudah selesai.
 */
function isGracePeriodPassed_(targetDateTime, currentDateTime, graceMinutes) {
  const targetWithGrace = targetDateTime.getTime() + graceMinutes * 60 * 1000;

  return currentDateTime.getTime() >= targetWithGrace;
}

/**
 * Cari DAG run berdasarkan target schedule.
 *
 * Prioritas:
 * 1. data_interval_end
 * 2. logical_date
 * 3. actual start scheduled run
 * 4. manual run
 */
function getDagRunByTargetSchedule_(airflowBaseUrl, dagId, targetDateTime, timezone) {
  const targetKey = Utilities.formatDate(targetDateTime, timezone, "yyyy-MM-dd HH:mm");

  const url =
    `${airflowBaseUrl}/api/v1/dags/` +
    `${encodeURIComponent(dagId)}` +
    `/dagRuns` +
    `?limit=` +
    `${AIRFLOW_CONFIG.DAG_RUN_FETCH_LIMIT}` +
    `&order_by=-execution_date`;

  const data = airflowApiGet_(url);
  const dagRuns = data.dag_runs || [];

  console.log(`${dagId} | Target ${targetKey} | ` + `${dagRuns.length} runs checked`);

  const scheduledRuns = dagRuns.filter((run) => {
    return String(run.run_type || "").toLowerCase() === "scheduled";
  });

  const intervalMatch = scheduledRuns.find((run) => {
    return formatAirflowMinute_(run.data_interval_end, timezone) === targetKey;
  });

  if (intervalMatch) {
    return intervalMatch;
  }

  const logicalMatch = scheduledRuns.find((run) => {
    return formatAirflowMinute_(run.logical_date || run.execution_date, timezone) === targetKey;
  });

  if (logicalMatch) {
    return logicalMatch;
  }

  const scheduledStartMatch = findNearestRunByStartDate_(
    scheduledRuns,
    targetDateTime,
    timezone,
    12 * 60,
  );

  if (scheduledStartMatch) {
    return scheduledStartMatch;
  }

  /*
   * Manual rerun fallback.
   */
  const manualRuns = dagRuns.filter((run) => {
    return String(run.run_type || "").toLowerCase() === "manual";
  });

  return findNearestRunByStartDate_(manualRuns, targetDateTime, timezone, 24 * 60);
}

/**
 * Cari run berdasarkan actual start terdekat.
 */
function findNearestRunByStartDate_(dagRuns, targetDateTime, timezone, toleranceMinutes) {
  const targetDateKey = Utilities.formatDate(targetDateTime, timezone, "yyyy-MM-dd");

  let selectedRun = null;
  let smallestDifference = null;

  dagRuns.forEach((run) => {
    const startDate = parseIsoDate_(run.start_date);

    if (!startDate) {
      return;
    }

    const runDateKey = Utilities.formatDate(startDate, timezone, "yyyy-MM-dd");

    if (runDateKey !== targetDateKey) {
      return;
    }

    const differenceMinutes = Math.abs(startDate.getTime() - targetDateTime.getTime()) / 60000;

    if (differenceMinutes > toleranceMinutes) {
      return;
    }

    if (smallestDifference === null || differenceMinutes < smallestDifference) {
      selectedRun = run;
      smallestDifference = differenceMinutes;
    }
  });

  return selectedRun;
}

/**
 * Mengambil seluruh task instance.
 */
function getTaskInstances_(airflowBaseUrl, dagId, dagRunId) {
  const allTasks = [];

  const limit = AIRFLOW_CONFIG.TASK_FETCH_LIMIT;

  let offset = 0;

  while (true) {
    const url =
      `${airflowBaseUrl}/api/v1/dags/` +
      `${encodeURIComponent(dagId)}` +
      `/dagRuns/` +
      `${encodeURIComponent(dagRunId)}` +
      `/taskInstances` +
      `?limit=${limit}&offset=${offset}`;

    const data = airflowApiGet_(url);

    const tasks = data.task_instances || [];

    allTasks.push(...tasks);

    if (tasks.length < limit) {
      break;
    }

    offset += limit;
  }

  return allTasks;
}

/**
 * Evaluasi seluruh rantai child DAG yang dipanggil TriggerDagRunOperator.
 */
function evaluateTriggeredChildDags_(airflowBaseUrl, parentDagId, parentRunId, taskInstances) {
  const visitedRuns = new Set([parentDagId + "::" + parentRunId]);
  const childResults = inspectTriggeredChildDags_(
    airflowBaseUrl,
    parentDagId,
    parentRunId,
    taskInstances,
    visitedRuns
  );

  const nonSuccessChildren = childResults.filter(
    (child) => child.status !== "SUCCESS"
  );

  if (nonSuccessChildren.length === 0) {
    return null;
  }

  const noteState = { text: "", links: [] };
  nonSuccessChildren.forEach((child) => {
    appendChildTreeNotes_(noteState, child, 1);
  });

  return {
    status: resolveChildTreeStatus_("SUCCESS", nonSuccessChildren),
    notes: noteState.text,
    noteLinks: noteState.links,
  };
}

function inspectTriggeredChildDags_(
  airflowBaseUrl,
  parentDagId,
  parentRunId,
  taskInstances,
  visitedRuns
) {
  const triggerTasks = taskInstances.filter((task) => {
    const operator = String(task.operator || "").toLowerCase();
    const renderedFields = task.rendered_fields || {};
    const taskState = String(task.state || "").toLowerCase();

    return (
      taskState === "success" &&
      (
        operator.indexOf("triggerdagrunoperator") !== -1 ||
        Boolean(renderedFields.trigger_dag_id)
      )
    );
  });

  if (triggerTasks.length === 0) {
    return [];
  }

  return triggerTasks.map((task) => {
    try {
      const taskDetails =
        task.rendered_fields && task.rendered_fields.trigger_dag_id
          ? task
          : getAirflowTaskInstance_(airflowBaseUrl, parentDagId, parentRunId, task);
      const renderedFields = taskDetails.rendered_fields || task.rendered_fields || {};
      const childDagId = normalizeAirflowApiValue_(
        taskDetails.trigger_dag_id || renderedFields.trigger_dag_id,
      );

      if (!childDagId) {
        throw new Error("trigger_dag_id tidak ditemukan");
      }

      const childRunId = getTriggeredChildRunId_(airflowBaseUrl, parentDagId, parentRunId, task);

      if (!childRunId) {
        throw new Error("trigger_run_id tidak ditemukan");
      }

      const runKey = childDagId + "::" + childRunId;
      if (visitedRuns.has(runKey)) {
        return {
          taskId: task.task_id,
          dagId: childDagId,
          runId: childRunId,
          url: buildAirflowDagRunUrl_(airflowBaseUrl, childDagId, childRunId),
          dagStatus: "UNKNOWN",
          status: "CHILD CYCLE",
          taskNotes: "",
          children: [],
          error: "Siklus child DAG terdeteksi; traversal dihentikan untuk run ini.",
        };
      }

      const childRunUrl =
        `${airflowBaseUrl}/api/v1/dags/` +
        `${encodeURIComponent(childDagId)}/dagRuns/` +
        `${encodeURIComponent(childRunId)}`;
      const childRun = airflowApiGet_(childRunUrl);
      const childStatus = String(childRun.state || "")
        .trim()
        .toUpperCase();
      const childTaskInstances = getTaskInstances_(
        airflowBaseUrl,
        childDagId,
        childRunId
      );
      logAirflowTasks_(childDagId, childRunId, childTaskInstances);
      const childMonitoringResult = buildMonitoringResult_(
        childRun,
        childTaskInstances,
        AIRFLOW_CONFIG.TIMEZONE
      );
      const nextVisitedRuns = new Set(visitedRuns);
      nextVisitedRuns.add(runKey);
      const nestedChildren = inspectTriggeredChildDags_(
        airflowBaseUrl,
        childDagId,
        childRunId,
        childTaskInstances,
        nextVisitedRuns
      );

      return {
        taskId: task.task_id,
        dagId: childDagId,
        runId: childRunId,
        url: buildAirflowDagRunUrl_(airflowBaseUrl, childDagId, childRunId),
        dagStatus: childStatus || "UNKNOWN",
        status: resolveChildTreeStatus_(
          childMonitoringResult.status,
          nestedChildren
        ),
        taskNotes: childMonitoringResult.notes,
        children: nestedChildren,
      };
    } catch (error) {
      return {
        taskId: task.task_id,
        dagId: "",
        runId: "",
        dagStatus: "UNKNOWN",
        status: "CHILD NOT FOUND",
        taskNotes: "",
        children: [],
        error: String(error.message || error),
      };
    }
  });
}

function resolveChildTreeStatus_(dagStatus, children) {
  const statuses = [String(dagStatus || "UNKNOWN").toUpperCase()]
    .concat((children || []).map((child) => child.status));

  if (statuses.some((status) =>
    status === "FAILED" || status === "UPSTREAM_FAILED"
  )) {
    return "FAILED";
  }
  if (statuses.some((status) =>
    status === "CHILD NOT FOUND" ||
    status === "CHILD CYCLE" ||
    status === "UNKNOWN" ||
    status === "ERROR"
  )) {
    return "CHILD NOT FOUND";
  }
  if (statuses.every((status) => status === "SUCCESS")) {
    return "SUCCESS";
  }
  return "RUNNING";
}

function appendChildTreeNotes_(noteState, child, level) {
  if (noteState.text) noteState.text += "\n\n";

  const indent = "  ".repeat(Math.max(0, level - 1));
  noteState.text += indent + "Child DAG (level " + level + "): ";
  const dagName = child.dagId || child.taskId;
  const linkStart = noteState.text.length;
  noteState.text += dagName;
  if (child.url) {
    noteState.links.push({
      start: linkStart,
      end: noteState.text.length,
      url: child.url
    });
  }

  noteState.text += "\n" + indent + "DAG Status: " + child.dagStatus;
  if (child.status !== child.dagStatus) {
    noteState.text += "\n" + indent + "Chain Status: " + child.status;
  }
  if (child.runId) {
    noteState.text += "\n" + indent + "Run ID: " + child.runId;
  }
  if (child.taskNotes) {
    noteState.text += "\n" + indent + child.taskNotes.replace(
      /\n/g,
      "\n" + indent
    );
  }
  if (child.error) {
    noteState.text += "\n" + indent + "Error: " + child.error;
  }

  (child.children || [])
    .filter((nestedChild) => nestedChild.status !== "SUCCESS")
    .forEach((nestedChild) => {
      appendChildTreeNotes_(noteState, nestedChild, level + 1);
    });
}

function appendChildResultToParent_(result, childResult) {
  const separator = result.notes ? "\n\n" : "";
  const offset = String(result.notes || "").length + separator.length;
  result.notes = String(result.notes || "") + separator + childResult.notes;
  result.noteLinks = (result.noteLinks || []).concat(
    (childResult.noteLinks || []).map((link) => ({
      start: link.start + offset,
      end: link.end + offset,
      url: link.url
    }))
  );
}

function addParentDagNote_(result, airflowBaseUrl) {
  const taskNotes = result.notes;
  let notes = "DAG: ";
  const linkStart = notes.length;
  notes += result.dagId;
  const linkEnd = notes.length;
  notes += "\nDAG Status: " + (result.dagRunStatus || result.status);
  if (result.dagRunStatus && result.status !== result.dagRunStatus) {
    notes += "\nMonitoring Status: " + result.status;
  }
  notes += "\nRun ID: " + result.dagRunId;
  if (taskNotes) notes += "\n" + taskNotes;

  result.notes = notes;
  result.noteLinks = [{
    start: linkStart,
    end: linkEnd,
    url: buildAirflowDagRunUrl_(airflowBaseUrl, result.dagId, result.dagRunId),
  }];
}

function buildAirflowDagRunUrl_(airflowBaseUrl, dagId, dagRunId) {
  return (
    `${airflowBaseUrl}/dags/${encodeURIComponent(dagId)}/grid` +
    `?dag_run_id=${encodeURIComponent(dagRunId)}`
  );
}

function logAirflowTasks_(dagId, dagRunId, taskInstances) {
  console.log(`[Airflow] TASKS dag=${dagId} run=${dagRunId} ` + `total=${taskInstances.length}`);

  taskInstances.forEach((task) => {
    const mapIndex = Number(task.map_index) >= 0 ? `[${task.map_index}]` : "";
    console.log(
      `[Airflow] CHECK TASK dag=${dagId} ` +
        `task=${task.task_id}${mapIndex} ` +
        `state=${String(task.state || "NONE").toUpperCase()}`,
    );
  });
}

function getAirflowTaskInstance_(airflowBaseUrl, dagId, dagRunId, task) {
  let url =
    `${airflowBaseUrl}/api/v1/dags/` +
    `${encodeURIComponent(dagId)}/dagRuns/` +
    `${encodeURIComponent(dagRunId)}/taskInstances/` +
    `${encodeURIComponent(task.task_id)}`;

  if (Number(task.map_index) >= 0) {
    url += "/" + Number(task.map_index);
  }

  return airflowApiGet_(url);
}

function getTriggeredChildRunId_(airflowBaseUrl, dagId, dagRunId, task) {
  let url =
    `${airflowBaseUrl}/api/v1/dags/` +
    `${encodeURIComponent(dagId)}/dagRuns/` +
    `${encodeURIComponent(dagRunId)}/taskInstances/` +
    `${encodeURIComponent(task.task_id)}/xcomEntries/trigger_run_id`;

  if (Number(task.map_index) >= 0) {
    url += "?map_index=" + Number(task.map_index);
  }

  const xcom = airflowApiGet_(url);
  return normalizeAirflowApiValue_(xcom.value);
}

function normalizeAirflowApiValue_(value) {
  if (value === undefined || value === null) {
    return "";
  }

  const text = String(value).trim();
  if (text.length >= 2 && text[0] === '"' && text[text.length - 1] === '"') {
    try {
      return String(JSON.parse(text)).trim();
    } catch (error) {
      return text;
    }
  }

  if (text.length >= 2 && text[0] === "'" && text[text.length - 1] === "'") {
    return text.slice(1, -1).trim();
  }

  return text;
}

/**
 * Request GET ke Airflow API.
 */
function airflowApiGet_(url) {
  const token = ScriptApp.getOAuthToken();

  const response = UrlFetchApp.fetch(url, {
    method: "get",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    muteHttpExceptions: true,
    followRedirects: true,
  });

  const responseCode = response.getResponseCode();

  const responseBody = response.getContentText();

  if (responseCode < 200 || responseCode >= 300) {
    const apiPathMatch = String(url).match(/\/api\/v1\/[^?]*/);
    const apiPath = apiPathMatch ? apiPathMatch[0] : "Airflow endpoint";
    throw new Error(
      `Airflow API HTTP ${responseCode} pada ${apiPath}: ${responseBody}`
    );
  }

  try {
    return JSON.parse(responseBody);
  } catch (error) {
    throw new Error("Response Airflow bukan JSON valid.");
  }
}

function isAirflowPermissionDenied_(error) {
  return /Airflow API HTTP 403\b/.test(String(error && error.message || error));
}

/**
 * Build hasil monitoring.
 */
function buildMonitoringResult_(dagRun, taskInstances, timezone) {
  const failedTasks = filterTasksByState_(taskInstances, ["failed"]);

  const upstreamFailedTasks = filterTasksByState_(taskInstances, ["upstream_failed"]);

  const runningTasks = filterTasksByState_(taskInstances, ["running"]);

  const queuedTasks = filterTasksByState_(taskInstances, ["queued", "scheduled", "deferred"]);

  const retryTasks = filterTasksByState_(taskInstances, ["up_for_retry", "up_for_reschedule"]);

  const notes = buildTaskNotes_({
    failedTasks: failedTasks,
    upstreamFailedTasks: upstreamFailedTasks,
    runningTasks: runningTasks,
    queuedTasks: queuedTasks,
    retryTasks: retryTasks,
  });
  const dagRunStatus = String(dagRun.state || "")
    .trim()
    .toUpperCase();
  let monitoringStatus = dagRunStatus;

  if (failedTasks.length || upstreamFailedTasks.length) {
    monitoringStatus = "FAILED";
  } else if (
    runningTasks.length ||
    queuedTasks.length ||
    retryTasks.length
  ) {
    monitoringStatus = "RUNNING";
  }

  return {
    dagId: dagRun.dag_id,
    dagRunId: dagRun.dag_run_id,
    runType: dagRun.run_type || "",

    rawStartDate: dagRun.start_date,
    rawEndDate: dagRun.end_date,

    startTime: formatDateTime_(dagRun.start_date, timezone),

    endTime: formatDateTime_(dagRun.end_date, timezone),

    dagRunStatus: dagRunStatus,
    status: monitoringStatus,

    notes: notes,
  };
}

/**
 * Filter task berdasarkan state.
 */
function filterTasksByState_(taskInstances, states) {
  const expectedStates = states.map((state) => {
    return String(state).toLowerCase();
  });

  return taskInstances.filter((task) => {
    const taskState = String(task.state || "").toLowerCase();

    return expectedStates.includes(taskState);
  });
}

/**
 * Build Notes.
 */
function buildTaskNotes_(groups) {
  const noteParts = [];

  appendTaskGroup_(noteParts, "Failed", groups.failedTasks);

  appendTaskGroup_(noteParts, "Upstream failed", groups.upstreamFailedTasks);

  appendTaskGroup_(noteParts, "Running", groups.runningTasks);

  appendTaskGroup_(noteParts, "Queued", groups.queuedTasks);

  appendTaskGroup_(noteParts, "Retry", groups.retryTasks);

  return noteParts.join("\n");
}

/**
 * Tambahkan task ke Notes.
 */
function appendTaskGroup_(noteParts, label, tasks) {
  if (!tasks || tasks.length === 0) {
    return;
  }

  const taskNames = tasks.map((task) => {
    const taskId = task.task_id || "unknown_task";

    const mapIndex = task.map_index;

    if (mapIndex !== undefined && mapIndex !== null && Number(mapIndex) >= 0) {
      return `${taskId}[${mapIndex}]`;
    }

    return taskId;
  });

  noteParts.push(`${label}: ` + `${taskNames.join(", ")}`);
}

/**
 * Update result ke sheet.
 */
function updateDagRow_(sheet, rowNumber, result) {
  const startRange = sheet.getRange(rowNumber, AIRFLOW_CONFIG.START_COLUMN);

  const endRange = sheet.getRange(rowNumber, AIRFLOW_CONFIG.END_COLUMN);

  const statusRange = sheet.getRange(rowNumber, AIRFLOW_CONFIG.STATUS_COLUMN);

  const notesRange = sheet.getRange(rowNumber, AIRFLOW_CONFIG.NOTES_COLUMN);

  /*
   * Simpan template formula jika cell masih formula.
   */
  backupStatusFormulaTemplate_(statusRange);

  writeAirflowTime_(startRange, result.rawStartDate);

  writeAirflowTime_(endRange, result.rawEndDate);

  if (result.status === "SUCCESS") {
    restoreStatusFormula_(statusRange);

    notesRange.clearContent();
  } else {
    statusRange.setValue(result.status);

    writeAirflowNotes_(notesRange, getNotesForStatus_(result), result.noteLinks || []);
  }

  notesRange.setWrap(true).setVerticalAlignment("top");
}

function writeAirflowNotes_(range, notes, links) {
  const text = String(notes || "");
  if (!links.length) {
    range.setValue(text);
    return;
  }

  const builder = SpreadsheetApp.newRichTextValue().setText(text);
  links.forEach((link) => builder.setLinkUrl(link.start, link.end, link.url));
  range.setRichTextValue(builder.build());
}

/**
 * Job tidak terjadwal.
 *
 * I/J dikosongkan.
 * Formula L dipulihkan.
 * Notes dikosongkan.
 */
function handleNoSchedule_(sheet, rowNumber) {
  const startRange = sheet.getRange(rowNumber, AIRFLOW_CONFIG.START_COLUMN);

  const endRange = sheet.getRange(rowNumber, AIRFLOW_CONFIG.END_COLUMN);

  const statusRange = sheet.getRange(rowNumber, AIRFLOW_CONFIG.STATUS_COLUMN);

  const notesRange = sheet.getRange(rowNumber, AIRFLOW_CONFIG.NOTES_COLUMN);

  startRange.clearContent();
  endRange.clearContent();

  restoreStatusFormula_(statusRange);

  notesRange.clearContent();
}

/**
 * Job belum waktunya.
 *
 * Row tidak diubah.
 */
function handleNotDueYet_(rowNumber, dagId, targetDateTime) {
  console.log(
    `Row ${rowNumber} | ${dagId} | ` +
      `belum waktunya: ` +
      `${formatDateTimeObject_(targetDateTime, AIRFLOW_CONFIG.TIMEZONE)}`,
  );
}

/**
 * Job seharusnya jalan tetapi run tidak ditemukan.
 */
function handleDagNotFound_(sheet, rowNumber, targetDateTime) {
  const startRange = sheet.getRange(rowNumber, AIRFLOW_CONFIG.START_COLUMN);

  const endRange = sheet.getRange(rowNumber, AIRFLOW_CONFIG.END_COLUMN);

  const statusRange = sheet.getRange(rowNumber, AIRFLOW_CONFIG.STATUS_COLUMN);

  const notesRange = sheet.getRange(rowNumber, AIRFLOW_CONFIG.NOTES_COLUMN);

  backupStatusFormulaTemplate_(statusRange);

  startRange.clearContent();
  endRange.clearContent();

  statusRange.setValue("NOT FOUND");

  notesRange
    .setValue(
      `DAG run tidak ditemukan untuk ` +
        `${formatDateTimeObject_(targetDateTime, AIRFLOW_CONFIG.TIMEZONE)}.`,
    )
    .setWrap(true);
}

/**
 * Error internal Apps Script.
 */
function handleMonitoringError_(sheet, rowNumber, error) {
  const statusRange = sheet.getRange(rowNumber, AIRFLOW_CONFIG.STATUS_COLUMN);

  const notesRange = sheet.getRange(rowNumber, AIRFLOW_CONFIG.NOTES_COLUMN);

  backupStatusFormulaTemplate_(statusRange);

  statusRange.setValue("ERROR");

  notesRange.setValue(String(error.message || error)).setWrap(true);
}

/**
 * Notes untuk status non-success.
 */
function getNotesForStatus_(result) {
  if (result.notes) {
    return result.notes;
  }

  if (result.status === "RUNNING") {
    return "DAG masih berjalan.";
  }

  if (result.status === "QUEUED") {
    return "DAG masih dalam antrean.";
  }

  if (result.status === "FAILED") {
    return "DAG failed, tetapi failed task " + "tidak ditemukan.";
  }

  return `Current status: ${result.status}`;
}

/**
 * Parse tanggal B2.
 */
function parseSheetDate_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (isNaN(date.getTime())) {
    return null;
  }

  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Parse jam Column E.
 */
function parseSheetTime_(value, timezone) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return parseSheetTime_(
      Utilities.formatDate(
        value,
        timezone || AIRFLOW_CONFIG.TIMEZONE,
        "HH:mm:ss"
      ),
      timezone
    );
  }

  const text = String(value || "").trim();

  const match = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);

  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] || 0);

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59) {
    return null;
  }

  return {
    hours: hours,
    minutes: minutes,
    seconds: seconds,
  };
}

/**
 * Parse ISO timestamp.
 */
function parseIsoDate_(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  return isNaN(date.getTime()) ? null : date;
}

/**
 * Tulis waktu ke typed Time column.
 */
function writeAirflowTime_(range, value) {
  const date = parseIsoDate_(value);

  if (!date) {
    range.clearContent();
    return;
  }

  range.setValue(date);
}

/**
 * Format timestamp lengkap.
 */
function formatDateTime_(value, timezone) {
  const date = parseIsoDate_(value);

  if (!date) {
    return "";
  }

  return Utilities.formatDate(date, timezone, "yyyy-MM-dd HH:mm:ss");
}

/**
 * Format Airflow sampai menit.
 */
function formatAirflowMinute_(value, timezone) {
  const date = parseIsoDate_(value);

  if (!date) {
    return "";
  }

  return Utilities.formatDate(date, timezone, "yyyy-MM-dd HH:mm");
}

/**
 * Format Date object.
 */
function formatDateTimeObject_(date, timezone) {
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    return "";
  }

  return Utilities.formatDate(date, timezone, "yyyy-MM-dd HH:mm");
}

/**
 * Membuat satu template formula Column L.
 *
 * Property:
 * STATUS_FORMULA_R1C1_Airflow
 */
function initializeStatusFormulaTemplate_(sheet) {
  const propertyKey = getStatusFormulaTemplateKey_(sheet.getName());

  const properties = PropertiesService.getScriptProperties();

  if (properties.getProperty(propertyKey)) {
    return;
  }

  const lastRow = sheet.getLastRow();

  for (let rowNumber = AIRFLOW_CONFIG.FIRST_DATA_ROW; rowNumber <= lastRow; rowNumber++) {
    const range = sheet.getRange(rowNumber, AIRFLOW_CONFIG.STATUS_COLUMN);

    const formulaR1C1 = range.getFormulaR1C1();

    if (formulaR1C1) {
      properties.setProperty(propertyKey, formulaR1C1);

      console.log(`Formula template Column L ` + `disimpan dari row ${rowNumber}.`);

      return;
    }
  }

  console.log("Formula template Column L tidak ditemukan.");
}

/**
 * Backup satu template formula R1C1.
 *
 * Tidak lagi menyimpan formula per row.
 */
function backupStatusFormulaTemplate_(statusRange) {
  const formulaR1C1 = statusRange.getFormulaR1C1();

  if (!formulaR1C1) {
    return;
  }

  const propertyKey = getStatusFormulaTemplateKey_(statusRange.getSheet().getName());

  const properties = PropertiesService.getScriptProperties();

  if (!properties.getProperty(propertyKey)) {
    properties.setProperty(propertyKey, formulaR1C1);
  }
}

/**
 * Restore formula Column L berdasarkan template R1C1.
 */
function restoreStatusFormula_(statusRange) {
  if (statusRange.getFormulaR1C1()) {
    return;
  }

  const propertyKey = getStatusFormulaTemplateKey_(statusRange.getSheet().getName());

  const properties = PropertiesService.getScriptProperties();

  let formulaR1C1 = properties.getProperty(propertyKey);

  /*
   * Fallback mencari formula dari row lain.
   */
  if (!formulaR1C1) {
    const sheet = statusRange.getSheet();

    const currentRow = statusRange.getRow();

    const lastRow = sheet.getLastRow();

    for (let rowNumber = AIRFLOW_CONFIG.FIRST_DATA_ROW; rowNumber <= lastRow; rowNumber++) {
      if (rowNumber === currentRow) {
        continue;
      }

      const sourceRange = sheet.getRange(rowNumber, AIRFLOW_CONFIG.STATUS_COLUMN);

      const sourceFormula = sourceRange.getFormulaR1C1();

      if (sourceFormula) {
        formulaR1C1 = sourceFormula;

        properties.setProperty(propertyKey, formulaR1C1);

        break;
      }
    }
  }

  if (formulaR1C1) {
    statusRange.setFormulaR1C1(formulaR1C1);
  } else {
    console.log(
      `Formula template Column L ` + `tidak ditemukan untuk row ` + `${statusRange.getRow()}.`,
    );
  }
}

/**
 * Property key template formula.
 *
 * Hanya satu property per sheet.
 */
function getStatusFormulaTemplateKey_(sheetName) {
  const safeSheetName = String(sheetName).replace(/[^a-zA-Z0-9_-]/g, "_");

  return `STATUS_FORMULA_R1C1_` + `${safeSheetName}`;
}

/**
 * Entry point manual untuk membersihkan formula property yang sudah lewat.
 */
function cleanupOldStatusFormulaProperties() {
  const properties = PropertiesService.getScriptProperties();
  const dailyFileId = getRequiredProperty_(properties, "DAILY_FILE_ID");
  return cleanupStatusFormulaProperties_(
    SpreadsheetApp.openById(dailyFileId)
  );
}

function cleanupStatusFormulaProperties_(spreadsheet) {
  const properties = PropertiesService.getScriptProperties();
  const allProperties = properties.getProperties();
  const activeFormulaKeys = new Set(
    spreadsheet.getSheets()
      .filter((sheet) => /^Monitoring Airflow \d{8}$/.test(sheet.getName()))
      .map((sheet) => getStatusFormulaTemplateKey_(sheet.getName()))
  );
  const deletedKeys = [];

  Object.keys(allProperties).forEach((key) => {
    const isOldRowFormula = /^STATUS_FORMULA_.+_ROW_\d+$/.test(key);
    const isDatedAirflowFormula =
      /^STATUS_FORMULA_R1C1_Monitoring_Airflow_\d{8}$/.test(key);
    const isExpiredDatedFormula =
      isDatedAirflowFormula && !activeFormulaKeys.has(key);

    if (isOldRowFormula || isExpiredDatedFormula) {
      properties.deleteProperty(key);
      deletedKeys.push(key);
    }
  });

  deletedKeys.forEach((key) => {
    console.log("[Airflow] Deleted formula property: " + key);
  });

  return {
    deletedCount: deletedKeys.length,
    deletedKeys: deletedKeys
  };
}

/**
 * Menampilkan seluruh Script Properties.
 *
 * Hati-hati: log dapat menampilkan konfigurasi.
 * Jangan gunakan jika ada private secret.
 */
function listScriptPropertyKeys() {
  const properties = PropertiesService.getScriptProperties().getProperties();

  const keys = Object.keys(properties).sort();

  console.log(`Total Script Properties: ${keys.length}`);

  keys.forEach((key) => {
    console.log(key);
  });
}

/**
 * Ambil required Script Property.
 */
function getRequiredProperty_(properties, propertyName) {
  const value = properties.getProperty(propertyName);

  if (!value) {
    throw new Error(`Script Property ` + `${propertyName} belum diisi.`);
  }

  return value;
}

function debugAirflowAuth() {
  const properties = PropertiesService.getScriptProperties();

  const airflowBaseUrl = properties.getProperty("AIRFLOW_BASE_URL")?.replace(/\/+$/, "");

  if (!airflowBaseUrl) {
    throw new Error("AIRFLOW_BASE_URL belum diisi.");
  }

  const token = ScriptApp.getOAuthToken();

  console.log(`Effective user: ${Session.getEffectiveUser().getEmail()}`);

  console.log(`Active user: ${Session.getActiveUser().getEmail()}`);

  const url = `${airflowBaseUrl}/api/v1/health`;

  const response = UrlFetchApp.fetch(url, {
    method: "get",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    muteHttpExceptions: true,
    followRedirects: true,
  });

  console.log(`HTTP Status: ${response.getResponseCode()}`);

  console.log(`Response: ${response.getContentText()}`);
}
