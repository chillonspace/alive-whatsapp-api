const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const TIME_ZONE = 'Asia/Kuala_Lumpur';

function formatDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function formatTime(date = new Date()) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'short'
  }).format(date);
}

function getLogPath(cwd, date = new Date()) {
  return path.join(cwd, 'dev-logs', `${formatDate(date)}.md`);
}

function ensureDailyLog(cwd, date = new Date()) {
  const logPath = getLogPath(cwd, date);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });

  if (!fs.existsSync(logPath)) {
    fs.writeFileSync(
      logPath,
      `# 开发日志 / Development Log - ${formatDate(date)}\n\n` +
        `> 时区 / Timezone: ${TIME_ZONE}\n\n` +
        `## 今日目标 / Objectives\n\n- 待填写 / To be completed\n\n` +
        `## 已完成事项 / Completed Work\n\n- 待填写 / To be completed\n\n` +
        `## 技术决定 / Technical Decisions\n\n- 无 / None\n\n` +
        `## 修改文件 / Changed Files\n\n- 无 / None\n\n` +
        `## 测试结果 / Test Results\n\n- 尚未运行 / Not run yet\n\n` +
        `## 风险与阻塞 / Risks and Blockers\n\n- 无 / None\n\n` +
        `## 待办事项 / Remaining Tasks\n\n- 待填写 / To be completed\n\n` +
        `## 开发会话 / Development Sessions\n\n`
    );
  }

  return logPath;
}

function appendStart(cwd, date = new Date()) {
  const logPath = ensureDailyLog(cwd, date);
  fs.appendFileSync(logPath, `### ${formatTime(date)} - 开始 / Start\n\n- 开发会话已开始。\n\n`);
  return logPath;
}

function runGit(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : 'unavailable';
}

function runTests(cwd) {
  const result = spawnSync(process.execPath, ['--test'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });

  return {
    passed: result.status === 0,
    status: typeof result.status === 'number' ? result.status : 1,
    output: `${result.stdout || ''}${result.stderr || ''}`.trim()
  };
}

function appendFinish(cwd, snapshot, date = new Date()) {
  const logPath = ensureDailyLog(cwd, date);
  const changedFiles = snapshot.changedFiles || 'clean';
  const testLabel = snapshot.testsPassed ? '通过 / Passed' : '失败 / Failed';

  fs.appendFileSync(
    logPath,
    `### ${formatTime(date)} - 结束 / Finish\n\n` +
      `- Branch: \`${snapshot.branch || 'unavailable'}\`\n` +
      `- Commit: \`${snapshot.commit || 'unavailable'}\`\n` +
      `- Tests: **${testLabel}**\n` +
      `- Changed files:\n\n` +
      `\`\`\`text\n${changedFiles}\n\`\`\`\n\n`
  );

  return logPath;
}

function finish(cwd, date = new Date()) {
  const testResult = runTests(cwd);
  const logPath = appendFinish(
    cwd,
    {
      branch: runGit(cwd, ['branch', '--show-current']),
      commit: runGit(cwd, ['rev-parse', '--short', 'HEAD']),
      changedFiles: runGit(cwd, ['status', '--short']),
      testsPassed: testResult.passed
    },
    date
  );

  process.stdout.write(testResult.output ? `${testResult.output}\n` : '');
  console.log(`Development log updated: ${path.relative(cwd, logPath)}`);
  return testResult.status;
}

function main() {
  const action = process.argv[2];
  const cwd = process.cwd();

  if (action === 'start') {
    const logPath = appendStart(cwd);
    console.log(`Development log updated: ${path.relative(cwd, logPath)}`);
    return 0;
  }

  if (action === 'finish') {
    return finish(cwd);
  }

  console.error('Usage: node scripts/dev-log.js <start|finish>');
  return 1;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  TIME_ZONE,
  appendFinish,
  appendStart,
  ensureDailyLog,
  finish,
  formatDate,
  getLogPath,
  runTests
};
