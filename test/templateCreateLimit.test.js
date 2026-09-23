const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const routePath = require.resolve('../src/routes/templates');

function loadTemplateRoute(dependencies) {
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (parent?.filename === routePath && Object.hasOwn(dependencies, request)) {
      return dependencies[request];
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  delete require.cache[routePath];
  try {
    return require(routePath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[routePath];
  }
}

test('POST /templates returns 429 without forwarding when reservation is denied', async () => {
  let upstreamCalls = 0;
  const usageLogs = [];
  const router = loadTemplateRoute({
    '../config/supabase': { getSupabaseClient: () => ({}) },
    '../services/chakraTemplateService': {
      validateTemplateConfiguration: () => ({}),
      createTemplate: async () => { upstreamCalls += 1; },
      listTemplates: async () => []
    },
    '../services/apiUsageService': {
      getUsageConfig: () => ({ templateCreatePerHour: 100 }),
      reserveTemplateCreateSlot: async () => ({
        allowed: false,
        currentCount: 100,
        limit: 100,
        retryAfterSeconds: 42
      }),
      logApiUsage: async (_supabase, entry) => { usageLogs.push(entry); }
    }
  });
  const route = router.stack.find((layer) => layer.route?.path === '/templates').route;
  const response = {};
  const res = {
    status(code) { response.status = code; return this; },
    json(body) { response.body = body; return body; }
  };

  await route.stack[1].handle({
    apiKeyLabel: 'client_main',
    body: {
      template_name: 'booking_confirm',
      category: 'UTILITY',
      language: 'en',
      body: 'Hi {{name}}, your booking is confirmed.',
      variables: ['name'],
      examples: { name: 'John' }
    }
  }, res);

  assert.equal(response.status, 429);
  assert.equal(response.body.retry_after_seconds, 42);
  assert.equal(upstreamCalls, 0);
  assert.equal(usageLogs.length, 1);
  assert.equal(usageLogs[0].status, 'blocked');
});
