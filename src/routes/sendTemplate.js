const express = require('express');
const { requireApiKey } = require('../middleware/auth');
const { getSupabaseClient } = require('../config/supabase');
const { buildPositionalMapping } = require('../services/templateMappingService');
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

router.post('/send-template', requireApiKey, async (req, res) => {
  const runId = newRunId();
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};

  const phone = normalizePhone(body.phone);
  const templateName = trimString(body.template_name);
  const language = trimString(body.language);
  const variables = body.variables;

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

  const { data: template, error: lookupError } = await supabase
    .from(TABLE)
    .select('template_name, language, status, variables_order')
    .eq('channel', DEFAULT_CHANNEL)
    .eq('template_name', templateName)
    .eq('language', language)
    .maybeSingle();

  if (lookupError) {
    console.error('Supabase lookup failed for send-template', {
      runId,
      error: lookupError.message || lookupError
    });
    return res.status(500).json({
      success: false,
      error: 'Failed to load template metadata from Supabase'
    });
  }

  if (!template) {
    return res.status(404).json({
      success: false,
      error: `Template "${templateName}" (language: ${language}) not found in our records. Create it first via POST /templates.`
    });
  }

  const variablesOrder = Array.isArray(template.variables_order) ? template.variables_order : [];

  let mapping;
  try {
    mapping = buildPositionalMapping(variablesOrder, variables);
  } catch (err) {
    return res.status(err.statusCode || 400).json({
      success: false,
      error: err.message || 'Failed to build template mapping'
    });
  }

  const payload = {
    template_name: templateName,
    language,
    mapping,
    header_mapping: [],
    button_mapping: []
  };

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
    return res.status(200).json({
      success: true,
      template_name: templateName,
      language,
      phone
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      error: err.message || 'Failed to send template message'
    });
  }
});

module.exports = router;
