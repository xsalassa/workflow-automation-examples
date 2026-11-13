const EMPLOYEE_HEADERS = [
  "Employee_ID",
  "Employee_Name",
  "chat_mention"
];

function getEmployees_(spreadsheet) {
  const sheet = spreadsheet.getSheetByName("Employees");
  if (!sheet) throw new Error("Sheet Employees tidak ditemukan");

  assertSheetHeaders_(sheet, EMPLOYEE_HEADERS);
  if (sheet.getLastRow() < 2) return [];

  const seenIds = new Set();
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getDisplayValues()
    .map((row, index) => ({
      id: String(row[0] || "").trim(),
      name: String(row[1] || "").trim(),
      chatMention: String(row[2] || "").trim(),
      rowNumber: index + 2
    }))
    .filter(employee => {
      if (!employee.id && !employee.name && !employee.chatMention) return false;
      if (!employee.id || !employee.name) {
        throw new Error(
          "Employees row " + employee.rowNumber +
          " wajib memiliki Employee_ID dan Employee_Name"
        );
      }
      if (seenIds.has(employee.id)) {
        throw new Error("Employee_ID duplikat: " + employee.id);
      }
      seenIds.add(employee.id);
      return true;
    });
}

function getEmployeeNamesById_(spreadsheet) {
  const names = {};
  const sheet = spreadsheet.getSheetByName("Employees");
  if (!sheet) return names;

  getEmployees_(spreadsheet).forEach(employee => {
    names[employee.id] = employee.name;
    names[employee.name] = employee.name;
  });
  return names;
}

function getEmployeeById_(spreadsheet, employeeId) {
  const id = String(employeeId || "").trim();
  return getEmployees_(spreadsheet)
    .find(employee => employee.id === id) || null;
}
