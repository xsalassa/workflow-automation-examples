const MONITORING_DAY_TYPES = {
  WEEKDAY: "WEEKDAY",
  WEEKEND: "WEEKEND",
  PUBLIC_HOLIDAY: "PUBLIC_HOLIDAY",
  PUBLIC_HOLIDAY_WEEKEND: "PUBLIC_HOLIDAY_WEEKEND"
};

const MONITORING_TYPES = {
  WEEKDAY: "Weekday",
  WEEKEND: "Weekend",
  HOLIDAY: "Holiday",
  LONG_HOLIDAY: "Long Holiday"
};

function getMonitoringDayContext_(spreadsheet, value, timeZone) {
  const zone = timeZone || spreadsheet.getSpreadsheetTimeZone();
  const date = startOfDay_(value);
  const holidays = getHolidayDateSet_(spreadsheet, zone);
  const calendarDayType = getCalendarDayType_(date, holidays, zone);
  const isNonWorking = calendarDayType !== MONITORING_DAY_TYPES.WEEKDAY;
  const monitoringType = getMonitoringType_(date, holidays, zone);
  const assignment = resolveMonitoringAssignment_(
    spreadsheet,
    date,
    holidays,
    zone
  );

  return {
    date: date,
    dateKey: formatProjectDate_(date, zone),
    dateCompact: Utilities.formatDate(date, zone, "yyyyMMdd"),
    dayName: Utilities.formatDate(date, zone, "EEEE"),
    calendarDayType: calendarDayType,
    dayTypeDisplay: getMonitoringDayTypeDisplay_(calendarDayType),
    monitoringType: monitoringType,
    isNonWorking: isNonWorking,
    assignmentSourceDate: assignment.sourceDateKey,
    monitoring1: assignment.monitoring1,
    monitoring2: assignment.monitoring2,
    dcpCheckingTime: isNonWorking ? "09:00" : "08:00",
    dcpAutomationHour: isNonWorking ? 8 : 7,
    opsProfile: isNonWorking ? "WEEKEND" : "WEEKDAY",
    airflowWindows: isNonWorking
      ? ["09:00", "13:30", "17:00"]
      : ["09:00", "11:00", "14:00", "17:00"],
    looker1400: "RUN",
    looker1600: isNonWorking ? "SKIPPED_NOT_APPLICABLE" : "RUN"
  };
}

function getCalendarDayType_(value, holidayDates, timeZone) {
  const date = startOfDay_(value);
  const dateKey = formatProjectDate_(date, timeZone);
  const isWeekend = date.getDay() === 0 || date.getDay() === 6;
  const isHoliday = holidayDates.has(dateKey);

  if (isWeekend && isHoliday) {
    return MONITORING_DAY_TYPES.PUBLIC_HOLIDAY_WEEKEND;
  }
  if (isHoliday) return MONITORING_DAY_TYPES.PUBLIC_HOLIDAY;
  if (isWeekend) return MONITORING_DAY_TYPES.WEEKEND;
  return MONITORING_DAY_TYPES.WEEKDAY;
}

function getMonitoringDayTypeDisplay_(calendarDayType) {
  if (calendarDayType === MONITORING_DAY_TYPES.PUBLIC_HOLIDAY_WEEKEND) {
    return "PUBLIC HOLIDAY (WEEKEND)";
  }
  if (calendarDayType === MONITORING_DAY_TYPES.PUBLIC_HOLIDAY) {
    return "PUBLIC HOLIDAY";
  }
  return calendarDayType;
}

function getMonitoringType_(value, holidayDates, timeZone) {
  const date = startOfDay_(value);
  const calendarDayType = getCalendarDayType_(date, holidayDates, timeZone);
  if (calendarDayType === MONITORING_DAY_TYPES.WEEKDAY) {
    return MONITORING_TYPES.WEEKDAY;
  }

  const run = getNonWorkingDateRun_(date, holidayDates, timeZone);
  if (run.length >= 3) return MONITORING_TYPES.LONG_HOLIDAY;
  if (
    calendarDayType === MONITORING_DAY_TYPES.PUBLIC_HOLIDAY ||
    calendarDayType === MONITORING_DAY_TYPES.PUBLIC_HOLIDAY_WEEKEND
  ) {
    return MONITORING_TYPES.HOLIDAY;
  }
  return MONITORING_TYPES.WEEKEND;
}

function getNonWorkingDateRun_(value, holidayDates, timeZone) {
  const target = startOfDay_(value);
  if (!isProjectNonWorkingDate_(target, holidayDates, timeZone)) return [];

  const dates = [target];
  const before = new Date(target.getTime());
  const after = new Date(target.getTime());

  for (let offset = 0; offset < 366; offset += 1) {
    before.setDate(before.getDate() - 1);
    if (!isProjectNonWorkingDate_(before, holidayDates, timeZone)) break;
    dates.unshift(new Date(before.getTime()));
  }
  for (let offset = 0; offset < 366; offset += 1) {
    after.setDate(after.getDate() + 1);
    if (!isProjectNonWorkingDate_(after, holidayDates, timeZone)) break;
    dates.push(new Date(after.getTime()));
  }
  return dates;
}

function findNextWorkingDate_(value, holidayDates, timeZone) {
  const candidate = startOfDay_(value);
  for (let offset = 0; offset < 366; offset += 1) {
    candidate.setDate(candidate.getDate() + 1);
    if (!isProjectNonWorkingDate_(candidate, holidayDates, timeZone)) {
      return new Date(candidate.getTime());
    }
  }
  throw new Error("Hari kerja berikutnya tidak ditemukan dalam 366 hari");
}

function resolveMonitoringAssignment_(
  spreadsheet,
  value,
  holidayDates,
  timeZone
) {
  const date = startOfDay_(value);
  const schedule = spreadsheet.getSheetByName(PROJECT_SHEETS.SCHEDULE);
  if (!schedule || schedule.getLastRow() < 2) {
    throw new Error("Schedule belum memiliki data assignment");
  }

  const rows = schedule.getRange(2, 1, schedule.getLastRow() - 1, 4)
    .getValues()
    .filter(row => row[0] instanceof Date && !isNaN(row[0].getTime()));
  const employeeNames = getEmployeeNamesById_(spreadsheet);
  const isNonWorking = isProjectNonWorkingDate_(
    date,
    holidayDates,
    timeZone
  );
  const sourceDate = isNonWorking
    ? findNextWorkingDate_(date, holidayDates, timeZone)
    : date;
  const sourceDateKey = formatProjectDate_(sourceDate, timeZone);
  const sourceRow = rows.find(row =>
    formatProjectDate_(row[0], timeZone) === sourceDateKey
  );

  if (!sourceRow) {
    throw new Error(
      "Assignment Schedule tidak ditemukan untuk " + sourceDateKey +
      ". Jalankan Generate Schedule."
    );
  }

  const firstRaw = String(sourceRow[1] || "").trim();
  const secondRaw = String(sourceRow[2] || "").trim();
  const firstName = employeeNames[firstRaw] || firstRaw;
  const secondName = employeeNames[secondRaw] || secondRaw;
  if (!firstName) {
    throw new Error("Monitoring 1 kosong pada Schedule " + sourceDateKey);
  }
  if (!isNonWorking && !secondName) {
    throw new Error("Monitoring 2 kosong pada Schedule " + sourceDateKey);
  }

  return {
    sourceDate: sourceDate,
    sourceDateKey: sourceDateKey,
    monitoring1: firstName,
    monitoring2: isNonWorking ? firstName : secondName
  };
}

function getRuntimeMonitoringContext_() {
  const config = getConfig();
  const template = SpreadsheetApp.openById(config.templateId);
  return getMonitoringDayContext_(template, new Date(), config.timeZone);
}
