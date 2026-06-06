const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createAliveGroupsRouter, DEFAULT_GROUPS_RESPONSE_PATH } = require('../src/routes/aliveGroups');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'alive-groups-'));
}

async function callAliveGroupsRoute({ responsePath, headerApiKey, configuredApiKey = 'test-key' }) {
  const previousApiKey = process.env.CLIENT_API_KEY;
  process.env.CLIENT_API_KEY = configuredApiKey;

  const router = createAliveGroupsRouter({ responsePath });
  const route = router.stack
    .filter((layer) => layer.route)
    .map((layer) => layer.route)
    .find((item) => item.path === '/alive/groups');
  const req = {
    get(name) {
      return name.toLowerCase() === 'x-api-key' ? headerApiKey : undefined;
    }
  };
  const response = {};
  const res = {
    status(statusCode) {
      response.status = statusCode;
      return this;
    },
    json(body) {
      response.body = body;
      return body;
    }
  };

  try {
    let nextError;
    let nextCalled = false;
    route.stack[0].handle(req, res, (err) => {
      nextCalled = true;
      nextError = err;
    });

    if (nextError) {
      throw nextError;
    }

    if (!nextCalled) {
      return response;
    }

    await route.stack[1].handle(req, res);
    return response;
  } finally {
    if (previousApiKey === undefined) {
      delete process.env.CLIENT_API_KEY;
    } else {
      process.env.CLIENT_API_KEY = previousApiKey;
    }
  }
}

test('alive groups route uses the Group Monitor export path by default', () => {
  assert.equal(
    DEFAULT_GROUPS_RESPONSE_PATH,
    '/Users/chillon/Documents/Alive Group Monitor/private-exports/alive-groups-response.json'
  );
});

test('GET /alive/groups returns the exported JSON when X-API-Key is valid', async () => {
  const dir = makeTempDir();
  const responsePath = path.join(dir, 'alive-groups-response.json');
  const body = {
    exportedAt: '2026-06-06T12:00:00.000Z',
    status: 'ok',
    groups: [
      {
        groupKey: 'alive-sharing',
        groupName: 'ALIVE Sharing Group分享群',
        status: 'ok',
        memberCount: 123,
        unresolvedCount: 0,
        phones: ['60123456789', '886912345678', '6591234567']
      }
    ]
  };
  fs.writeFileSync(responsePath, JSON.stringify(body), 'utf8');

  try {
    const response = await callAliveGroupsRoute({ responsePath, headerApiKey: 'test-key' });

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, body);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('GET /alive/groups returns 401 when X-API-Key is missing', async () => {
  const dir = makeTempDir();
  const responsePath = path.join(dir, 'alive-groups-response.json');
  fs.writeFileSync(responsePath, JSON.stringify({ success: true, groups: [] }), 'utf8');

  try {
    const response = await callAliveGroupsRoute({ responsePath });

    assert.equal(response.status, 401);
    assert.deepEqual(response.body, {
      success: false,
      error: 'Invalid or missing X-API-Key header'
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('GET /alive/groups returns a safe error when export file is missing', async () => {
  const dir = makeTempDir();
  const responsePath = path.join(dir, 'missing.json');

  try {
    const response = await callAliveGroupsRoute({ responsePath, headerApiKey: 'test-key' });

    assert.equal(response.status, 503);
    assert.deepEqual(response.body, {
      success: false,
      error: 'Alive groups export is not available'
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('GET /alive/groups returns a safe error when export JSON is invalid', async () => {
  const dir = makeTempDir();
  const responsePath = path.join(dir, 'alive-groups-response.json');
  fs.writeFileSync(responsePath, '{bad json', 'utf8');

  try {
    const response = await callAliveGroupsRoute({ responsePath, headerApiKey: 'test-key' });

    assert.equal(response.status, 500);
    assert.deepEqual(response.body, {
      success: false,
      error: 'Alive groups export is invalid'
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
