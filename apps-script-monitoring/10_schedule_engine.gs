const SCHEDULE_ENGINE_CONFIG = {
  scheduleSheetName: "Schedule",
  employeeSheetName: "Employees",
  holidaySheetName: "Holiday",
  daysToGenerate: 30,
  headers: ["Date", "Monitoring_1", "Monitoring_2", "Day_Name"],
  nonWorkingHeaders: ["Jenis Monitoring", "Tanggal Monitoring", "PIC"]
};

function generateSchedule() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    throw new Error("Schedule generation is already running");
  }

  const startedAt = new Date();
  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const result = generateScheduleForSpreadsheet_(spreadsheet);
    recordRunHistory_(
      spreadsheet,
      "generateSchedule",
      startedAt,
      new Date(),
      "SUCCESS",
      JSON.stringify(result)
    );
    return result;
  } catch (error) {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    recordRunHistory_(
      spreadsheet,
      "generateSchedule",
      startedAt,
      new Date(),
      "ERROR",
      error.message
    );
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function generateScheduleForSpreadsheet_(spreadsheet) {
  const validation = validateTemplate_(spreadsheet, {
    includeFormulaCheck: false,
    throwOnError: true
  });
  const employees = getEmployees_(spreadsheet);
  if (employees.length < 2) {
    throw new Error("Employees membutuhkan minimal dua employee valid");
  }

  const scheduleSheet = spreadsheet.getSheetByName(
    SCHEDULE_ENGINE_CONFIG.scheduleSheetName
  );
  const timeZone = spreadsheet.getSpreadsheetTimeZone();
  const holidays = getHolidayDateSet_(spreadsheet, timeZone);
  const existingRows = getScheduleRows_(scheduleSheet);
  const today = startOfDay_(new Date());
  const anchor = getScheduleAnchor_(
    existingRows,
    today,
    holidays,
    timeZone
  );
  const seed = getScheduleSeed_(
    existingRows,
    today,
    holidays,
    timeZone
  );
  const useSeed = Boolean(
    seed && (
      seed.date.getTime() === today.getTime() ||
      (
        !anchor.fromSchedule &&
        hasOnlyNonWorkingDatesBefore_(
          today,
          seed.date,
          holidays,
          timeZone
        )
      )
    )
  );
  const preservedRows = existingRows
    .filter(row => startOfDay_(row[0]).getTime() < today.getTime())
    .sort((left, right) => left[0].getTime() - right[0].getTime());
  const generatedWeekdayRows = useSeed
    ? [
      [
        new Date(seed.date.getTime()),
        seed.monitoring1,
        seed.monitoring2,
        Utilities.formatDate(seed.date, timeZone, "EEEE")
      ]
    ].concat(buildScheduleRows_(
      employees.map(item => item.name),
      holidays,
      seed,
      seed.date,
      timeZone,
      SCHEDULE_ENGINE_CONFIG.daysToGenerate - 1
    ))
    : buildScheduleRows_(
      employees.map(item => item.name),
      holidays,
      anchor,
      today,
      timeZone,
      SCHEDULE_ENGINE_CONFIG.daysToGenerate
    );
  const generatedRows = expandScheduleCalendarRows_(
    generatedWeekdayRows,
    today,
    holidays,
    timeZone
  );

  const rowsToClear = Math.max(scheduleSheet.getMaxRows() - 1, 0);
  if (rowsToClear > 0) {
    scheduleSheet.getRange(2, 1, rowsToClear, 4).clearContent();
    scheduleSheet.getRange(2, 6, rowsToClear, 3).clearContent();
  }
  const outputRows = preservedRows.concat(generatedRows);
  scheduleSheet.getRange(1, 1, 1, 4)
    .setValues([SCHEDULE_ENGINE_CONFIG.headers]);
  scheduleSheet.getRange(1, 6, 1, 3)
    .setValues([SCHEDULE_ENGINE_CONFIG.nonWorkingHeaders]);
  if (outputRows.length) {
    scheduleSheet.getRange(2, 1, outputRows.length, 4).setValues(outputRows);
    scheduleSheet.getRange(2, 1, outputRows.length, 1)
      .setNumberFormat("yyyy-MM-dd");
  }
  const nonWorkingRows = buildNonWorkingRosterRows_(
    generatedRows,
    holidays,
    timeZone
  );
  if (nonWorkingRows.length) {
    scheduleSheet.getRange(2, 6, nonWorkingRows.length, 3)
      .setValues(nonWorkingRows);
    scheduleSheet.getRange(2, 7, nonWorkingRows.length, 1)
      .setNumberFormat("yyyy-MM-dd");
  }

  return {
    rowsGenerated: generatedRows.length,
    weekdayRowsGenerated: generatedWeekdayRows.length,
    nonWorkingRowsGenerated: nonWorkingRows.length,
    historicalRowsPreserved: preservedRows.length,
    anchorDate: formatProjectDate_(anchor.date, timeZone),
    anchorMonitoring1: anchor.monitoring1,
    anchorMonitoring2: anchor.monitoring2,
    preservedSeedDate: useSeed
      ? formatProjectDate_(seed.date, timeZone)
      : "",
    firstDate: generatedRows.length
      ? formatProjectDate_(generatedRows[0][0], timeZone)
      : "",
    lastDate: generatedRows.length
      ? formatProjectDate_(
        generatedRows[generatedRows.length - 1][0],
        timeZone
      )
      : "",
    employeeCount: employees.length,
    templateWarnings: validation.warnings
  };
}

function getScheduleRows_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, 4).getValues()
    .filter(row => row[0] instanceof Date && !isNaN(row[0].getTime()));
}

function getScheduleAnchor_(rows, today, holidayDates, timeZone) {
  const eligible = rows
    .filter(row => {
      const rowDate = startOfDay_(row[0]);
      if (rowDate.getTime() >= today.getTime()) return false;
      if (!holidayDates || !timeZone) return true;
      return !isProjectNonWorkingDate_(rowDate, holidayDates, timeZone);
    })
    .sort((left, right) => right[0].getTime() - left[0].getTime());

  if (!eligible.length) {
    return {
      date: new Date(today.getTime() - 86400000),
      monitoring1: "",
      monitoring2: "",
      fromSchedule: false
    };
  }

  return {
    date: startOfDay_(eligible[0][0]),
    monitoring1: String(eligible[0][1] || "").trim(),
    monitoring2: String(eligible[0][2] || "").trim(),
    fromSchedule: true
  };
}

function getScheduleSeed_(rows, today, holidayDates, timeZone) {
  const eligible = rows
    .filter(row => {
      const rowDate = startOfDay_(row[0]);
      return (
        rowDate.getTime() >= today.getTime() &&
        !isProjectNonWorkingDate_(rowDate, holidayDates, timeZone) &&
        String(row[1] || "").trim() &&
        String(row[2] || "").trim()
      );
    })
    .sort((left, right) => left[0].getTime() - right[0].getTime());
  if (!eligible.length) return null;
  return {
    date: startOfDay_(eligible[0][0]),
    monitoring1: String(eligible[0][1] || "").trim(),
    monitoring2: String(eligible[0][2] || "").trim()
  };
}

function hasOnlyNonWorkingDatesBefore_(
  firstDate,
  lastDate,
  holidayDates,
  timeZone
) {
  const cursor = startOfDay_(firstDate);
  const boundary = startOfDay_(lastDate);
  while (cursor.getTime() < boundary.getTime()) {
    if (!isProjectNonWorkingDate_(cursor, holidayDates, timeZone)) {
      return false;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return true;
}

function expandScheduleCalendarRows_(
  weekdayRows,
  firstDate,
  holidayDates,
  timeZone
) {
  if (!weekdayRows.length) return [];
  const weekdayByDate = {};
  weekdayRows.forEach(row => {
    weekdayByDate[formatProjectDate_(row[0], timeZone)] = row;
  });

  const result = [];
  const cursor = startOfDay_(firstDate);
  const lastDate = startOfDay_(weekdayRows[weekdayRows.length - 1][0]);

  while (cursor.getTime() <= lastDate.getTime()) {
    const dateKey = formatProjectDate_(cursor, timeZone);
    if (!isProjectNonWorkingDate_(cursor, holidayDates, timeZone)) {
      const weekdayRow = weekdayByDate[dateKey];
      if (!weekdayRow) {
        throw new Error("Assignment weekday tidak ditemukan: " + dateKey);
      }
      result.push(weekdayRow);
    } else {
      const sourceDate = findNextWorkingDate_(
        cursor,
        holidayDates,
        timeZone
      );
      const sourceKey = formatProjectDate_(sourceDate, timeZone);
      const sourceRow = weekdayByDate[sourceKey];
      if (!sourceRow) {
        throw new Error(
          "Assignment hari kerja berikutnya tidak ditemukan: " + sourceKey
        );
      }
      const monitoring1 = String(sourceRow[1] || "").trim();
      if (!monitoring1) {
        throw new Error("Monitoring 1 kosong pada " + sourceKey);
      }
      result.push([
        new Date(cursor.getTime()),
        monitoring1,
        monitoring1,
        Utilities.formatDate(cursor, timeZone, "EEEE")
      ]);
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}

function buildNonWorkingRosterRows_(calendarRows, holidayDates, timeZone) {
  return calendarRows
    .filter(row =>
      isProjectNonWorkingDate_(row[0], holidayDates, timeZone)
    )
    .map(row => [
      getMonitoringType_(row[0], holidayDates, timeZone),
      new Date(row[0].getTime()),
      String(row[1] || "").trim()
    ]);
}

function buildScheduleRows_(
  employees,
  holidays,
  anchor,
  today,
  timeZone,
  numberOfDays
) {
  const rows = [];
  let currentDate = new Date(Math.max(anchor.date.getTime(), today.getTime() - 86400000));
  let firstIndex = employees.indexOf(anchor.monitoring1);
  if (firstIndex < 0) firstIndex = 0;

  while (rows.length < numberOfDays) {
    currentDate = new Date(currentDate.getTime());
    currentDate.setDate(currentDate.getDate() + 1);
    currentDate = startOfDay_(currentDate);

    const dateKey = formatProjectDate_(currentDate, timeZone);
    const day = currentDate.getDay();
    if (day === 0 || day === 6 || holidays.has(dateKey)) continue;

    if (day === 1 && employees.length % 5 === 0) {
      firstIndex = (firstIndex + 1) % employees.length;
    }

    const secondIndex = firstIndex;
    firstIndex = (firstIndex + 1) % employees.length;
    rows.push([
      new Date(currentDate.getTime()),
      employees[firstIndex],
      employees[secondIndex],
      Utilities.formatDate(currentDate, timeZone, "EEEE")
    ]);
  }

  return rows;
}

function getHolidayDateSet_(spreadsheet, timeZone) {
  const sheet = spreadsheet.getSheetByName(
    SCHEDULE_ENGINE_CONFIG.holidaySheetName
  );
  const dates = new Set();
  if (!sheet || sheet.getLastRow() < 2) return dates;

  sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues()
    .forEach(row => {
      if (row[0] instanceof Date && !isNaN(row[0].getTime())) {
        dates.add(formatProjectDate_(row[0], timeZone));
      }
    });
  return dates;
}

/**
 * Satu definisi hari non-working untuk schedule, daily file, dan monitoring.
 */
function isProjectNonWorkingDate_(value, holidayDates, timeZone) {
  const dateKey = formatProjectDate_(value, timeZone);
  const day = value.getDay();
  return day === 0 || day === 6 || holidayDates.has(dateKey);
}

function startOfDay_(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function formatProjectDate_(value, timeZone) {
  return Utilities.formatDate(value, timeZone, "yyyy-MM-dd");
}
