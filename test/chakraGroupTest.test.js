const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  appendWebhookPayload,
  buildGroupTestRequests,
  detectGroupEvent,
  executeGroupMemberListTest,
  findGroupIds,
  getWebhookLogPath,
  inspectMemberResponse
} = require('../src/services/chakraGroupTestService');

const config = {
  baseUrl: 'https://api.example.com',
  accessToken: 'secret',
  apiVersion: 'v23.0',
  phoneNumberId: 'phone-id',
  groupId: 'group/id',
  testStudentPhone: '+60 12-345 6789'
};

test('detectGroupEvent finds nested group event keywords', () => {
  const detection = detectGroupEvent({
    entry: [{ changes: [{ field: 'group_participants_update', value: { joined: ['1'] } }] }]
  });

  assert.equal(detection.possibleGroupEvent, true);
  assert.deepEqual(detection.detectedKeywords, ['group_participants_update', 'participants', 'joined']);
  assert.equal(detectGroupEvent({ event: 'message_received' }).possibleGroupEvent, false);
});

test('webhook payload is appended as one JSONL entry', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'alive-group-log-'));
  const logPath = path.join(cwd, 'logs', 'group-webhook-test.jsonl');
  const payload = { group_id: 'test-group', event: 'joined' };
  const detection = detectGroupEvent(payload);

  await appendWebhookPayload(payload, detection, { logPath });

  const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]).payload, payload);
  assert.equal(getWebhookLogPath({ VERCEL: '1' }, cwd), '/tmp/group-webhook-test.jsonl');
});

test('member inspection detects member fields and normalized phone', () => {
  const inspection = inspectMemberResponse(
    { participants: [{ wa_id: '60123456789' }] },
    '+60 12-345 6789'
  );

  assert.equal(inspection.containsMemberData, true);
  assert.equal(inspection.testStudentFound, true);
});

test('member inspection does not match a phone across separate values', () => {
  const inspection = inspectMemberResponse(
    { participants: [{ phone: '60123' }, { phone: '456789' }] },
    '+60 123-456789'
  );

  assert.equal(inspection.containsMemberData, true);
  assert.equal(inspection.testStudentFound, false);
});

test('group test requests use the four required candidate endpoints', () => {
  assert.deepEqual(
    buildGroupTestRequests(config).map((request) => request.url),
    [
      'https://api.example.com/v1/whatsapp/v23.0/phone-id/groups',
      'https://api.example.com/v1/whatsapp/v23.0/groups/group%2Fid',
      'https://api.example.com/v1/whatsapp/v23.0/groups/group%2Fid/participants',
      'https://api.example.com/v1/whatsapp/v23.0/groups/group%2Fid/members'
    ]
  );
});

test('group discovery mode only builds the list-groups request without a group ID', () => {
  assert.deepEqual(
    buildGroupTestRequests({ ...config, groupId: '' }).map((request) => request.name),
    ['listGroups']
  );
});

test('findGroupIds extracts nested group_id and groupId values', () => {
  assert.deepEqual(
    findGroupIds({ data: [{ group_id: 'group-1' }, { nested: { groupId: 'group-2' } }] }),
    ['group-1', 'group-2']
  );
});

test('member-list test continues after failures and produces capability report', async () => {
  const calledUrls = [];
  const httpClient = {
    async get(url) {
      calledUrls.push(url);

      if (url.endsWith('/groups')) {
        return { status: 200, data: { data: [{ group_id: 'group/id' }] } };
      }
      if (url.endsWith('/participants')) {
        return { status: 200, data: { participants: [{ wa_id: '60123456789' }] } };
      }

      const error = new Error('Not found');
      error.response = { status: 404, data: { error: 'Not found' } };
      throw error;
    }
  };

  const report = await executeGroupMemberListTest({ config, httpClient });

  assert.equal(calledUrls.length, 4);
  assert.equal(report.canListGroups, true);
  assert.equal(report.canGetGroupInfo, false);
  assert.equal(report.canRetrieveMemberList, true);
  assert.equal(report.testStudentFoundInMemberList, true);
  assert.equal(report.results.length, 4);
});

test('discovery mode finds a group ID and continues member-list tests', async () => {
  const calledUrls = [];
  const httpClient = {
    async get(url) {
      calledUrls.push(url);

      if (url.endsWith('/groups')) {
        return { status: 200, data: { data: [{ group_id: 'discovered-group' }] } };
      }
      if (url.endsWith('/participants')) {
        return { status: 200, data: { participants: [{ wa_id: '60123456789' }] } };
      }

      return { status: 200, data: {} };
    }
  };

  const report = await executeGroupMemberListTest({
    config: { ...config, groupId: '' },
    httpClient
  });

  assert.equal(calledUrls.length, 4);
  assert.deepEqual(report.discoveredGroupIds, ['discovered-group']);
  assert.equal(report.testedGroupId, 'discovered-group');
  assert.equal(report.discoveryOnly, false);
  assert.equal(report.canRetrieveMemberList, true);
});

test('discovery mode reports no group ID when list-groups returns no IDs', async () => {
  const report = await executeGroupMemberListTest({
    config: { ...config, groupId: '' },
    httpClient: {
      async get() {
        return { status: 200, data: { data: [] } };
      }
    }
  });

  assert.equal(report.results.length, 1);
  assert.deepEqual(report.discoveredGroupIds, []);
  assert.equal(report.testedGroupId, null);
  assert.equal(report.discoveryOnly, true);
});

test('router exposes public webhook test and protects member-list debug test', () => {
  const router = require('../src/routes/chakraGroupTest');
  const routes = router.stack.filter((layer) => layer.route).map((layer) => layer.route);
  const webhookRoute = routes.find((route) => route.path === '/webhooks/chakra/group-test');
  const debugRoute = routes.find((route) => route.path === '/debug/chakra/group-member-list-test');

  assert.ok(webhookRoute);
  assert.ok(webhookRoute.methods.post);
  assert.equal(webhookRoute.stack.length, 1);
  assert.ok(debugRoute);
  assert.ok(debugRoute.methods.get);
  assert.equal(debugRoute.stack[0].handle.name, 'requireApiKey');
});

test('webhook route logs the full nested payload as JSON', async () => {
  const router = require('../src/routes/chakraGroupTest');
  const route = router.stack
    .filter((layer) => layer.route)
    .map((layer) => layer.route)
    .find((item) => item.path === '/webhooks/chakra/group-test');
  const handler = route.stack[0].handle;
  const originalInfo = console.info;
  const logged = [];

  console.info = (...args) => logged.push(args);

  try {
    await handler(
      { body: { entry: [{ changes: [{ value: { messages: [{ from: '60123456789' }] } }] }] } },
      {
        status() {
          return this;
        },
        json(body) {
          return body;
        }
      }
    );
  } finally {
    console.info = originalInfo;
    fs.rmSync(path.join(process.cwd(), 'logs'), { recursive: true, force: true });
  }

  assert.match(logged[0][1], /"messages":\[\{"from":"60123456789"\}\]/);
});
