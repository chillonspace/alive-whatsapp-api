/**
 * ChakraHQ message-template API client.
 *
 * Endpoint (confirmed from https://apidocs.chakrahq.com/):
 *   Create: POST {base}/v1/ext/plugin/whatsapp/api/{whatsappApiVersion}/{wabaId}/message_templates
 *   List:   GET  {base}/v1/ext/plugin/whatsapp/api/{whatsappApiVersion}/{wabaId}/message_templates?limit=100
 *
 * Auth: Authorization: Bearer <CHAKRA_ACCESS_TOKEN>
 *
 * This is a pass-through to Meta's WhatsApp Business Management API. Request
 * and response shapes mirror Meta's own format.
 */

const axios = require('axios');
const { buildExampleBodyText } = require('./templateMappingService');

function isConfiguredValue(value) {
  return (
    typeof value === 'string' &&
    value.trim() !== '' &&
    !value.trim().startsWith('replace_with_')
  );
}

function getChakraEnv() {
  const baseUrl = (process.env.CHAKRA_API_BASE_URL || 'https://api.chakrahq.com').replace(/\/+$/, '');
  const accessToken = process.env.CHAKRA_ACCESS_TOKEN;
  const apiVersion = process.env.CHAKRA_WA_API_VERSION;
  const wabaId = process.env.CHAKRA_TEST_WABA_ID;

  if (
    !isConfiguredValue(accessToken) ||
    !isConfiguredValue(apiVersion) ||
    !isConfiguredValue(wabaId)
  ) {
    const error = new Error(
      'Server configuration is incomplete: CHAKRA_ACCESS_TOKEN, CHAKRA_WA_API_VERSION, or CHAKRA_TEST_WABA_ID is not configured'
    );
    error.statusCode = 500;
    throw error;
  }

  return { baseUrl, accessToken, apiVersion, wabaId };
}

function getRequestConfig(accessToken) {
  return {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  };
}

function buildMessageTemplatesUrl(baseUrl, apiVersion, wabaId, query) {
  const path = `/v1/ext/plugin/whatsapp/api/${apiVersion}/${wabaId}/message_templates`;
  const qs = query ? `?${query}` : '';
  return `${baseUrl}${path}${qs}`;
}

function getUpstreamErrorMessage(err) {
  const data = err.response?.data;

  if (typeof data === 'string' && data.trim()) {
    return data.trim();
  }

  if (!data || typeof data !== 'object') {
    return '';
  }

  const metaError = data.error && typeof data.error === 'object' ? data.error : {};

  return (
    data.message ||
    metaError.error_data?.details ||
    metaError.error_user_msg ||
    metaError.message ||
    (typeof data.error === 'string' ? data.error : '') ||
    ''
  );
}

function summarizeChakraError(err) {
  const data = err.response?.data;

  if (!data || typeof data !== 'object') {
    return { raw: typeof data === 'string' ? data.slice(0, 500) : null };
  }

  const metaError = data.error && typeof data.error === 'object' ? data.error : {};

  return {
    message: data.message || metaError.message || '',
    code: metaError.code || data.code || '',
    type: metaError.type || data.type || '',
    details: metaError.error_data?.details || ''
  };
}

async function createTemplate({ name, category, language, bodyMeta, examples, variablesOrder, runId = 'unknown' }) {
  const { baseUrl, accessToken, apiVersion, wabaId } = getChakraEnv();

  const bodyComponent = {
    type: 'BODY',
    text: bodyMeta
  };

  if (Array.isArray(variablesOrder) && variablesOrder.length > 0) {
    bodyComponent.example = {
      body_text: [buildExampleBodyText(variablesOrder, examples)]
    };
  }

  const requestBody = {
    name,
    category,
    language,
    components: [bodyComponent]
  };

  const url = buildMessageTemplatesUrl(baseUrl, apiVersion, wabaId);

  console.info('Posting Chakra create-template request', {
    runId,
    name,
    category,
    language,
    hasExamples: !!bodyComponent.example
  });

  try {
    const response = await axios.post(url, requestBody, getRequestConfig(accessToken));
    return { requestBody, response: response.data };
  } catch (err) {
    console.error('Chakra create-template request failed', {
      runId,
      status: err.response?.status || null,
      summary: summarizeChakraError(err)
    });

    const upstreamMessage = getUpstreamErrorMessage(err);
    const error = new Error(upstreamMessage || 'Failed to create template via ChakraHQ');
    error.statusCode = err.response?.status || 500;
    error.upstream = err.response?.data || null;
    throw error;
  }
}

async function listTemplates({ runId = 'unknown' } = {}) {
  const { baseUrl, accessToken, apiVersion, wabaId } = getChakraEnv();

  const collected = [];
  let nextUrl = buildMessageTemplatesUrl(baseUrl, apiVersion, wabaId, 'limit=100');

  let page = 0;

  try {
    while (nextUrl) {
      page += 1;
      const response = await axios.get(nextUrl, getRequestConfig(accessToken));
      const payload = response.data || {};
      const data = Array.isArray(payload.data) ? payload.data : [];

      collected.push(...data);

      const next = payload.paging?.next;
      if (next && typeof next === 'string' && page < 20) {
        nextUrl = next;
      } else {
        nextUrl = null;
      }
    }

    console.info('Chakra list-templates succeeded', { runId, count: collected.length, pages: page });

    return collected;
  } catch (err) {
    console.error('Chakra list-templates request failed', {
      runId,
      status: err.response?.status || null,
      summary: summarizeChakraError(err)
    });

    const upstreamMessage = getUpstreamErrorMessage(err);
    const error = new Error(upstreamMessage || 'Failed to list templates from ChakraHQ');
    error.statusCode = err.response?.status || 500;
    throw error;
  }
}

module.exports = {
  createTemplate,
  listTemplates
};
