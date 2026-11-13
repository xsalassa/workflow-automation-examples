/**
 * Fungsi utama untuk mengisi Kolom D dengan siklus PIC Code.
 * - Target: Sheet "Schedule", Kolom A (Tanggal) -> Kolom D (PIC Code).
 * - Sumber PIC: Table "Source" (Named Range) di sheet yang sama.
 * - Aturan: Rotasi (1-10) dengan pergeseran (+1 skip) setiap siklus.
 * - KONDISI KHUSUS: Jika dalam satu siklus (10 hari kerja) terdapat hari libur (weekday),
 * maka pergeseran otomatis (skip) pada siklus tersebut ditiadakan.
 * - Start: 27 Jan 2026 dimulai dengan PIC Code 4.
 */
function legacyIsiSiklusHariKerja() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName = "Schedule";
  const sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    SpreadsheetApp.getUi().alert("Error: Sheet '" + sheetName + "' tidak ditemukan!");
    return;
  }

  // 1. Mengambil Jumlah PIC dari Table "Source"
  const sourceRange = ss.getRangeByName("Source");
  if (!sourceRange) {
    SpreadsheetApp.getUi().alert("Error: Table 'Source' tidak ditemukan.");
    return;
  }

  const sourceValues = sourceRange.getValues();
  let totalPIC = sourceValues.length;

  // Validasi Header: Jika baris pertama bukan angka, kurangi totalPIC
  if (totalPIC > 0 && isNaN(sourceValues[0][0]) && sourceValues[0][0] !== "") {
    totalPIC -= 1;
  }
  if (totalPIC <= 0) {
    SpreadsheetApp.getUi().alert("Error: Table 'Source' tidak memiliki data PIC.");
    return;
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const rangeA = sheet.getRange(2, 1, lastRow - 1, 1);
  const dates = rangeA.getValues();
  const outputD = [];

  // 2. Konfigurasi Awal & Hari Libur
  const prdStartDate = new Date(2026, 0, 27); // 27 Jan 2026
  prdStartDate.setHours(0, 0, 0, 0);

  const holidaySet = getHolidaySetFromSheet_(ss);

  let currentPIC = 4;        // Mulai dari PIC 4
  let workdaysInCycle = 0;   // Menghitung hari kerja aktif dalam siklus
  let hasHolidayInCycle = false; // Flag untuk mendeteksi libur dalam siklus berjalan

  for (let i = 0; i < dates.length; i++) {
    const cellValue = dates[i][0];

    if (cellValue instanceof Date && !isNaN(cellValue)) {
      const scheduleDate = new Date(cellValue);
      scheduleDate.setHours(0, 0, 0, 0);

      // Abaikan tanggal sebelum 27 Jan 2026
      if (scheduleDate.getTime() < prdStartDate.getTime()) {
        outputD.push([""]);
        continue;
      }

      const day = scheduleDate.getDay();
      const isWeekend = (day === 0 || day === 6);

      // Cek apakah tanggal saat ini ada di daftar hari libur
      const dateString = Utilities.formatDate(scheduleDate, ss.getSpreadsheetTimeZone(), "yyyy-MM-dd");
      const isHoliday = holidaySet[dateString] === true;

      if (isWeekend) {
        outputD.push([""]);
      } else if (isHoliday) {
        // Jika hari kerja adalah LIBUR:
        outputD.push([""]);
        hasHolidayInCycle = true; // Tandai bahwa siklus ini ada liburnya
      } else {
        // HARI KERJA AKTIF
        outputD.push([currentPIC]);
        workdaysInCycle++;

        // Siapkan untuk hari kerja berikutnya (+1 normal)
        currentPIC = (currentPIC % totalPIC) + 1;

        /**
         * LOGIKA PERGESERAN (SHIFT) BERSYARAT:
         * Skip terjadi setelah satu siklus penuh selesai, kecuali ada hari libur
         * weekday di dalam siklus tersebut.
         */
        if (workdaysInCycle === totalPIC) {
          if (!hasHolidayInCycle) {
            currentPIC = (currentPIC % totalPIC) + 1;
          }
          workdaysInCycle = 0;
          hasHolidayInCycle = false;
        }
      }
    } else {
      outputD.push([""]);
    }
  }

  // 3. Update Kolom D
  sheet.getRange(2, 4, outputD.length, 1).setValues(outputD);

  SpreadsheetApp.getUi().alert("Selesai! Jadwal diperbarui.\nPergeseran otomatis hanya aktif jika tidak ada hari libur dalam satu siklus.");
}

function getHolidaySetFromSheet_(ss) {
  const holidaySheet = ss.getSheetByName("Holiday");
  const holidaySet = {};
  if (!holidaySheet) return holidaySet;

  holidaySheet.getRange("A2:A").getValues().forEach(row => {
    const value = row[0];
    if (value instanceof Date && !isNaN(value)) {
      holidaySet[Utilities.formatDate(value, ss.getSpreadsheetTimeZone(), "yyyy-MM-dd")] = true;
    }
  });
  return holidaySet;
}
