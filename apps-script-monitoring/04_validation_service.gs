function validateTemplate() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const result = validateTemplate_(spreadsheet, {
    includeFormulaCheck: true,
    throwOnError: false
  });
  return result;
}

function validateTemplate_(spreadsheet, options) {
  const settings = options || {};
  const errors = [];
  const warnings = [];
  const requiredSheets = [
    PROJECT_SHEETS.SCHEDULE,
    PROJECT_SHEETS.EMPLOYEES,
    PROJECT_SHEETS.HOLIDAY,
    PROJECT_SHEETS.OPS_CHECKPOINT,
    PROJECT_SHEETS.OPS_CHECKPOINT_WEEKEND,
    "DCP Checkpoint",
    "Airflow",
    "Monitoring Databricks Jobs",
    "Summary"
  ];

  requiredSheets.forEach(name => {
    if (!spreadsheet.getSheetByName(name)) {
      errors.push("Sheet wajib tidak ditemukan: " + name);
    }
  });

  validateHeadersSafely_(
    spreadsheet,
    PROJECT_SHEETS.SCHEDULE,
    PROJECT_HEADERS.SCHEDULE,
    errors
  );
  validateScheduleNonWorkingHeaders_(spreadsheet, errors, warnings);
  validateWeekendMonitoringTemplate_(spreadsheet, errors);
  validateDcpSemanticGateFormula_(spreadsheet, warnings);
  validateHolidayDates_(spreadsheet, warnings);
  validateHeadersSafely_(
    spreadsheet,
    PROJECT_SHEETS.EMPLOYEES,
    PROJECT_HEADERS.EMPLOYEES,
    errors
  );

  if (spreadsheet.getSheetByName(PROJECT_SHEETS.EMPLOYEES)) {
    try {
      const employees = getEmployees_(spreadsheet);
      if (employees.length < 2) {
        errors.push("Employees membutuhkan minimal dua employee");
      }
      validateScheduleEmployees_(
        spreadsheet,
        new Set(employees.map(employee => employee.id)),
        new Set(employees.map(employee => employee.name)),
        errors
      );
    } catch (error) {
      errors.push(error.message);
    }
  }

  if (settings.includeFormulaCheck !== false) {
    spreadsheet.getSheets().forEach(sheet => {
      const formulas = sheet.getDataRange().getFormulas();
      formulas.forEach((row, rowIndex) => {
        row.forEach((formula, columnIndex) => {
          if (formula && formula.indexOf("#REF!") !== -1) {
            errors.push(
              sheet.getName() + "!" +
              sheet.getRange(rowIndex + 1, columnIndex + 1).getA1Notation() +
              " mengandung #REF!"
            );
          }
        });
      });
    });
  }

  const schedule = spreadsheet.getSheetByName(PROJECT_SHEETS.SCHEDULE);
  if (schedule && schedule.getLastRow() < 2) {
    warnings.push("Schedule belum memiliki data");
  }

  const result = {
    valid: errors.length === 0,
    errors: errors,
    warnings: warnings,
    checkedAt: new Date().toISOString()
  };

  if (!result.valid && settings.throwOnError) {
    throw new Error("Template tidak valid: " + errors.join(" | "));
  }
  return result;
}

function validateHolidayDates_(spreadsheet, warnings) {
  const sheet = spreadsheet.getSheetByName(PROJECT_SHEETS.HOLIDAY);
  if (!sheet || sheet.getLastRow() < 2) return;
  const timeZone = spreadsheet.getSpreadsheetTimeZone();
  const rowCount = sheet.getLastRow() - 1;
  const values = sheet.getRange(2, 1, rowCount, 1).getValues();
  const displays = sheet.getRange(2, 1, rowCount, 1).getDisplayValues();
  const firstRowsByDate = {};
  values.forEach((row, index) => {
    const value = row[0];
    const display = String(displays[index][0] || "").trim();
    if (!display) return;
    if (!(value instanceof Date) || isNaN(value.getTime())) {
      warnings.push(
        "Holiday!A" + (index + 2) + " bukan tanggal valid: " + display
      );
      return;
    }
    const dateKey = formatProjectDate_(value, timeZone);
    if (firstRowsByDate[dateKey]) {
      warnings.push(
        "Tanggal Holiday duplikat " + dateKey + " pada row " +
        firstRowsByDate[dateKey] + " dan " + (index + 2)
      );
      return;
    }
    firstRowsByDate[dateKey] = index + 2;
  });
}

function validateWeekendMonitoringTemplate_(spreadsheet, errors) {
  const sheet = spreadsheet.getSheetByName(
    PROJECT_SHEETS.OPS_CHECKPOINT_WEEKEND
  );
  if (!sheet) return;
  const labels = sheet.getRange(1, 3, sheet.getLastRow(), 1)
    .getDisplayValues()
    .map(row => String(row[0] || "").trim());
  const hasAirflow1330 = labels.some(label =>
    /Monitor\s+Schedule\s+Jobs/i.test(label) &&
    /<\s*13\s*:\s*30/i.test(label)
  );
  if (!hasAirflow1330) {
    errors.push(
      "Ops Checkpoint Weekend tidak memiliki row " +
      "Monitor Schedule Jobs < 13:30"
    );
  }
}

function validateDcpSemanticGateFormula_(spreadsheet, warnings) {
  const sheet = spreadsheet.getSheetByName("DCP Checkpoint");
  if (!sheet) return;
  const formula = String(sheet.getRange("H9").getFormula() || "");
  if (/\bF8\b|\bG8\b/i.test(formula)) {
    warnings.push(
      "DCP Checkpoint!H9 masih memakai F8/G8; daily copy akan " +
      "memperbaikinya menjadi F9/G9"
    );
  }
}

function validateScheduleNonWorkingHeaders_(spreadsheet, errors, warnings) {
  const sheet = spreadsheet.getSheetByName(PROJECT_SHEETS.SCHEDULE);
  if (!sheet) return;
  const actual = sheet.getRange(1, 6, 1, 3).getDisplayValues()[0]
    .map(value => String(value || "").trim());
  const expected = PROJECT_HEADERS.SCHEDULE_NON_WORKING;
  const isEmpty = actual.every(value => !value);
  if (isEmpty) {
    warnings.push(
      "Schedule F:H belum diinisialisasi; Generate Schedule akan membuat header"
    );
    return;
  }
  expected.forEach((header, index) => {
    if (actual[index] !== header) {
      errors.push(
        "Schedule!" + ["F1", "G1", "H1"][index] +
        " harus bernama " + header +
        ", ditemukan " + (actual[index] || "(kosong)")
      );
    }
  });
}

function validateScheduleEmployees_(
  spreadsheet,
  employeeIds,
  employeeNames,
  errors
) {
  const sheet = spreadsheet.getSheetByName(PROJECT_SHEETS.SCHEDULE);
  if (!sheet || sheet.getLastRow() < 2) return;

  sheet.getRange(2, 2, sheet.getLastRow() - 1, 2)
    .getDisplayValues()
    .forEach((row, index) => {
      row.forEach((value, columnIndex) => {
        const id = String(value || "").trim();
        if (id && !employeeIds.has(id) && !employeeNames.has(id)) {
          errors.push(
            sheet.getName() + "!" +
            sheet.getRange(index + 2, columnIndex + 2).getA1Notation() +
            " memakai employee yang tidak ditemukan: " + id
          );
        }
      });
    });
}

function validateHeadersSafely_(spreadsheet, sheetName, expected, errors) {
  const sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) return;
  try {
    assertSheetHeaders_(sheet, expected);
  } catch (error) {
    errors.push(error.message);
  }
}

function assertSheetHeaders_(sheet, expectedHeaders) {
  const actual = sheet.getRange(1, 1, 1, expectedHeaders.length)
    .getDisplayValues()[0]
    .map(value => String(value || "").trim());
  expectedHeaders.forEach((expected, index) => {
    if (actual[index] !== expected) {
      throw new Error(
        sheet.getName() + "!" +
        sheet.getRange(1, index + 1).getA1Notation() +
        " harus bernama " + expected +
        ", ditemukan " + (actual[index] || "(kosong)")
      );
    }
  });
}
