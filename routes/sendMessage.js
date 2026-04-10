const express = require('express');
const { sendWhatsAppMessage } = require('../services/chakraService');

const router = express.Router();

function normalizePhone(phone) {
  return String(phone).replace(/[\s\-+]/g, '').trim();
}

router.post('/send-message', async (req, res) => {
  const { api_key, phone, message } = req.body || {};
  const configuredApiKey = process.env.CLIENT_API_KEY;
  const providedApiKey = typeof api_key === 'string' ? api_key.trim() : '';
  const normalizedPhone = phone ? normalizePhone(phone) : '';
  const messageBody = typeof message === 'string' ? message.trim() : '';

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

  if (!normalizedPhone || !messageBody) {
    return res.status(400).json({
      success: false,
      error: 'phone and message are required'
    });
  }

  try {
    await sendWhatsAppMessage(normalizedPhone, messageBody);

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
