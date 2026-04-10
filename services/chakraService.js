const axios = require('axios');

function mapTemplateMappings(items) {
  return items.map((item) => ({
    schemaPropertyName: item.schema_property_name,
    schemaPropertyValue: item.schema_property_value
  }));
}

function buildGenericMessagePayload(phone, messageType, payload) {
  if (messageType === 'text') {
    return {
      messaging_product: 'whatsapp',
      to: phone,
      type: 'text',
      text: {
        body: payload.text
      }
    };
  }

  if (messageType === 'image') {
    return {
      messaging_product: 'whatsapp',
      to: phone,
      type: 'image',
      image: {
        link: payload.image_url,
        ...(payload.caption ? { caption: payload.caption } : {})
      }
    };
  }

  const error = new Error('Unsupported message type');
  error.statusCode = 400;
  throw error;
}

function buildTemplatePayload(phoneNumberId, payload) {
  return {
    whatsappPhoneNumberId: String(phoneNumberId),
    templateName: payload.template_name,
    ...(payload.mapping.length > 0 ? { mapping: mapTemplateMappings(payload.mapping) } : {}),
    ...(payload.header_mapping.length > 0
      ? { headerMapping: mapTemplateMappings(payload.header_mapping) }
      : {}),
    ...(payload.button_mapping.length > 0
      ? { buttonMapping: mapTemplateMappings(payload.button_mapping) }
      : {}),
    ...(payload.language ? { language: payload.language } : {}),
    ...(payload.image_url ? { imageUrl: payload.image_url } : {}),
    ...(payload.video_url ? { videoUrl: payload.video_url } : {}),
    ...(payload.document_url ? { documentUrl: payload.document_url } : {}),
    ...(payload.filename ? { filename: payload.filename } : {}),
    ...(payload.location?.latitude !== undefined
      ? { locationLatitude: payload.location.latitude }
      : {}),
    ...(payload.location?.longitude !== undefined
      ? { locationLongitude: payload.location.longitude }
      : {}),
    ...(payload.location?.name ? { locationName: payload.location.name } : {}),
    ...(payload.location?.address ? { locationAddress: payload.location.address } : {})
  };
}

function getRequestConfig(accessToken) {
  return {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  };
}

function buildTemplateUrl(pluginId, phone) {
  return `https://api.chakrahq.com/v1/ext/plugin/whatsapp/${pluginId}/phoneNumber/${phone}/send-template-message`;
}

function buildGenericMessageUrl(pluginId, apiVersion, phoneNumberId) {
  return `https://api.chakrahq.com/v1/ext/plugin/whatsapp/${pluginId}/api/${apiVersion}/${phoneNumberId}/messages`;
}

function validateConfig(messageType, config) {
  const { accessToken, pluginId, apiVersion, phoneNumberId } = config;

  if (!accessToken || !pluginId || !phoneNumberId) {
    const error = new Error('Server configuration is incomplete');
    error.statusCode = 500;
    throw error;
  }

  if (messageType !== 'template' && !apiVersion) {
    const error = new Error('Server configuration is incomplete');
    error.statusCode = 500;
    throw error;
  }
}

async function sendTemplateMessage(phone, payload, pluginId, phoneNumberId, accessToken) {
  const url = buildTemplateUrl(pluginId, phone);
  const chakraPayload = buildTemplatePayload(phoneNumberId, payload);

  await axios.post(url, chakraPayload, getRequestConfig(accessToken));
}

async function sendWhatsAppMessage(phone, messageType, payload) {
  const accessToken = process.env.CHAKRA_ACCESS_TOKEN;
  const pluginId = process.env.CHAKRA_PLUGIN_ID;
  const apiVersion = process.env.CHAKRA_WA_API_VERSION;
  const phoneNumberId = process.env.CHAKRA_PHONE_NUMBER_ID;

  validateConfig(messageType, { accessToken, pluginId, apiVersion, phoneNumberId });

  try {
    if (messageType === 'template') {
      await sendTemplateMessage(phone, payload, pluginId, phoneNumberId, accessToken);
    } else {
      const url = buildGenericMessageUrl(pluginId, apiVersion, phoneNumberId);
      const chakraPayload = buildGenericMessagePayload(phone, messageType, payload);

      await axios.post(url, chakraPayload, getRequestConfig(accessToken));
    }
  } catch (err) {
    const upstreamError =
      err.response?.data?.message ||
      err.response?.data?.error?.message ||
      err.response?.data?.error ||
      'Failed to send message through ChakraHQ';

    const error = new Error(
      typeof upstreamError === 'string'
        ? upstreamError
        : 'Failed to send message through ChakraHQ'
    );

    error.statusCode = err.response?.status || 500;
    throw error;
  }
}

module.exports = {
  sendWhatsAppMessage
};
