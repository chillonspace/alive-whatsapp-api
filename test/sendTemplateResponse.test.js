const assert = require('node:assert/strict');
const test = require('node:test');
const axios = require('axios');
const supabaseConfig = require('../src/config/supabase');

// Exercise the real route, mapping, usage checks and Chakra service, with no network I/O.
function setup(t, { data = {}, upstreamError, duplicate = null, count = 0 } = {}) {
  const env = {
    CLIENT_API_KEY: 'test-client-key',
    CHAKRA_ACCESS_TOKEN: 'test-token',
    CHAKRA_PLUGIN_ID: 'test-plugin',
    CHAKRA_PHONE_NUMBER_ID: 'test-phone-id',
    SEND_TEMPLATE_RATE_LIMIT_PER_MINUTE: '60',
    SEND_TEMPLATE_DAILY_LIMIT: '1000'
  };
  for (const [key, value] of Object.entries(env)) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => previous === undefined ? delete process.env[key] : process.env[key] = previous);
  }
  t.mock.method(console, 'info', () => {});
  t.mock.method(console, 'error', () => {});
  const logs = [];
  const supabase = {
    from(table) {
      const query = {
        count, error: null,
        select() { return this; },
        eq() { return this; },
        gte() { return this; },
        in() { return this; },
        order() { return this; },
        limit() { return this; },
        async maybeSingle() {
          return { error: null, data: table === 'whatsapp_templates'
            ? { mapping: { '1': 'name' }, status: 'APPROVED', header: null }
            : duplicate };
        },
        async insert(entry) { logs.push(entry); return { error: null }; }
      };
      return query;
    }
  };
  t.mock.method(supabaseConfig, 'getSupabaseClient', () => supabase);
  const post = t.mock.method(axios, 'post', async () => {
    if (upstreamError) throw upstreamError;
    return { status: 200, data };
  });
  const routePaths = ['../src/routes/sendTemplate', '../routes/sendMessage'];
  for (const path of routePaths) delete require.cache[require.resolve(path)];
  const routers = routePaths.map(path => require(path));
  t.after(() => routePaths.forEach(path => delete require.cache[require.resolve(path)]));
  async function request(body = {}, legacy = false) {
    const req = {
      body: { phone: 'test-recipient', template_name: 'example_template', language: 'en',
        variables: { name: 'Example' }, ...body },
      get: () => env.CLIENT_API_KEY
    };
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(value) { this.body = value; return this; }
    };
    const route = routers[legacy ? 1 : 0].stack.find(layer => layer.route).route;
    for (const layer of route.stack) {
      await layer.handle(req, res, () => {});
      if (res.body) break;
    }
    return res;
  }
  return { request, post, logs };
}

const cases = [
  ['normal fields', { _data: { externalId: 'wamid.EXAMPLE', deliveryStatus: 'SENT', whatsappMessageId: 'different-id', privateField: 'hidden' } }, 'wamid.EXAMPLE', 'SENT'],
  ['unmodified values', { _data: { externalId: ' wamid.EXAMPLE ', deliveryStatus: 'custom-status' } }, ' wamid.EXAMPLE ', 'custom-status'],
  ['empty strings', { _data: { externalId: '', deliveryStatus: '' } }, '', ''],
  ['missing message ID without fallback', { _data: { whatsappMessageId: 'other-id', deliveryStatus: 'PENDING' } }, null, 'PENDING'],
  ['missing status', { _data: { externalId: 'wamid.EXAMPLE' } }, 'wamid.EXAMPLE', null],
  ['empty data', { _data: {} }, null, null],
  ['missing data', {}, null, null],
  ['null data', { _data: null }, null, null],
  ['null fields', { _data: { externalId: null, deliveryStatus: null } }, null, null]
];

for (const [name, data, messageId, deliveryStatus] of cases) {
  test(`send-template response: ${name}`, async t => {
    const { request, post, logs } = setup(t, { data });
    const res = await request();
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, {
      success: true, template_name: 'example_template', language: 'en', phone: 'testrecipient',
      message_id: messageId, deliveryStatus
    });
    assert.equal(post.mock.callCount(), 1);
    assert.equal(logs.at(-1).status, 'sent');
    assert.deepEqual(post.mock.calls[0].arguments[1], {
      whatsappPhoneNumberId: 'test-phone-id', templateName: 'example_template', language: 'en',
      mapping: [{ schemaPropertyName: '1', schemaPropertyValue: 'Example' }]
    });
  });
}

for (const [name, options, status, error] of [
  ['upstream HTTP error', { upstreamError: { response: { status: 429, data: { message: 'Upstream limit' } } } }, 429, 'Upstream limit'],
  ['Chakra errors array', { data: { _errors: ['Send rejected'] } }, 500, 'Failed to send message through ChakraHQ'],
  ['network error', { upstreamError: new Error('Network unavailable') }, 500, 'Failed to send message through ChakraHQ']
]) {
  test(`send-template preserves ${name}`, async t => {
    const { request, logs } = setup(t, options);
    const res = await request();
    assert.equal(res.statusCode, status);
    assert.deepEqual(res.body, { success: false, error });
    assert.equal(logs.at(-1).status, 'failed');
  });
}

test('send-template still blocks duplicates without sending', async t => {
  const { request, post } = setup(t, { duplicate: { request_id: 'previous-request' } });
  const res = await request({ idempotency_key: 'test-request' });
  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.body, { success: false, error: 'Duplicate send blocked.', previous_request_id: 'previous-request' });
  assert.equal(post.mock.callCount(), 0);
});

test('send-template still rejects invalid requests without sending', async t => {
  const { request, post } = setup(t);
  const res = await request({ phone: '' });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { success: false, error: 'phone is required' });
  assert.equal(post.mock.callCount(), 0);
});

test('send-template still enforces rate limits without sending', async t => {
  const { request, post } = setup(t, { count: 60 });
  const res = await request();
  assert.equal(res.statusCode, 429);
  assert.deepEqual(res.body, { success: false, error: 'Rate limit exceeded. Please retry later.', retry_after_seconds: 60 });
  assert.equal(post.mock.callCount(), 0);
});

test('send-message template success response remains unchanged', async t => {
  const { request, post } = setup(t, { data: { _data: { externalId: 'wamid.EXAMPLE', deliveryStatus: 'SENT' } } });
  const res = await request({ api_key: 'test-client-key', message_type: 'template',
    payload: { template_name: 'example_template', language: 'en' } }, true);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { success: true, message: 'Message sent successfully' });
  assert.equal(post.mock.callCount(), 1);
});
