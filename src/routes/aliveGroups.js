const express = require('express');
const { getSupabaseClient } = require('../config/supabase');
const { requireApiKey } = require('../middleware/auth');

const TABLE = 'alive_group_exports';
const LATEST_ID = 'latest';

async function readGroupsResponse(supabase = getSupabaseClient()) {
  const { data, error } = await supabase
    .from(TABLE)
    .select('response, exported_at, last_attempt_at, last_error_at')
    .eq('id', LATEST_ID)
    .maybeSingle();

  if (error) {
    const routeError = new Error('Failed to load Alive groups export');
    routeError.statusCode = 500;
    throw routeError;
  }

  if (!data?.response) {
    const routeError = new Error('Alive groups export is not available');
    routeError.statusCode = 503;
    throw routeError;
  }

  return {
    response: data.response,
    exportedAt: data.exported_at || data.response.exportedAt,
    lastAttemptAt: data.last_attempt_at,
    stale: Boolean(data.last_error_at)
  };
}

function createAliveGroupsRouter(options = {}) {
  const router = express.Router();
  const supabase = options.supabase;

  router.get('/alive/groups', requireApiKey, async (_req, res) => {
    try {
      const latest = await readGroupsResponse(supabase);
      if (latest.stale) {
        res.set('X-Alive-Groups-Data-Status', 'stale');
        if (latest.exportedAt) {
          res.set('X-Alive-Groups-Exported-At', latest.exportedAt);
        }
        if (latest.lastAttemptAt) {
          res.set('X-Alive-Groups-Last-Attempt-At', latest.lastAttemptAt);
        }
      }
      return res.status(200).json(latest.response);
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
