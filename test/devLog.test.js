const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  appendFinish,
  appendStart,
  ensureDailyLog,
  formatDate,
  getLogPath
} = require('../scripts/dev-log');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'alive-dev-log-'));
}

test('development log uses Asia/Kuala_Lumpur date', () => {
  const nearUtcMidnight = new Date('2026-06-03T18:00:00.000Z');
  assert.equal(formatDate(nearUtcMidnight), '2026-06-04');
});

test('dev:start creates a daily log and safely appends sessions', () => {
  const cwd = makeTempDir();
  const date = new Date('2026-06-04T09:00:00.000Z');

  const logPath = appendStart(cwd, date);
  appendStart(cwd, date);

  const content = fs.readFileSync(logPath, 'utf8');
  assert.equal(logPath, getLogPath(cwd, date));
  assert.match(content, /今日目标 \/ Objectives/);
  assert.equal((content.match(/- 开发会话已开始。/g) || []).length, 2);
});

test('dev:finish records branch, commit, changes, and failed tests', () => {
  const cwd = makeTempDir();
  const date = new Date('2026-06-04T10:00:00.000Z');

  ensureDailyLog(cwd, date);
  const logPath = appendFinish(
    cwd,
    {
      branch: 'codex/project-governance',
      commit: 'abc1234',
      changedFiles: ' M package.json',
      testsPassed: false
    },
    date
  );

  const content = fs.readFileSync(logPath, 'utf8');
  assert.match(content, /codex\/project-governance/);
  assert.match(content, /abc1234/);
  assert.match(content, /失败 \/ Failed/);
  assert.match(content, /M package\.json/);
});
