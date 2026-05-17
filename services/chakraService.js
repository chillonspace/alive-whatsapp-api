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
        ...(payload.caption ? { caption } : {})
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

function isConfiguredValue(value) {
  return typeof value === 'string' && value.trim() !== '' && !value.trim().startsWith('replace_with_');
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return '';
}

function getChakraResponseSummary(data) {
  if (!data) {
    return {};
  }

  if (typeof data === 'string') {
    return { raw: data.slice(0, 500) };
  }

  if (typeof data !== 'object' || Array.isArray(data)) {
    return { raw: data };
  }

  const metaError = data.error && typeof data.error === 'object' ? data.error : {};

  return {
    message: data.message || metaError.message || '',
    error: typeof data.error === 'string' ? data.error : '',
    errorDetails: metaError.error_data?.details || '',
    errorCode: metaError.code || data.code || '',
    errorType: metaError.type || data.type || '',
    errors: Array.isArray(data._errors) ? data._errors.slice(0, 3) : []
  };
}

function getUpstreamErrorMessage(err) {
  const data = err.response?.data;

  if (typeof data === 'string' && data.trim()) {
    return data.trim();
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return '';
  }

  const metaError = data.error && typeof data.error === 'object' ? data.error : {};

  return firstString(
    data.message,
    metaError.error_data?.details,
    metaError.message,
    typeof data.error === 'string' ? data.error : '',
    Array.isArray(data._errors) ? data._errors[0] : ''
  );
}

function validateConfig(messageType, config) {
  const { accessToken, pluginId, apiVersion, phoneNumberId } = config;

  if (!isConfiguredValue(accessToken) || !isConfiguredValue(pluginId) || !isConfiguredValue(phoneNumberId)) {
    const error = new Error('Server configuration is incomplete: Chakra credentials or phone number ID are not configured');
    error.statusCode = 500;
    throw error;
  }

  if (messageType !== 'template' && !isConfiguredValue(apiVersion)) {
    const error = new Error('Server configuration is incomplete: Chakra API version is not configured');
    error.statusCode = 500;
    throw error;
  }
}

async function sendTemplateMessage(phone, payload, pluginId, phoneNumberId, accessToken) {
  const url = buildTemplateUrl(pluginId, phone);
  const chakraPayload = buildTemplatePayload(phoneNumberId, payload);

  const response = await axios.post(url, chakraPayload, getRequestConfig(accessToken));
  const data = response.data || {};

  console.info('Chakra template send response', {
    status: response.status,
    hasData: !!data._data,
    whatsappMessageId: data._data?.whatsappMessageId || data._data?.externalId || null,
    deliveryStatus: data._data?.deliveryStatus || null,
    errors: Array.isArray(data._errors) ? data._errors : null
  });

  if (Array.isArray(data._errors) && data._errors.length > 0) {
    const error = new Error(data._errors.join('; ') || 'ChakraHQ returned errors in send response');
    error.statusCode = 502;
    throw error;
  }

  return data;
}

async function sendWhatsAppMessage(phone, messageType, payload, runId = 'unknown') {
  const accessToken = process.env.CHAKRA_ACCESS_TOKEN;
  const pluginId = process.env.CHAKRA_PLUGIN_ID;
  const apiVersion = process.env.CHAKRA_WA_API_VERSION;
  const phoneNumberId = process.env.CHAKRA_PHONE_NUMBER_ID;

  console.info('Preparing Chakra message request', {
    runId,
    messageType,
    hasAccessToken: !!accessToken,
    hasPluginId: !!pluginId,
    hasApiVersion: !!apiVersion,
    hasPhoneNumberId: !!phoneNumberId,
    apiVersion: apiVersion || ''
  });

  validateConfig(messageType, { accessToken, pluginId, apiVersion, phoneNumberId });

  try {
    if (messageType === 'template') {
      console.info('Posting Chakra template message', {
        runId,
        phoneLast4: phone ? String(phone).slice(-4) : '',
        templateName: payload.template_name,
        mappingCount: payload.mapping.length,
        headerMappingCount: payload.header_mapping.length,
        buttonMappingCount: payload.button_mapping.length
      });

      await sendTemplateMessage(phone, payload, pluginId, phoneNumberId, accessToken);
    } else {
      const url = buildGenericMessageUrl(pluginId, apiVersion, phoneNumberId);
      const chakraPayload = buildGenericMessagePayload(phone, messageType, payload);

      console.info('Posting Chakra session message', {
        runId,
        messageType,
        phoneLast4: phone ? String(phone).slice(-4) : '',
        payloadShape: {
          topLevelKeys: Object.keys(chakraPayload),
          type: chakraPayload.type,
          hasTextBody: !!chakraPayload.text?.body,
          textLength: typeof chakraPayload.text?.body === 'string' ? chakraPayload.text.body.length : 0,
          hasImageLink: !!chakraPayload.image?.link
        }
      });

      await axios.post(url, chakraPayload, getRequestConfig(accessToken));
    }
  } catch (err) {
    console.error('Chakra request failed', {
      runId,
      status: err.response?.status || null,
      code: err.code || '',
      message: err.message || '',
      response: getChakraResponseSummary(err.response?.data)
    });

    const upstreamError = getUpstreamErrorMessage(err);

    const error = new Error(
      upstreamError || 'Failed to send message through ChakraHQ'
    );

    error.statusCode = err.response?.status || 500;
    throw error;
  }
}

module.exports = {
  sendWhatsAppMessage,
  buildTemplatePayload
};
