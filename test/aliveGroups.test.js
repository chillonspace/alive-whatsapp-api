const assert = require('node:assert/strict');
const test = require('node:test');

const { createAliveGroupsRouter } = require('../src/routes/aliveGroups');

async function callAliveGroupsRoute({
  supabase,
  headerApiKey,
  configuredApiKey = 'test-key'
}) {
  const previousApiKey = process.env.CLIENT_API_KEY;
  process.env.CLIENT_API_KEY = configuredApiKey;

  const router = createAliveGroupsRouter({ supabase });
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
    },
    set(name, value) {
      response.headers = response.headers || {};
      response.headers[name] = value;
      return this;
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

function fakeSupabase(row, error = null) {
  return {
    from(table) {
      assert.equal(table, 'alive_group_exports');
      return {
        select(columns) {
          assert.equal(
            columns,
            'response, exported_at, last_attempt_at, last_error_at'
          );
          return {
            eq(column, value) {
              assert.equal(column, 'id');
              assert.equal(value, 'latest');
              return {
                async maybeSingle() {
                  return { data: row, error };
                }
              };
            }
          };
        }
      };
    }
  };
}

test('GET /alive/groups returns the exported JSON when X-API-Key is valid', async () => {
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

  const response = await callAliveGroupsRoute({
    supabase: fakeSupabase({
      response: body,
      exported_at: '2026-06-06T12:00:00.000Z',
      last_attempt_at: '2026-06-06T12:01:00.000Z',
      last_error_at: null
    }),
    headerApiKey: 'test-key'
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, body);
});

test('GET /alive/groups returns 401 when X-API-Key is missing', async () => {
  const response = await callAliveGroupsRoute({
    supabase: fakeSupabase({ response: { status: 'ok', groups: [] } })
  });

  assert.equal(response.status, 401);
  assert.deepEqual(response.body, {
    success: false,
    error: 'Invalid or missing X-API-Key header'
  });
});

test('GET /alive/groups returns 503 when latest export is missing', async () => {
  const response = await callAliveGroupsRoute({
    supabase: fakeSupabase(null),
    headerApiKey: 'test-key'
  });

  assert.equal(response.status, 503);
  assert.deepEqual(response.body, {
    success: false,
    error: 'Alive groups export is not available'
  });
});

test('GET /alive/groups returns last good response with stale headers', async () => {
  const body = {
    exportedAt: '2026-06-06T00:00:00.000Z',
    status: 'ok',
    groups: []
  };
  const response = await callAliveGroupsRoute({
    supabase: fakeSupabase({
      response: body,
      exported_at: '2026-06-06T00:00:00.000Z',
      last_attempt_at: '2026-06-06T12:00:00.000Z',
      last_error_at: '2026-06-06T12:00:00.000Z'
    }),
    headerApiKey: 'test-key'
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, body);
  assert.deepEqual(response.headers, {
    'X-Alive-Groups-Data-Status': 'stale',
    'X-Alive-Groups-Exported-At': '2026-06-06T00:00:00.000Z',
    'X-Alive-Groups-Last-Attempt-At': '2026-06-06T12:00:00.000Z'
  });
});

test('GET /alive/groups returns a safe error when Supabase query fails', async () => {
  const response = await callAliveGroupsRoute({
    supabase: fakeSupabase(null, new Error('permission denied')),
    headerApiKey: 'test-key'
  });

  assert.equal(response.status, 500);
  assert.deepEqual(response.body, {
    success: false,
    error: 'Failed to load Alive groups export'
  });
});
