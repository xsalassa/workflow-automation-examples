const DYNAMIC_SUMMARY_HEADERS = [
  "Report_Date",
  "Checkpoint_Time",
  "Job_OK",
  "No_Schedule",
  "Running",
  "Cancelled",
  "Failed",
  "Pubsub_Status",
  "EXAMPLE_Status",
  "Dashboard_Status",
  "Store_Status",
  "Remaining_File",
  "Copy_Message"
];

function configureDynamicSummary_(spreadsheet, context, logStep) {
  const sheet = spreadsheet.getSheetByName("Summary");
  const airflowSheet = spreadsheet.getSheetByName(
    "Monitoring Airflow " + context.dateCompact
  );
  if (!sheet || !airflowSheet) {
    logStep("Dynamic Summary skipped: Summary/Airflow sheet not found");
    return;
  }

  const checkpoints = context.isNonWorking
    ? [{ hour: 9, minute: 0 }, { hour: 13, minute: 30 }, { hour: 17, minute: 0 }]
    : [{ hour: 9, minute: 0 }, { hour: 11, minute: 0 },
      { hour: 14, minute: 0 }, { hour: 17, minute: 0 }];
  sheet.getRange(
    1,
    1,
    sheet.getMaxRows(),
    sheet.getMaxColumns()
  ).breakApart();
  sheet.getDataRange().clearContent().clearDataValidations();
  sheet.clearConditionalFormatRules();
  sheet.getRange(1, 1, 1, DYNAMIC_SUMMARY_HEADERS.length)
    .setValues([DYNAMIC_SUMMARY_HEADERS])
    .setBackground("#174ea6")
    .setFontColor("#ffffff")
    .setFontWeight("bold");

  const escapedAirflow = airflowSheet.getName().replace(/'/g, "''");
  checkpoints.forEach((checkpoint, index) => {
    const row = index + 2;
    const timeFormula =
      "=TIME(" + checkpoint.hour + "," + checkpoint.minute + ",0)";
    sheet.getRange(row, 1).setFormula("='Ops Checkpoint'!B2");
    sheet.getRange(row, 2).setFormula(timeFormula);
    ["OK", "NO SCHEDULE", "RUNNING", "CANCELLED", "FAILED"]
      .forEach((status, statusIndex) => {
        sheet.getRange(row, statusIndex + 3).setFormula(
          "=COUNTIFS('" + escapedAirflow + "'!K:K,\"" + status +
          "\",'" + escapedAirflow + "'!E:E,\"<=\"&B" + row + ")" +
          "+COUNTIFS('" + escapedAirflow + "'!K:K,\"" + status +
          "\",'" + escapedAirflow + "'!E:E,\">=\"&TIME(18,0,0))"
        );
      });
    setDynamicSummaryOpsFormulas_(
      sheet,
      row,
      checkpoint,
      context
    );
    sheet.getRange(row, 13).setFormula(
      buildDynamicSummaryMessage_(row, checkpoint, context)
    );
  });

  const rowsToClear = Math.max(sheet.getMaxRows() - checkpoints.length - 1, 0);
  if (rowsToClear) {
    sheet.getRange(
      checkpoints.length + 2,
      1,
      rowsToClear,
      DYNAMIC_SUMMARY_HEADERS.length
    ).clearContent();
  }
  sheet.setFrozenRows(1);
  sheet.getRange(2, 1, checkpoints.length, 1).setNumberFormat("yyyy-MM-dd");
  sheet.getRange(2, 2, checkpoints.length, 1).setNumberFormat("HH:mm");
  sheet.getRange(2, 3, checkpoints.length, 5)
    .setHorizontalAlignment("center");
  sheet.getRange(2, 13, checkpoints.length, 1).setWrap(true);
  logStep(
    "Configured dynamic Summary for " + context.opsProfile +
    " checkpoints=" + checkpoints.map(item =>
      String(item.hour).padStart(2, "0") + ":" +
      String(item.minute).padStart(2, "0")
    ).join(",")
  );
}

function setDynamicSummaryOpsFormulas_(
  sheet,
  row,
  checkpoint,
  context
) {
  if (context.isNonWorking) return;
  if (checkpoint.hour === 14) {
    sheet.getRange(row, 8).setFormula(
      "=IF('Ops Checkpoint'!H20=\"\",\"\",'Ops Checkpoint'!H20)"
    );
    sheet.getRange(row, 10).setFormula("='Ops Checkpoint'!H18");
    sheet.getRange(row, 11).setFormula("='Ops Checkpoint'!H19");
  }
  if (checkpoint.hour === 17) {
    sheet.getRange(row, 12).setFormula("='Ops Checkpoint'!H36");
  }
}

function buildDynamicSummaryMessage_(row, checkpoint, context) {
  const pubsubDetail = !context.isNonWorking && checkpoint.hour === 9
    ? (
      "&IF('Ops Checkpoint'!$H$6=\"\",\"\",CHAR(10)&CHAR(10)&" +
      "\"============================\"&CHAR(10)&" +
      "\"Check telegram message Pubsub Subscription alert on group " +
      "EXAMPLE-ETL-OPS\"&CHAR(10)&" +
      "\"example_ingest_subscription < 10000 (\"&" +
      "'Ops Checkpoint'!$H$6&\")\"&CHAR(10)&" +
      "\"example_transform_subscription < 10000 (\"&" +
      "'Ops Checkpoint'!$H$6&\")\"&CHAR(10)&" +
      "\"example_reprocess_subscription < 5000 (\"&" +
      "'Ops Checkpoint'!$H$6&\")\")"
    )
    : "";
  const expectedFailureDetail =
    context.isNonWorking && checkpoint.hour === 17
      ? (
        "&IF(COUNTA('Ops Checkpoint'!$H$15:$I$15)=0,\"\",CHAR(10)&" +
        "CHAR(10)&\"Expected failure detail H15/I15: \"&" +
        "TEXTJOIN(\" / \",TRUE,'Ops Checkpoint'!$H$15:$I$15))"
      )
      : "";
  return (
    '="# Daily Checkpoint "&TEXT($A' + row + ',"yyyy-mm-dd")&' +
    '" - "&TEXT($B' + row + ',"hh:mm AM/PM")&CHAR(10)&CHAR(10)&' +
    '"Job OK : "&$C' + row + '&" Jobs"&CHAR(10)&' +
    '"Job NO SCHED : "&$D' + row + '&" Jobs"&CHAR(10)&' +
    '"Job RUNNING : "&IF($E' + row + '=0,"-",$E' + row +
    '&" Jobs")&CHAR(10)&' +
    '"Job CANCELLED: "&IF($F' + row + '=0,"-",$F' + row +
    '&" Jobs")&CHAR(10)&' +
    '"Job FAILED : "&IF($G' + row + '=0,"-",$G' + row + '&" Jobs")' +
    pubsubDetail +
    '&IF(COUNTA($H' + row + ':$L' + row + ')=0,"",' +
    'CHAR(10)&CHAR(10)&TEXTJOIN(CHAR(10),TRUE,' +
    'IF($H' + row + '="","","Pubsub Status: "&$H' + row + '),' +
    'IF($I' + row + '="","","EXAMPLE Status: "&$I' + row + '),' +
    'IF($J' + row + '="","","Dashboard Status: "&$J' + row + '),' +
    'IF($K' + row + '="","","Store Status: "&$K' + row + '),' +
    'IF($L' + row + '="","","Remaining File: "&$L' + row + ')))' +
    expectedFailureDetail
  );
}
