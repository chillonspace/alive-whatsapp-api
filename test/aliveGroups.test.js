const assert = require('node:assert/strict');
const test = require('node:test');

const { createAliveGroupsRouter } = require('../src/routes/aliveGroups');
const { logAliveGroupPullReceipt } = require('../src/services/aliveGroupPullReceiptService');

async function callAliveGroupsRoute({
  supabase,
  logPullReceipt,
  headerApiKey,
  configuredApiKey = 'test-key'
}) {
  const previousApiKey = process.env.CLIENT_API_KEY;
  process.env.CLIENT_API_KEY = configuredApiKey;

  const router = createAliveGroupsRouter({ supabase, logPullReceipt });
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

function fakeSupabase(row, error = null, options = {}) {
  const receiptInserts = options.receiptInserts || [];
  return {
    from(table) {
      if (table === 'alive_group_pull_receipts') {
        return {
          async insert(payload) {
            receiptInserts.push(payload);
            if (options.receiptThrow) {
              throw options.receiptThrow;
            }
            return { error: options.receiptError || null };
          }
        };
      }

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

test('GET /alive/groups records a successful pull receipt', async () => {
  const exportedAt = '2026-08-02T04:28:54.000Z';
  const supabase = fakeSupabase({
    response: { exportedAt, status: 'ok', groups: [] },
    exported_at: exportedAt,
    last_attempt_at: exportedAt,
    last_error_at: null
  });
  const calls = [];

  const response = await callAliveGroupsRoute({
    supabase,
    headerApiKey: 'test-key',
    logPullReceipt: async (...args) => calls.push(args)
  });

  assert.equal(response.status, 200);
  assert.deepEqual(calls, [
    [
      supabase,
      {
        consumerId: 'alive_groups_customer',
        responseStatus: 200,
        exportedAt
      }
    ]
  ]);
});

test('GET /alive/groups writes only safe receipt fields to Supabase', async () => {
  const exportedAt = '2026-08-02T04:28:54.000Z';
  const receiptInserts = [];
  const supabase = fakeSupabase(
    {
      response: {
        exportedAt,
        status: 'ok',
        groups: [{ phones: ['60123456789'] }]
      },
      exported_at: exportedAt,
      last_attempt_at: exportedAt,
      last_error_at: null
    },
    null,
    { receiptInserts }
  );

  const response = await callAliveGroupsRoute({
    supabase,
    headerApiKey: 'test-key'
  });

  assert.equal(response.status, 200);
  assert.equal(receiptInserts.length, 1);
  const [{ id, ...receiptFields }] = receiptInserts;
  assert.match(
    id,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  );
  assert.deepEqual(receiptFields, {
    consumer_id: 'alive_groups_customer',
    response_status: 200,
    exported_at: exportedAt,
    success: true
  });
});

test('GET /alive/groups still returns data when receipt tracking throws', async () => {
  const body = {
    exportedAt: '2026-08-02T04:28:54.000Z',
    status: 'ok',
    groups: []
  };
  const supabase = fakeSupabase(
    {
      response: body,
      exported_at: body.exportedAt,
      last_attempt_at: body.exportedAt,
      last_error_at: null
    },
    null,
    { receiptThrow: new Error('receipt connection failed') }
  );
  const originalError = console.error;
  console.error = () => {};

  try {
    const response = await callAliveGroupsRoute({
      supabase,
      headerApiKey: 'test-key'
    });

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, body);
  } finally {
    console.error = originalError;
  }
});

test('GET /alive/groups still returns data when Supabase returns a receipt error', async () => {
  const body = {
    exportedAt: '2026-08-02T04:28:54.000Z',
    status: 'ok',
    groups: []
  };
  const originalError = console.error;
  const loggedErrors = [];
  console.error = (...args) => loggedErrors.push(args);

  try {
    const response = await callAliveGroupsRoute({
      supabase: fakeSupabase(
        {
          response: body,
          exported_at: body.exportedAt,
          last_attempt_at: body.exportedAt,
          last_error_at: null
        },
        null,
        { receiptError: { message: 'receipt insert rejected' } }
      ),
      headerApiKey: 'test-key'
    });

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, body);
    assert.equal(loggedErrors.length, 1);
  } finally {
    console.error = originalError;
  }
});

test('GET /alive/groups fails open when the receipt dependency rejects', async () => {
  const body = {
    exportedAt: '2026-08-02T04:28:54.000Z',
    status: 'ok',
    groups: []
  };
  const originalError = console.error;
  console.error = () => {};

  try {
    const response = await callAliveGroupsRoute({
      supabase: fakeSupabase({
        response: body,
        exported_at: body.exportedAt,
        last_attempt_at: body.exportedAt,
        last_error_at: null
      }),
      headerApiKey: 'test-key',
      logPullReceipt: () => Promise.reject()
    });

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, body);
  } finally {
    console.error = originalError;
  }
});

test('GET /alive/groups returns 401 when X-API-Key is missing', async () => {
  const receiptInserts = [];
  const response = await callAliveGroupsRoute({
    supabase: fakeSupabase(
      { response: { status: 'ok', groups: [] } },
      null,
      { receiptInserts }
    )
  });

  assert.equal(response.status, 401);
  assert.deepEqual(response.body, {
    success: false,
    error: 'Invalid or missing X-API-Key header'
  });
  assert.deepEqual(receiptInserts, []);
});

test('GET /alive/groups returns 503 when latest export is missing', async () => {
  const receiptInserts = [];
  const response = await callAliveGroupsRoute({
    supabase: fakeSupabase(null, null, { receiptInserts }),
    headerApiKey: 'test-key'
  });

  assert.equal(response.status, 503);
  assert.deepEqual(response.body, {
    success: false,
    error: 'Alive groups export is not available'
  });
  assert.deepEqual(receiptInserts, []);
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
  const receiptInserts = [];
  const response = await callAliveGroupsRoute({
    supabase: fakeSupabase(
      null,
      new Error('permission denied'),
      { receiptInserts }
    ),
    headerApiKey: 'test-key'
  });

  assert.equal(response.status, 500);
  assert.deepEqual(response.body, {
    success: false,
    error: 'Failed to load Alive groups export'
  });
  assert.deepEqual(receiptInserts, []);
});

test('pull receipt insert uses a bounded abort signal', async () => {
  let receivedSignal;
  const supabase = {
    from(table) {
      assert.equal(table, 'alive_group_pull_receipts');
      return {
        insert() {
          return {
            abortSignal(signal) {
              receivedSignal = signal;
              return new Promise((resolve, reject) => {
                if (signal.aborted) {
                  reject(signal.reason);
                  return;
                }
                signal.addEventListener('abort', () => reject(signal.reason), {
                  once: true
                });
              });
            }
          };
        }
      };
    }
  };
  const originalError = console.error;
  const keepEventLoopAlive = setTimeout(() => {}, 50);
  console.error = () => {};

  try {
    await logAliveGroupPullReceipt(
      supabase,
      {
        consumerId: 'alive_groups_customer',
        responseStatus: 200,
        exportedAt: '2026-08-02T04:28:54.000Z'
      },
      { timeoutMs: 10 }
    );

    assert.ok(receivedSignal instanceof AbortSignal);
    assert.equal(receivedSignal.aborted, true);
  } finally {
    clearTimeout(keepEventLoopAlive);
    console.error = originalError;
  }
});
