const crypto = require('crypto');

const TABLE = 'alive_group_pull_receipts';
const DEFAULT_TIMEOUT_MS = 1000;

function logReceiptFailure(entry, error) {
  console.error('Failed to write Alive groups pull receipt', {
    consumerId: entry.consumerId,
    responseStatus: entry.responseStatus,
    exportedAt: entry.exportedAt || null,
    error: error?.message || 'Unknown receipt error'
  });
}

async function logAliveGroupPullReceipt(supabase, entry, options = {}) {
  try {
    const query = supabase.from(TABLE).insert({
      id: crypto.randomUUID(),
      consumer_id: entry.consumerId,
      response_status: entry.responseStatus,
      exported_at: entry.exportedAt || null,
      success: entry.responseStatus >= 200 && entry.responseStatus < 300
    });
    const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
      ? options.timeoutMs
      : DEFAULT_TIMEOUT_MS;
    const request = typeof query.abortSignal === 'function'
      ? query.abortSignal(AbortSignal.timeout(timeoutMs))
      : query;
    const { error } = await request;

    if (!error) {
      return;
    }

    logReceiptFailure(entry, error);
  } catch (error) {
    logReceiptFailure(entry, error);
  }
}

module.exports = {
  logAliveGroupPullReceipt
};
