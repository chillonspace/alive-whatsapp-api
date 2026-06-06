const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { loadEnv, SHARED_ALIVE_ENV_PATH } = require('../src/config/env');

function withCleanClientApiKey(fn) {
  const previous = process.env.CLIENT_API_KEY;
  delete process.env.CLIENT_API_KEY;

  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (previous === undefined) {
        delete process.env.CLIENT_API_KEY;
      } else {
        process.env.CLIENT_API_KEY = previous;
      }
    });
}

test('shared Alive env path points to the cross-project env file', () => {
  assert.equal(SHARED_ALIVE_ENV_PATH, '/Users/chillon/Documents/Codex/shared/alive.env');
});

test('loadEnv reads CLIENT_API_KEY from the shared Alive env file', async () => {
  await withCleanClientApiKey(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alive-env-'));
    const sharedEnvPath = path.join(dir, 'alive.env');

    try {
      fs.writeFileSync(sharedEnvPath, 'CLIENT_API_KEY=shared-test-key\n', 'utf8');

      loadEnv({ sharedEnvPath, localEnvPath: path.join(dir, '.env') });

      assert.equal(process.env.CLIENT_API_KEY, 'shared-test-key');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('loadEnv keeps shared CLIENT_API_KEY when local .env also defines one', async () => {
  await withCleanClientApiKey(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alive-env-'));
    const sharedEnvPath = path.join(dir, 'alive.env');
    const localEnvPath = path.join(dir, '.env');

    try {
      fs.writeFileSync(sharedEnvPath, 'CLIENT_API_KEY=shared-test-key\n', 'utf8');
      fs.writeFileSync(localEnvPath, 'CLIENT_API_KEY=local-test-key\n', 'utf8');

      loadEnv({ sharedEnvPath, localEnvPath });

      assert.equal(process.env.CLIENT_API_KEY, 'shared-test-key');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
