const axios = require('axios');

async function sendWhatsAppMessage(phone, message) {
  const accessToken = process.env.CHAKRA_ACCESS_TOKEN;
  const pluginId = process.env.CHAKRA_PLUGIN_ID;
  const apiVersion = process.env.CHAKRA_WA_API_VERSION;
  const phoneNumberId = process.env.CHAKRA_PHONE_NUMBER_ID;

  if (!accessToken || !pluginId || !apiVersion || !phoneNumberId) {
    const error = new Error('Server configuration is incomplete');
    error.statusCode = 500;
    throw error;
  }

  const url = `https://api.chakrahq.com/v1/ext/plugin/whatsapp/${pluginId}/api/${apiVersion}/${phoneNumberId}/messages`;

  try {
    await axios.post(
      url,
      {
        messaging_product: 'whatsapp',
        to: phone,
        type: 'text',
        text: {
          body: message
        }
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
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
