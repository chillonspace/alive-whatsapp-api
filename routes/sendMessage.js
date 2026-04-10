const express = require('express');
const { sendWhatsAppMessage } = require('../services/chakraService');

const router = express.Router();
const SUPPORTED_MESSAGE_TYPES = new Set(['text', 'image', 'template']);

function normalizePhone(phone) {
  return String(phone).replace(/[\s\-+]/g, '').trim();
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeMappingArray(fieldName, items) {
  if (items == null) {
    return { value: [] };
  }

  if (!Array.isArray(items)) {
    return { error: `${fieldName} must be an array` };
  }

  const normalizedItems = [];

  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return {
        error: `${fieldName} items must be objects with schema_property_name and schema_property_value`
      };
    }

    const schemaPropertyName = normalizeString(item.schema_property_name);
    const schemaPropertyValue = normalizeString(item.schema_property_value);

    if (!schemaPropertyName || !schemaPropertyValue) {
      return {
        error: `${fieldName} items must include schema_property_name and schema_property_value`
      };
    }

    normalizedItems.push({
      schema_property_name: schemaPropertyName,
      schema_property_value: schemaPropertyValue
    });
  }

  return { value: normalizedItems };
}

function normalizeLocation(location) {
  if (location == null) {
    return { value: undefined };
  }

  if (!location || typeof location !== 'object' || Array.isArray(location)) {
    return { error: 'payload.location must be an object' };
  }

  const latitude =
    location.latitude === undefined || location.latitude === null || location.latitude === ''
      ? undefined
      : Number(location.latitude);
  const longitude =
    location.longitude === undefined || location.longitude === null || location.longitude === ''
      ? undefined
      : Number(location.longitude);

  if (latitude !== undefined && !Number.isFinite(latitude)) {
    return { error: 'payload.location.latitude must be a valid number' };
  }

  if (longitude !== undefined && !Number.isFinite(longitude)) {
    return { error: 'payload.location.longitude must be a valid number' };
  }

  const name = normalizeString(location.name);
  const address = normalizeString(location.address);

  return {
    value: {
      ...(latitude !== undefined ? { latitude } : {}),
      ...(longitude !== undefined ? { longitude } : {}),
      ...(name ? { name } : {}),
      ...(address ? { address } : {})
    }
  };
}

function normalizePayload(messageType, payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { error: 'payload is required' };
  }

  if (messageType === 'text') {
    const text = normalizeString(payload.text);

    if (!text) {
      return { error: 'payload.text is required for text messages' };
    }

    return { value: { text } };
  }

  if (messageType === 'image') {
    const imageUrl = normalizeString(payload.image_url);
    const caption = normalizeString(payload.caption);

    if (!imageUrl) {
      return { error: 'payload.image_url is required for image messages' };
    }

    return {
      value: {
        image_url: imageUrl,
        ...(caption ? { caption } : {})
      }
    };
  }

  if (messageType === 'template') {
    const templateName = normalizeString(payload.template_name);
    const language = normalizeString(payload.language);
    const imageUrl = normalizeString(payload.image_url);
    const videoUrl = normalizeString(payload.video_url);
    const documentUrl = normalizeString(payload.document_url);
    const filename = normalizeString(payload.filename);
    const mapping = normalizeMappingArray('payload.mapping', payload.mapping);
    const headerMapping = normalizeMappingArray('payload.header_mapping', payload.header_mapping);
    const buttonMapping = normalizeMappingArray('payload.button_mapping', payload.button_mapping);
    const location = normalizeLocation(payload.location);

    if (!templateName) {
      return {
        error: 'payload.template_name is required for template messages'
      };
    }

    if (mapping.error || headerMapping.error || buttonMapping.error || location.error) {
      return {
        error:
          mapping.error ||
          headerMapping.error ||
          buttonMapping.error ||
          location.error
      };
    }

    return {
      value: {
        template_name: templateName,
        mapping: mapping.value,
        header_mapping: headerMapping.value,
        button_mapping: buttonMapping.value,
        ...(language ? { language } : {}),
        ...(imageUrl ? { image_url: imageUrl } : {}),
        ...(videoUrl ? { video_url: videoUrl } : {}),
        ...(documentUrl ? { document_url: documentUrl } : {}),
        ...(filename ? { filename } : {}),
        ...(location.value && Object.keys(location.value).length > 0
          ? { location: location.value }
          : {})
      }
    };
  }

  return { error: 'Unsupported message type' };
}

router.post('/send-message', async (req, res) => {
  const { api_key, phone, message_type, payload } = req.body || {};
  const configuredApiKey = process.env.CLIENT_API_KEY;
  const providedApiKey = normalizeString(api_key);
  const normalizedPhone = phone ? normalizePhone(phone) : '';
  const messageType = normalizeString(message_type).toLowerCase();

  if (!configuredApiKey) {
    return res.status(500).json({
      success: false,
      error: 'Server configuration is incomplete'
    });
  }

  if (!providedApiKey || providedApiKey !== configuredApiKey) {
    return res.status(401).json({
      success: false,
      error: 'Invalid API key'
    });
  }

  if (!normalizedPhone) {
    return res.status(400).json({
      success: false,
      error: 'phone is required'
    });
  }

  if (!SUPPORTED_MESSAGE_TYPES.has(messageType)) {
    return res.status(400).json({
      success: false,
      error: 'message_type must be text, image, or template'
    });
  }

  const normalizedPayload = normalizePayload(messageType, payload);

  if (normalizedPayload.error) {
    return res.status(400).json({
      success: false,
      error: normalizedPayload.error
    });
  }

  try {
    await sendWhatsAppMessage(normalizedPhone, messageType, normalizedPayload.value);

    return res.status(200).json({
      success: true,
      message: 'Message sent successfully'
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || 'Failed to send message'
    });
  }
});

module.exports = router;
