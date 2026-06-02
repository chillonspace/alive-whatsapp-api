const crypto = require('crypto');

const TABLE = 'api_usage_logs';

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getUsageConfig(env = process.env) {
  return {
    sendTemplatePerMinute: parsePositiveInteger(env.SEND_TEMPLATE_RATE_LIMIT_PER_MINUTE, 60),
    sendTemplateDaily: parsePositiveInteger(env.SEND_TEMPLATE_DAILY_LIMIT, 1000),
    templateCreatePerHour: parsePositiveInteger(env.TEMPLATE_CREATE_RATE_LIMIT_PER_HOUR, 10),
    duplicateWindowMinutes: parsePositiveInteger(env.DUPLICATE_WINDOW_MINUTES, 10)
  };
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(',')}}`;
}

function hashValue(value) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

function buildSendTemplateRequestHash({ phone, templateName, language, variables, imageUrl }) {
  return hashValue({
    phone,
    template_name: templateName,
    language,
    variables,
    image_url: imageUrl || null
  });
}

function getIsoBefore(now, amountMs) {
  return new Date(now.getTime() - amountMs).toISOString();
}

async function countUsageSince(supabase, { endpoint, apiKeyLabel, since, statuses }) {
  let query = supabase
    .from(TABLE)
    .select('id', { count: 'exact', head: true })
    .eq('endpoint', endpoint)
    .eq('api_key_label', apiKeyLabel)
    .gte('created_at', since);

  if (Array.isArray(statuses) && statuses.length > 0) {
    query = query.in('status', statuses);
  }

  const { count, error } = await query;

  if (error) {
    const err = new Error('Failed to check API usage limits');
    err.statusCode = 500;
    err.upstream = error;
    throw err;
  }

  return count || 0;
}

async function checkUsageLimit(supabase, { endpoint, apiKeyLabel, limit, windowMs, statuses, now = new Date() }) {
  const since = getIsoBefore(now, windowMs);
  const currentCount = await countUsageSince(supabase, { endpoint, apiKeyLabel, since, statuses });

  return {
    allowed: currentCount < limit,
    currentCount,
    limit,
    retryAfterSeconds: Math.max(1, Math.ceil(windowMs / 1000))
  };
}

async function findDuplicateSend(supabase, {
  apiKeyLabel,
  idempotencyKey,
  requestHash,
  duplicateWindowMinutes,
  now = new Date()
}) {
  let query = supabase
    .from(TABLE)
    .select('id, request_id, status, created_at')
    .eq('endpoint', 'send-template')
    .eq('api_key_label', apiKeyLabel)
    .in('status', ['sent', 'accepted'])
    .order('created_at', { ascending: false })
    .limit(1);

  if (idempotencyKey) {
    query = query.eq('idempotency_key', idempotencyKey);
  } else {
    query = query
      .eq('request_hash', requestHash)
      .gte('created_at', getIsoBefore(now, duplicateWindowMinutes * 60 * 1000));
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    const err = new Error('Failed to check duplicate send');
    err.statusCode = 500;
    err.upstream = error;
    throw err;
  }

  return data || null;
}

async function logApiUsage(supabase, entry) {
  const { error } = await supabase.from(TABLE).insert({
    request_id: entry.requestId,
    endpoint: entry.endpoint,
    api_key_label: entry.apiKeyLabel,
    phone: entry.phone || null,
    phone_last4: entry.phone ? String(entry.phone).slice(-4) : null,
    template_name: entry.templateName || null,
    language: entry.language || null,
    idempotency_key: entry.idempotencyKey || null,
    request_hash: entry.requestHash || null,
    image_url_present: !!entry.imageUrlPresent,
    variables_keys: Array.isArray(entry.variablesKeys) ? entry.variablesKeys : [],
    status: entry.status,
    error_message: entry.errorMessage || null,
    metadata: entry.metadata || {}
  });

  if (error) {
    console.error('Failed to write API usage log', {
      requestId: entry.requestId,
      endpoint: entry.endpoint,
      status: entry.status,
      error: error.message || error
    });
  }
}

module.exports = {
  getUsageConfig,
  stableStringify,
  hashValue,
  buildSendTemplateRequestHash,
  checkUsageLimit,
  findDuplicateSend,
  logApiUsage
};
