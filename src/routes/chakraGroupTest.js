const express = require('express');
const { requireApiKey } = require('../middleware/auth');
const {
  appendWebhookPayload,
  detectGroupEvent,
  executeGroupMemberListTest
} = require('../services/chakraGroupTestService');

const router = express.Router();

router.post('/webhooks/chakra/group-test', async (req, res) => {
  const payload = req.body;
  const detection = detectGroupEvent(payload);

  console.info('Chakra group webhook test payload', {
    possibleGroupEvent: detection.possibleGroupEvent,
    detectedKeywords: detection.detectedKeywords,
    payload
  });

  try {
    const logPath = await appendWebhookPayload(payload, detection);
    console.info('Chakra group webhook test payload saved', { logPath });
  } catch (err) {
    console.error('Failed to save Chakra group webhook test payload', {
      message: err.message || 'Unknown file error'
    });
  }

  return res.status(200).json({
    ok: true,
    message: 'Webhook received',
    possibleGroupEvent: detection.possibleGroupEvent
  });
});

router.get('/debug/chakra/group-member-list-test', requireApiKey, async (_req, res) => {
  try {
    const report = await executeGroupMemberListTest();
    return res.status(200).json(report);
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      ok: false,
      error: err.message || 'Failed to run Chakra group member list test'
    });
  }
});

module.exports = router;
