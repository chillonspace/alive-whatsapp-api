const express = require('express');
const { requireApiKey } = require('../middleware/auth');
const { getSupabaseClient } = require('../config/supabase');
const { convertNamedPlaceholdersToPositional } = require('../services/templateMappingService');
const { createTemplate, listTemplates } = require('../services/chakraTemplateService');
const { checkUsageLimit, getUsageConfig, logApiUsage } = require('../services/apiUsageService');

const router = express.Router();

const SUPPORTED_CATEGORIES = new Set(['MARKETING', 'UTILITY']);
const SUPPORTED_LANGUAGES = new Set(['en', 'zh_CN']);
const SUPPORTED_HEADER_TYPES = new Set(['TEXT', 'IMAGE']);
const HEADER_TEXT_MAX_LENGTH = 60;
const TEMPLATE_NAME_PATTERN = /^[a-z0-9_]+$/;
const DEFAULT_CHANNEL = 'test';
const TABLE = 'whatsapp_templates';

function newRunId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function trimString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isPublicHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !!url.hostname;
  } catch (_err) {
    return false;
  }
}

function validateHeader(header) {
  if (header === undefined || header === null) {
    return null;
  }

  if (typeof header !== 'object' || Array.isArray(header)) {
    return 'header must be an object like { type: "TEXT", text: "..." } or { type: "IMAGE", example_url: "https://..." }';
  }

  const headerType = trimString(header.type).toUpperCase();
  if (!headerType) {
    return 'header.type is required when header is provided';
  }
  if (!SUPPORTED_HEADER_TYPES.has(headerType)) {
    return `header.type must be one of: ${Array.from(SUPPORTED_HEADER_TYPES).join(', ')}`;
  }

  if (headerType === 'TEXT') {
    const headerText = typeof header.text === 'string' ? header.text : '';
    if (!headerText.trim()) {
      return 'header.text is required and must be a non-empty string';
    }
    if (headerText.length > HEADER_TEXT_MAX_LENGTH) {
      return `header.text must be at most ${HEADER_TEXT_MAX_LENGTH} characters (Meta limit)`;
    }
    if (/{{\s*[a-zA-Z_][a-zA-Z0-9_]*\s*}}/.test(headerText)) {
      return 'header variables are not supported in this version; please use a plain text header';
    }
  }

  if (headerType === 'IMAGE') {
    if (trimString(header.text)) {
      return 'header.text is not supported when header.type is IMAGE';
    }

    const exampleUrl = trimString(header.example_url);
    if (!exampleUrl) {
      return 'header.example_url is required when header.type is IMAGE';
    }
    if (!isPublicHttpsUrl(exampleUrl)) {
      return 'header.example_url must be a public https URL';
    }
  }

  return null;
}

function normalizeHeader(header) {
  if (header === undefined || header === null) {
    return null;
  }

  const headerType = trimString(header.type).toUpperCase();

  if (headerType === 'TEXT') {
    return { type: 'TEXT', text: trimString(header.text) };
  }

  if (headerType === 'IMAGE') {
    return { type: 'IMAGE', example_url: trimString(header.example_url) };
  }

  return null;
}

function validateCreateBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return 'Request body is required';
  }

  const templateName = trimString(body.template_name);
  if (!templateName) {
    return 'template_name is required';
  }
  if (!TEMPLATE_NAME_PATTERN.test(templateName)) {
    return 'template_name must be lowercase letters, digits, and underscores only (no spaces)';
  }

  const category = trimString(body.category).toUpperCase();
  if (!category) {
    return 'category is required';
  }
  if (!SUPPORTED_CATEGORIES.has(category)) {
    return `category must be one of: ${Array.from(SUPPORTED_CATEGORIES).join(', ')}`;
  }

  const language = trimString(body.language);
  if (!language) {
    return 'language is required';
  }
  if (!SUPPORTED_LANGUAGES.has(language)) {
    return `language must be one of: ${Array.from(SUPPORTED_LANGUAGES).join(', ')}`;
  }

  const headerError = validateHeader(body.header);
  if (headerError) {
    return headerError;
  }

  if (body.footer !== undefined && body.footer !== null) {
    return 'footer is not supported in this version';
  }

  if (body.buttons !== undefined && body.buttons !== null) {
    return 'buttons are not supported in this version';
  }

  const text = typeof body.body === 'string' ? body.body : '';
  if (!text.trim()) {
    return 'body is required';
  }

  if (!Array.isArray(body.variables)) {
    return 'variables must be an array';
  }

  if (!body.examples || typeof body.examples !== 'object' || Array.isArray(body.examples)) {
    return 'examples must be an object';
  }

  for (const name of body.variables) {
    if (typeof name !== 'string' || !name.trim()) {
      return 'each variable name must be a non-empty string';
    }
    const exampleValue = body.examples[name];
    if (exampleValue === undefined || exampleValue === null || String(exampleValue).trim() === '') {
      return `examples.${name} is required`;
    }
  }

  return null;
}

router.post('/templates', requireApiKey, async (req, res) => {
  const runId = newRunId('tpl_create');
  const usageConfig = getUsageConfig();
  const apiKeyLabel = req.apiKeyLabel || 'client_main';
  const validationError = validateCreateBody(req.body);

  if (validationError) {
    return res.status(400).json({ success: false, error: validationError });
  }

  const channel = DEFAULT_CHANNEL;
  const templateName = trimString(req.body.template_name);
  const category = trimString(req.body.category).toUpperCase();
  const language = trimString(req.body.language);
  const bodyOriginal = req.body.body;
  const variables = req.body.variables;
  const examples = req.body.examples;
  const header = normalizeHeader(req.body.header);

  let bodyMeta;
  let variablesOrder;
  let mapping;

  try {
    const converted = convertNamedPlaceholdersToPositional(bodyOriginal, variables);
    bodyMeta = converted.bodyMeta;
    variablesOrder = converted.variablesOrder;
    mapping = converted.mapping;
  } catch (err) {
    return res.status(err.statusCode || 400).json({
      success: false,
      error: err.message || 'Failed to convert placeholders'
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

  const baseLogEntry = {
    requestId: runId,
    endpoint: 'templates-create',
    apiKeyLabel,
    templateName,
    language,
    imageUrlPresent: header?.type === 'IMAGE',
    variablesKeys: Array.isArray(variables) ? variables : []
  };

  try {
    const createLimit = await checkUsageLimit(supabase, {
      endpoint: 'templates-create',
      apiKeyLabel,
      limit: usageConfig.templateCreatePerHour,
      windowMs: 60 * 60 * 1000
    });

    if (!createLimit.allowed) {
      await logApiUsage(supabase, {
        ...baseLogEntry,
        status: 'blocked',
        errorMessage: 'Template create rate limit exceeded',
        metadata: {
          reason: 'template_create_hourly_limit',
          limit: createLimit.limit,
          currentCount: createLimit.currentCount
        }
      });

      return res.status(429).json({
        success: false,
        error: 'Template create rate limit exceeded. Please retry later.',
        retry_after_seconds: createLimit.retryAfterSeconds
      });
    }
  } catch (err) {
    await logApiUsage(supabase, {
      ...baseLogEntry,
      status: 'failed',
      errorMessage: err.message || 'Failed to enforce template create usage limits'
    });

    return res.status(err.statusCode || 500).json({
      success: false,
      error: err.message || 'Failed to enforce template create usage limits'
    });
  }

  let chakraResult;
  try {
    chakraResult = await createTemplate({
      runId,
      name: templateName,
      category,
      language,
      bodyMeta,
      examples,
      variablesOrder,
      header
    });
  } catch (err) {
    await logApiUsage(supabase, {
      ...baseLogEntry,
      status: 'failed',
      errorMessage: err.message || 'Failed to create template via ChakraHQ',
      metadata: { upstream: err.upstream || null }
    });

    return res.status(err.statusCode || 500).json({
      success: false,
      error: err.message || 'Failed to create template via ChakraHQ',
      upstream: err.upstream || undefined
    });
  }

  const chakraResponse = chakraResult.response || {};
  const status = chakraResponse.status || 'PENDING';
  const chakraTemplateId = chakraResponse.id || null;

  const row = {
    channel,
    template_name: templateName,
    category,
    language,
    status,
    body_original: bodyOriginal,
    body_meta: bodyMeta,
    header,
    variables_order: variablesOrder,
    mapping,
    examples,
    buttons: null,
    chakra_template_id: chakraTemplateId,
    raw_request: chakraResult.requestBody,
    raw_chakra_response: chakraResponse,
    updated_at: new Date().toISOString()
  };

  const { data: upserted, error: upsertError } = await supabase
    .from(TABLE)
    .upsert(row, { onConflict: 'channel,template_name,language' })
    .select()
    .single();

  if (upsertError) {
    console.error('Supabase upsert failed after Chakra create', {
      runId,
      error: upsertError.message || upsertError
    });

    await logApiUsage(supabase, {
      ...baseLogEntry,
      status: 'failed',
      errorMessage: 'Template was created in ChakraHQ but failed to save in Supabase',
      metadata: {
        chakra_template_id: chakraTemplateId,
        template_status: status,
        detail: upsertError.message || null
      }
    });

    return res.status(500).json({
      success: false,
      error: 'Template was created in ChakraHQ but failed to save in Supabase',
      detail: upsertError.message || null,
      chakra_template_id: chakraTemplateId,
      status
    });
  }

  await logApiUsage(supabase, {
    ...baseLogEntry,
    status: 'accepted',
    metadata: {
      chakra_template_id: upserted.chakra_template_id || null,
      template_status: upserted.status || null
    }
  });

  return res.status(201).json({
    success: true,
    template_name: upserted.template_name,
    language: upserted.language,
    status: upserted.status,
    chakra_template_id: upserted.chakra_template_id
  });
});

function extractBodyComponent(components) {
  if (!Array.isArray(components)) {
    return null;
  }

  return components.find(
    (component) => component && typeof component === 'object' && component.type === 'BODY'
  );
}

function extractHeaderComponent(components) {
  if (!Array.isArray(components)) {
    return null;
  }

  const headerComponent = components.find(
    (component) => component && typeof component === 'object' && component.type === 'HEADER'
  );

  if (!headerComponent) {
    return null;
  }

  const format = typeof headerComponent.format === 'string'
    ? headerComponent.format.toUpperCase()
    : null;

  if (format === 'TEXT') {
    return { type: 'TEXT', text: headerComponent.text || '' };
  }

  return { type: format || 'UNKNOWN' };
}

router.get('/templates', requireApiKey, async (req, res) => {
  const runId = newRunId('tpl_list');
  const channel = DEFAULT_CHANNEL;

  let chakraTemplates;
  try {
    chakraTemplates = await listTemplates({ runId });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      error: err.message || 'Failed to list templates from ChakraHQ'
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

  const { data: supabaseRows, error: selectError } = await supabase
    .from(TABLE)
    .select('*')
    .eq('channel', channel);

  if (selectError) {
    console.error('Supabase select failed during list', {
      runId,
      error: selectError.message || selectError
    });

    return res.status(500).json({
      success: false,
      error: 'Failed to load template metadata from Supabase'
    });
  }

  const supabaseIndex = new Map();
  for (const row of supabaseRows || []) {
    const key = `${row.template_name}::${row.language}`;
    supabaseIndex.set(key, row);
  }

  const merged = chakraTemplates.map((tpl) => {
    const templateName = tpl.name || null;
    const language = tpl.language || null;
    const bodyComponent = extractBodyComponent(tpl.components);
    const bodyMeta = bodyComponent?.text || null;
    const headerFromChakra = extractHeaderComponent(tpl.components);

    const supabaseRow = templateName && language
      ? supabaseIndex.get(`${templateName}::${language}`)
      : null;

    return {
      template_name: templateName,
      category: tpl.category || null,
      language,
      status: tpl.status || null,
      header: supabaseRow?.header || headerFromChakra || null,
      body_meta: bodyMeta,
      body_original: supabaseRow?.body_original || null,
      variables_order: supabaseRow?.variables_order || null,
      mapping: supabaseRow?.mapping || null,
      examples: supabaseRow?.examples || null,
      chakra_template_id: tpl.id || supabaseRow?.chakra_template_id || null,
      channel
    };
  });

  return res.status(200).json({
    success: true,
    templates: merged
  });
});

module.exports = router;
module.exports.validateCreateBody = validateCreateBody;
module.exports.normalizeHeader = normalizeHeader;
module.exports.isPublicHttpsUrl = isPublicHttpsUrl;
