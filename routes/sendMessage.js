const express = require('express');
const { sendWhatsAppMessage } = require('../services/chakraService');

const router = express.Router();

function normalizePhone(phone) {
  return String(phone).replace(/[\s\-+]/g, '');
}

router.post('/send-message', async (req, res) => {
  const { api_key, phone, message } = req.body || {};

  if (api_key !== process.env.CLIENT_API_KEY) {
    return res.status(401).json({
      success: false,
      error: 'Invalid API key'
    });
  }

  if (!phone || !message) {
    return res.status(400).json({
      success: false,
      error: 'phone and message are required'
    });
  }

  const normalizedPhone = normalizePhone(phone);

  if (!normalizedPhone) {
    return res.status(400).json({
      success: false,
      error: 'Invalid phone number'
    });
  }

  try {
    await sendWhatsAppMessage(normalizedPhone, String(message));

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
