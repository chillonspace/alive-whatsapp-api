const express = require('express');
const { requireApiKey } = require('../middleware/auth');
const { getSupabaseClient } = require('../config/supabase');
const { buildMappingFromStored } = require('../services/templateMappingService');
const {
  buildSendTemplateRequestHash,
  checkUsageLimit,
  findDuplicateSend,
  getUsageConfig,
  logApiUsage
} = require('../services/apiUsageService');
const { sendWhatsAppMessage } = require('../../services/chakraService');

const router = express.Router();

const DEFAULT_CHANNEL = 'test';
const TABLE = 'whatsapp_templates';

function newRunId() {
  return `tpl_send_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizePhone(phone) {
  return String(phone || '').replace(/[\s\-+]/g, '').trim();
}

function trimString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeIdempotencyKey(value) {
  const key = trimString(value);
  return key ? key.slice(0, 160) : '';
}

function getVariableKeys(variables) {
  return variables && typeof variables === 'object' && !Array.isArray(variables)
    ? Object.keys(variables).sort()
    : [];
}

function isPublicHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !!url.hostname;
  } catch (_err) {
    return false;
  }
}

function isImageHeader(header) {
  return !!header && typeof header === 'object' && !Array.isArray(header) && header.type === 'IMAGE';
}

function validateTemplateImageUrl(header, imageUrl) {
  if (!isImageHeader(header)) {
    return null;
  }

  if (!imageUrl) {
    return 'image_url is required for templates with IMAGE header';
  }

  if (!isPublicHttpsUrl(imageUrl)) {
    return 'image_url must be a public https URL';
  }

  return null;
}

function buildSendTemplatePayload({ templateName, language, mapping, header, imageUrl }) {
  return {
    template_name: templateName,
    language,
    mapping,
    header_mapping: [],
    button_mapping: [],
    ...(isImageHeader(header) ? { image_url: imageUrl } : {})
  };
}

router.post('/send-template', requireApiKey, async (req, res) => {
  const runId = newRunId();
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const usageConfig = getUsageConfig();
  const apiKeyLabel = req.apiKeyLabel || 'client_main';

  const phone = normalizePhone(body.phone);
  const templateName = trimString(body.template_name);
  const language = trimString(body.language);
  const imageUrl = trimString(body.image_url);
  const idempotencyKey = normalizeIdempotencyKey(body.idempotency_key);
  const variables = body.variables;
  const requestHash = buildSendTemplateRequestHash({
    phone,
    templateName,
    language,
    variables,
    imageUrl
  });
  const baseLogEntry = {
    requestId: runId,
    endpoint: 'send-template',
    apiKeyLabel,
    phone,
    templateName,
    language,
    idempotencyKey,
    requestHash,
    imageUrlPresent: !!imageUrl,
    variablesKeys: getVariableKeys(variables)
  };

  if (!phone) {
    return res.status(400).json({ success: false, error: 'phone is required' });
  }

  if (!templateName) {
    return res.status(400).json({ success: false, error: 'template_name is required' });
  }

  if (!language) {
    return res.status(400).json({ success: false, error: 'language is required' });
  }

  if (!variables || typeof variables !== 'object' || Array.isArray(variables)) {
    return res.status(400).json({
      success: false,
      error: 'variables must be an object with a key for each template variable'
    });
  }

  let supabase;
  try {
    supabase = getSupabaseClient();
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      error: err.message || 'Supabase not configured'
    });
  }

  try {
    const minuteLimit = await checkUsageLimit(supabase, {
      endpoint: 'send-template',
      apiKeyLabel,
      limit: usageConfig.sendTemplatePerMinute,
      windowMs: 60 * 1000
    });

    if (!minuteLimit.allowed) {
      await logApiUsage(supabase, {
        ...baseLogEntry,
        status: 'blocked',
        errorMessage: 'Rate limit exceeded',
        metadata: { reason: 'per_minute_limit', limit: minuteLimit.limit, currentCount: minuteLimit.currentCount }
      });

      return res.status(429).json({
        success: false,
        error: 'Rate limit exceeded. Please retry later.',
        retry_after_seconds: minuteLimit.retryAfterSeconds
      });
    }

    const dailyLimit = await checkUsageLimit(supabase, {
      endpoint: 'send-template',
      apiKeyLabel,
      limit: usageConfig.sendTemplateDaily,
      windowMs: 24 * 60 * 60 * 1000,
      statuses: ['sent']
    });

    if (!dailyLimit.allowed) {
      await logApiUsage(supabase, {
        ...baseLogEntry,
        status: 'blocked',
        errorMessage: 'Daily sending limit reached',
        metadata: { reason: 'daily_limit', limit: dailyLimit.limit, currentCount: dailyLimit.currentCount }
      });

      return res.status(429).json({
        success: false,
        error: 'Daily sending limit reached.'
      });
    }

    const duplicate = await findDuplicateSend(supabase, {
      apiKeyLabel,
      idempotencyKey,
      requestHash,
      duplicateWindowMinutes: usageConfig.duplicateWindowMinutes
    });

    if (duplicate) {
      await logApiUsage(supabase, {
        ...baseLogEntry,
        status: 'blocked',
        errorMessage: 'Duplicate send blocked',
        metadata: {
          reason: idempotencyKey ? 'duplicate_idempotency_key' : 'duplicate_request_hash',
          previous_request_id: duplicate.request_id,
          previous_created_at: duplicate.created_at
        }
      });

      return res.status(409).json({
        success: false,
        error: 'Duplicate send blocked.',
        previous_request_id: duplicate.request_id
      });
    }
  } catch (err) {
    await logApiUsage(supabase, {
      ...baseLogEntry,
      status: 'failed',
      errorMessage: err.message || 'Failed to enforce usage limits'
    });

    return res.status(err.statusCode || 500).json({
      success: false,
      error: err.message || 'Failed to enforce usage limits'
    });
  }

  const { data: template, error: lookupError } = await supabase
    .from(TABLE)
    .select('template_name, language, status, header, variables_order, mapping')
    .eq('channel', DEFAULT_CHANNEL)
    .eq('template_name', templateName)
    .eq('language', language)
    .maybeSingle();

  if (lookupError) {
    console.error('Supabase lookup failed for send-template', {
      runId,
      error: lookupError.message || lookupError
    });
    await logApiUsage(supabase, {
      ...baseLogEntry,
      status: 'failed',
      errorMessage: 'Failed to load template metadata from Supabase'
    });
    return res.status(500).json({
      success: false,
      error: 'Failed to load template metadata from Supabase'
    });
  }

  if (!template) {
    await logApiUsage(supabase, {
      ...baseLogEntry,
      status: 'failed',
      errorMessage: `Template "${templateName}" (language: ${language}) not found`
    });

    return res.status(404).json({
      success: false,
      error: `Template "${templateName}" (language: ${language}) not found in our records. Create it first via POST /templates.`
    });
  }

  const storedMapping = template.mapping;

  if (!storedMapping || typeof storedMapping !== 'object' || Array.isArray(storedMapping)) {
    await logApiUsage(supabase, {
      ...baseLogEntry,
      status: 'failed',
      errorMessage: `Template "${templateName}" is missing variable mapping metadata in Supabase`
    });

    return res.status(500).json({
      success: false,
      error: `Template "${templateName}" is missing variable mapping metadata in Supabase`
    });
  }

  let mapping;
  try {
    mapping = buildMappingFromStored(storedMapping, variables);
  } catch (err) {
    await logApiUsage(supabase, {
      ...baseLogEntry,
      status: 'failed',
      errorMessage: err.message || 'Failed to build template mapping'
    });

    return res.status(err.statusCode || 400).json({
      success: false,
      error: err.message || 'Failed to build template mapping'
    });
  }

  const imageUrlError = validateTemplateImageUrl(template.header, imageUrl);
  if (imageUrlError) {
    await logApiUsage(supabase, {
      ...baseLogEntry,
      status: 'failed',
      errorMessage: imageUrlError
    });

    return res.status(400).json({
      success: false,
      error: imageUrlError
    });
  }

  const payload = buildSendTemplatePayload({
    templateName,
    language,
    mapping,
    header: template.header,
    imageUrl
  });

  console.info('Forwarding send-template to ChakraHQ', {
    runId,
    templateName,
    language,
    mappingCount: mapping.length,
    phoneLast4: phone.slice(-4),
    status: template.status || 'unknown'
  });

  try {
    await sendWhatsAppMessage(phone, 'template', payload, runId);
    await logApiUsage(supabase, {
      ...baseLogEntry,
      status: 'sent',
      metadata: {
        mapping_count: mapping.length,
        template_status: template.status || 'unknown'
      }
    });

    return res.status(200).json({
      success: true,
      template_name: templateName,
      language,
      phone
    });
  } catch (err) {
    await logApiUsage(supabase, {
      ...baseLogEntry,
      status: 'failed',
      errorMessage: err.message || 'Failed to send template message',
      metadata: {
        mapping_count: mapping.length,
        template_status: template.status || 'unknown'
      }
    });

    return res.status(err.statusCode || 500).json({
      success: false,
      error: err.message || 'Failed to send template message'
    });
  }
});

module.exports = router;
module.exports.validateTemplateImageUrl = validateTemplateImageUrl;
module.exports.buildSendTemplatePayload = buildSendTemplatePayload;
module.exports.isPublicHttpsUrl = isPublicHttpsUrl;
module.exports.normalizeIdempotencyKey = normalizeIdempotencyKey;
