const fs = require('fs/promises');
const express = require('express');
const { requireApiKey } = require('../middleware/auth');

const DEFAULT_GROUPS_RESPONSE_PATH =
  '/Users/chillon/Documents/Alive Group Monitor/private-exports/alive-groups-response.json';

async function readGroupsResponse(responsePath = DEFAULT_GROUPS_RESPONSE_PATH) {
  let raw;

  try {
    raw = await fs.readFile(responsePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      const error = new Error('Alive groups export is not available');
      error.statusCode = 503;
      throw error;
    }

    const error = new Error('Failed to read Alive groups export');
    error.statusCode = 500;
    throw error;
  }

  try {
    return JSON.parse(raw);
  } catch (_err) {
    const error = new Error('Alive groups export is invalid');
    error.statusCode = 500;
    throw error;
  }
}

function createAliveGroupsRouter(options = {}) {
  const router = express.Router();
  const responsePath = options.responsePath || DEFAULT_GROUPS_RESPONSE_PATH;

  router.get('/alive/groups', requireApiKey, async (_req, res) => {
    try {
      const body = await readGroupsResponse(responsePath);
      return res.status(200).json(body);
    } catch (err) {
      return res.status(err.statusCode || 500).json({
        success: false,
        error: err.message || 'Failed to load Alive groups export'
      });
    }
  });

  return router;
}

module.exports = createAliveGroupsRouter();
module.exports.createAliveGroupsRouter = createAliveGroupsRouter;
module.exports.readGroupsResponse = readGroupsResponse;
module.exports.DEFAULT_GROUPS_RESPONSE_PATH = DEFAULT_GROUPS_RESPONSE_PATH;
