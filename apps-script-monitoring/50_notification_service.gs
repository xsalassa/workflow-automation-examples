function sendExampleCompanyDelayNotification() {
  const properties = PropertiesService.getScriptProperties();
  const recipients = parseDelayEmailRecipients_(
    properties.getProperty("DELAY_EMAIL_TO")
  );
  const ccRecipients = parseDelayEmailRecipients_(
    properties.getProperty("DELAY_EMAIL_CC")
  );

  if (!recipients.length) {
    throw new Error("Script Property DELAY_EMAIL_TO belum diisi");
  }

  const date = Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone(),
    "yyyy/MM/dd"
  );
  const subject =
    "Informasi keterlambatan proses pengiriman report ExampleCompany (" +
    date + ")";
  const plainBody = [
    "Yth Tim ExampleCompany,",
    "",
    "Kami informasikan bahwa hari ini terdapat keterlambatan pada " +
      "pemrosesan data ExampleCompany H-1 di Datawarehouse BigQuery.",
    "Oleh karena itu beberapa report harian dari Looker " +
      "(noreply@example.com) dan reports@example.com untuk " +
      "data H-1 belum terkirim / tidak lengkap.",
    "",
    "Kami akan kirim ulang untuk report yang terkait setelah proses selesai.",
    "",
    "Demikian informasi ini kami sampaikan.",
    "Mohon maaf atas keterlambatan ini.",
    "",
    "Terima kasih"
  ].join("\n");
  const htmlBody = [
    "<p>Yth Tim ExampleCompany,</p>",
    "<p>Kami informasikan bahwa hari ini terdapat keterlambatan pada " +
      "pemrosesan data ExampleCompany H-1 di Datawarehouse BigQuery.<br>" +
      "Oleh karena itu beberapa report harian dari Looker " +
      "(noreply@example.com) dan reports@example.com untuk " +
      "data H-1 belum terkirim / tidak lengkap.</p>",
    "<p>Kami akan kirim ulang untuk report yang terkait setelah proses selesai.</p>",
    "<p>Demikian informasi ini kami sampaikan.<br>" +
      "Mohon maaf atas keterlambatan ini.</p>",
    "<p>Terima kasih</p>"
  ].join("");
  const message = {
    to: recipients.join(","),
    subject: subject,
    body: plainBody,
    htmlBody: htmlBody
  };

  if (ccRecipients.length) message.cc = ccRecipients.join(",");
  MailApp.sendEmail(message);

  console.log(
    "[Delay Email] SENT date=" + date +
    " toCount=" + recipients.length +
    " ccCount=" + ccRecipients.length
  );

  return {
    status: "SENT",
    date: date,
    toCount: recipients.length,
    ccCount: ccRecipients.length
  };
}

function parseDelayEmailRecipients_(value) {
  return String(value || "")
    .split(",")
    .map(email => email.trim())
    .filter(Boolean);
}
