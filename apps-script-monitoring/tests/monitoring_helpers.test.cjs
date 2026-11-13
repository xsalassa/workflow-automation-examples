const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const context = vm.createContext({
  Session: { getScriptTimeZone: () => 'Asia/Jakarta' },
  Utilities: { formatDate: (date, zone, pattern) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(date);
    const value = type => parts.find(p => p.type === type).value;
    if (pattern === 'yyyy-MM-dd') return `${value('year')}-${value('month')}-${value('day')}`;
    throw Error('Unexpected test date pattern: ' + pattern);
  } },
});
for (const name of fs.readdirSync(root).filter(n => n.endsWith('.gs'))) {
  new vm.Script(fs.readFileSync(path.join(root, name), 'utf8'), { filename: name }).runInContext(context);
}
const run = expression => vm.runInContext(expression, context);

test('calendar distinguishes weekdays, weekends and public holidays', () => {
  assert.equal(run('getCalendarDayType_(new Date(2026,10,16),new Set(),"Asia/Jakarta")'), 'WEEKDAY');
  assert.equal(run('getCalendarDayType_(new Date(2026,10,14),new Set(),"Asia/Jakarta")'), 'WEEKEND');
  assert.equal(run('getCalendarDayType_(new Date(2026,10,16),new Set(["2026-11-16"]),"Asia/Jakarta")'), 'PUBLIC_HOLIDAY');
  assert.equal(run('getCalendarDayType_(new Date(2026,10,14),new Set(["2026-11-14"]),"Asia/Jakarta")'), 'PUBLIC_HOLIDAY_WEEKEND');
});
test('long holiday joins adjacent nonworking dates and finds the next workday', () => {
  assert.equal(run('getMonitoringType_(new Date(2026,10,14),new Set(["2026-11-13"]),"Asia/Jakarta")'), 'Long Holiday');
  assert.equal(run('getMonitoringType_(new Date(2026,10,14),new Set(),"Asia/Jakarta")'), 'Weekend');
  assert.equal(run('formatProjectDate_(findNextWorkingDate_(new Date(2026,10,14),new Set(["2026-11-16"]),"Asia/Jakarta"),"Asia/Jakarta")'), '2026-11-17');
});
test('recipient parser accepts generic addresses and removes empty entries', () => {
  assert.equal(JSON.stringify(run('parseDelayEmailRecipients_(" reports@example.com, ,owner@example.com ")')), JSON.stringify(['reports@example.com','owner@example.com']));
  assert.equal(run('parseDelayEmailRecipients_(null).length'), 0);
});
test('Databricks success/failure subjects retain all supported dash variants', () => {
  for (const dash of ['-', '\u2013', '\u2014']) {
    for (const [subject, status] of [['Success', 'OK'], ['Failed', 'FAILED']]) {
      context.syntheticMessage = {
        getSubject: () => `${subject} ${dash} view run 123456`,
        getPlainBody: () => 'example-workspace\njob_example_daily\nStarted at: 2026-11-13 01:00:00 UTC\nDuration: 1m 2s',
        getDate: () => new Date('2026-11-13T01:02:00Z'),
      };
      const result = run('parseDcpDatabricksEmail_(syntheticMessage,"job_example_daily")');
      assert.ok(result, JSON.stringify({subject,dash}));
      assert.equal(result.status, status);
      assert.equal(result.endedAt-result.startedAt, 62000);
    }
  }
});
test('HTML includes and manifest macros resolve to copied source files/functions', () => {
  const source = fs.readdirSync(root).filter(n => n.endsWith('.gs')).map(n => fs.readFileSync(path.join(root,n),'utf8')).join('\n');
  for (const match of source.matchAll(/createHtmlOutputFromFile\(["']([^"']+)["']\)/g)) {
    assert.ok(fs.existsSync(path.join(root, match[1]+'.html')), match[1]);
  }
  for (const macro of JSON.parse(fs.readFileSync(path.join(root,'appsscript.json'),'utf8')).sheets.macros) {
    assert.equal(run('typeof '+macro.functionName), 'function', macro.functionName);
  }
});
