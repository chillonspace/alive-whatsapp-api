const fs = require('fs/promises');
const path = require('path');
const axios = require('axios');

const GROUP_EVENT_KEYWORDS = [
  'group_participants_update',
  'group_id',
  'participants',
  'member',
  'wa_id',
  'phone',
  'joined',
  'left',
  'removed',
  'requested',
  'approved',
  'rejected',
  'invite'
];

const MEMBER_DATA_KEYWORDS = ['participants', 'participant', 'members', 'member', 'phone', 'wa_id'];

function isConfiguredValue(value) {
  return typeof value === 'string' && value.trim() !== '' && !value.trim().startsWith('replace_with_');
}

function stringifyForInspection(value) {
  try {
    return JSON.stringify(value).toLowerCase();
  } catch (_err) {
    return '';
  }
}

function detectGroupEvent(payload) {
  const inspected = stringifyForInspection(payload);
  const detectedKeywords = GROUP_EVENT_KEYWORDS.filter((keyword) => inspected.includes(keyword));

  return {
    possibleGroupEvent: detectedKeywords.length > 0,
    detectedKeywords
  };
}

function normalizePhone(value) {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/\D/g, '')
    : '';
}

function scalarValues(value) {
  if (Array.isArray(value)) {
    return value.flatMap(scalarValues);
  }

  if (value && typeof value === 'object') {
    return Object.values(value).flatMap(scalarValues);
  }

  return [value];
}

function inspectMemberResponse(data, testStudentPhone) {
  const inspected = stringifyForInspection(data);
  const detectedMemberKeywords = MEMBER_DATA_KEYWORDS.filter((keyword) => inspected.includes(keyword));
  const normalizedTestPhone = normalizePhone(testStudentPhone);
  const testStudentFound =
    !!normalizedTestPhone &&
    scalarValues(data).some((value) => normalizePhone(value).includes(normalizedTestPhone));

  return {
    containsMemberData: detectedMemberKeywords.length > 0,
    detectedMemberKeywords,
    testStudentFound
  };
}

function getWebhookLogPath(env = process.env, cwd = process.cwd()) {
  return env.VERCEL ? '/tmp/group-webhook-test.jsonl' : path.join(cwd, 'logs', 'group-webhook-test.jsonl');
}

async function appendWebhookPayload(payload, detection, options = {}) {
  const logPath = options.logPath || getWebhookLogPath(options.env, options.cwd);
  const entry = {
    timestamp: new Date().toISOString(),
    possibleGroupEvent: detection.possibleGroupEvent,
    detectedKeywords: detection.detectedKeywords,
    payload
  };

  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.appendFile(logPath, `${JSON.stringify(entry)}\n`, 'utf8');
  return logPath;
}

function getGroupTestConfig(env = process.env) {
  const baseUrl = (env.CHAKRA_BASE_URL || env.CHAKRA_API_BASE_URL || 'https://api.chakrahq.com').replace(/\/+$/, '');
  const accessToken = env.CHAKRA_API_KEY || env.CHAKRA_ACCESS_TOKEN;
  const apiVersion = env.WHATSAPP_API_VERSION || env.CHAKRA_WA_API_VERSION;
  const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID || env.CHAKRA_PHONE_NUMBER_ID;
  const groupId = env.TEST_GROUP_ID;
  const testStudentPhone = env.TEST_STUDENT_PHONE || '';

  if (
    !isConfiguredValue(accessToken) ||
    !isConfiguredValue(apiVersion) ||
    !isConfiguredValue(phoneNumberId) ||
    !isConfiguredValue(groupId)
  ) {
    const error = new Error(
      'Server configuration is incomplete: Chakra access token, WhatsApp API version, phone number ID, or TEST_GROUP_ID is not configured'
    );
    error.statusCode = 500;
    throw error;
  }

  return { baseUrl, accessToken, apiVersion, phoneNumberId, groupId, testStudentPhone };
}

function buildGroupTestRequests(config) {
  const versionRoot = `${config.baseUrl}/v1/whatsapp/${encodeURIComponent(config.apiVersion)}`;
  const groupId = encodeURIComponent(config.groupId);

  return [
    {
      name: 'listGroups',
      url: `${versionRoot}/${encodeURIComponent(config.phoneNumberId)}/groups`
    },
    {
      name: 'getGroupInfo',
      url: `${versionRoot}/groups/${groupId}`
    },
    {
      name: 'getGroupParticipants',
      url: `${versionRoot}/groups/${groupId}/participants`
    },
    {
      name: 'getGroupMembers',
      url: `${versionRoot}/groups/${groupId}/members`
    }
  ];
}

async function executeGroupMemberListTest(options = {}) {
  const config = options.config || getGroupTestConfig(options.env);
  const httpClient = options.httpClient || axios;
  const requests = buildGroupTestRequests(config);
  const results = [];

  for (const request of requests) {
    try {
      const response = await httpClient.get(request.url, {
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          'Content-Type': 'application/json'
        }
      });
      const inspection = inspectMemberResponse(response.data, config.testStudentPhone);
      const result = {
        name: request.name,
        url: request.url,
        success: true,
        status: response.status,
        ...inspection,
        response: response.data
      };

      console.info('Chakra group API test response', result);
      results.push(result);
    } catch (err) {
      const responseBody = err.response?.data || { message: err.message || 'Unknown request error' };
      const inspection = inspectMemberResponse(responseBody, config.testStudentPhone);
      const result = {
        name: request.name,
        url: request.url,
        success: false,
        status: err.response?.status || null,
        ...inspection,
        response: responseBody
      };

      console.error('Chakra group API test failed', result);
      results.push(result);
    }
  }

  const byName = Object.fromEntries(results.map((result) => [result.name, result]));
  const memberResults = [byName.getGroupParticipants, byName.getGroupMembers];

  return {
    ok: true,
    canReceiveWebhookNeedsManualTest: true,
    canListGroups: !!byName.listGroups?.success,
    canGetGroupInfo: !!byName.getGroupInfo?.success,
    canRetrieveMemberList: memberResults.some((result) => result?.success && result.containsMemberData),
    testStudentFoundInMemberList: memberResults.some((result) => result?.testStudentFound),
    results
  };
}

module.exports = {
  GROUP_EVENT_KEYWORDS,
  appendWebhookPayload,
  buildGroupTestRequests,
  detectGroupEvent,
  executeGroupMemberListTest,
  getGroupTestConfig,
  getWebhookLogPath,
  inspectMemberResponse,
  normalizePhone
};
