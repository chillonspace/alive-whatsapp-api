function requireApiKey(req, res, next) {
  const configuredApiKey = process.env.CLIENT_API_KEY;
  const apiKeyLabel = process.env.CLIENT_API_LABEL || 'client_main';

  if (!configuredApiKey) {
    return res.status(500).json({
      success: false,
      error: 'Server configuration is incomplete: CLIENT_API_KEY is not set'
    });
  }

  const providedHeader = req.get('X-API-Key') || req.get('x-api-key');
  const providedApiKey = typeof providedHeader === 'string' ? providedHeader.trim() : '';

  if (!providedApiKey || providedApiKey !== configuredApiKey) {
    return res.status(401).json({
      success: false,
      error: 'Invalid or missing X-API-Key header'
    });
  }

  req.apiKeyLabel = apiKeyLabel;

  return next();
}

module.exports = {
  requireApiKey
};
