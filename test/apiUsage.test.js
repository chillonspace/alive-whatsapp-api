const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildSendTemplateRequestHash,
  getUsageConfig,
  reserveTemplateCreateSlot,
  stableStringify
} = require('../src/services/apiUsageService');
const sendTemplateRoute = require('../src/routes/sendTemplate');

test('usage config uses production-safe defaults', () => {
  assert.deepEqual(getUsageConfig({}), {
    sendMessagePerMinute: 60,
    sendMessageDaily: 1000,
    sendTemplatePerMinute: 180,
    sendTemplateDaily: 2000,
    templateCreatePerHour: 100,
    duplicateWindowMinutes: 10
  });
});

test('usage config accepts positive integer overrides only', () => {
  assert.deepEqual(
    getUsageConfig({
      SEND_MESSAGE_RATE_LIMIT_PER_MINUTE: '6',
      SEND_MESSAGE_DAILY_LIMIT: '300',
      SEND_TEMPLATE_RATE_LIMIT_PER_MINUTE: '5',
      SEND_TEMPLATE_DAILY_LIMIT: '200',
      TEMPLATE_CREATE_RATE_LIMIT_PER_HOUR: '2',
      DUPLICATE_WINDOW_MINUTES: '15'
    }),
    {
      sendMessagePerMinute: 6,
      sendMessageDaily: 300,
      sendTemplatePerMinute: 5,
      sendTemplateDaily: 200,
      templateCreatePerHour: 2,
      duplicateWindowMinutes: 15
    }
  );

  assert.equal(getUsageConfig({ SEND_TEMPLATE_RATE_LIMIT_PER_MINUTE: '0' }).sendTemplatePerMinute, 180);
  assert.equal(getUsageConfig({ SEND_TEMPLATE_RATE_LIMIT_PER_MINUTE: 'nope' }).sendTemplatePerMinute, 180);
  assert.equal(getUsageConfig({ SEND_TEMPLATE_DAILY_LIMIT: '0' }).sendTemplateDaily, 2000);
  assert.equal(getUsageConfig({ SEND_TEMPLATE_DAILY_LIMIT: 'nope' }).sendTemplateDaily, 2000);
});

test('template-create limiter atomically reserves a forwarded attempt slot', async () => {
  const calls = [];
  const supabase = {
    async rpc(name, args) {
      calls.push([name, args]);
      return {
        data: [{ allowed: true, current_count: 2, retry_after_seconds: 3600 }],
        error: null
      };
    }
  };

  const result = await reserveTemplateCreateSlot(supabase, {
    requestId: 'tpl_create_123',
    apiKeyLabel: 'client_main',
    limit: 100,
    templateName: 'schedule_ready',
    language: 'en',
    imageUrlPresent: false,
    variablesKeys: ['student_name']
  });

  assert.equal(result.currentCount, 2);
  assert.equal(result.allowed, true);
  assert.equal(calls[0][0], 'reserve_template_create_slot');
  assert.deepEqual(calls[0][1], {
    p_request_id: 'tpl_create_123',
    p_api_key_label: 'client_main',
    p_limit: 100,
    p_template_name: 'schedule_ready',
    p_language: 'en',
    p_image_url_present: false,
    p_variables_keys: ['student_name']
  });
});

test('stableStringify sorts object keys deeply', () => {
  const left = stableStringify({ b: 2, a: { y: 1, x: 2 } });
  const right = stableStringify({ a: { x: 2, y: 1 }, b: 2 });

  assert.equal(left, right);
});

test('send-template request hash is stable for reordered variables', () => {
  const left = buildSendTemplateRequestHash({
    phone: '60123456789',
    templateName: 'course_promo_image_v1',
    language: 'en',
    imageUrl: 'https://example.com/live.jpg',
    variables: {
      student_name: 'Peter',
      course_name: 'Art Therapy Workshop'
    }
  });

  const right = buildSendTemplateRequestHash({
    phone: '60123456789',
    templateName: 'course_promo_image_v1',
    language: 'en',
    imageUrl: 'https://example.com/live.jpg',
    variables: {
      course_name: 'Art Therapy Workshop',
      student_name: 'Peter'
    }
  });

  assert.equal(left, right);
});

test('idempotency key is trimmed and capped', () => {
  assert.equal(sendTemplateRoute.normalizeIdempotencyKey('  booking_123  '), 'booking_123');
  assert.equal(sendTemplateRoute.normalizeIdempotencyKey('x'.repeat(200)).length, 160);
  assert.equal(sendTemplateRoute.normalizeIdempotencyKey('   '), '');
});
