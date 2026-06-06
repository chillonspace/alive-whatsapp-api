const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const SHARED_ALIVE_ENV_PATH = '/Users/chillon/Documents/Codex/shared/alive.env';

function loadEnv(options = {}) {
  const sharedEnvPath = options.sharedEnvPath || SHARED_ALIVE_ENV_PATH;
  const localEnvPath = options.localEnvPath || path.join(process.cwd(), '.env');

  if (fs.existsSync(sharedEnvPath)) {
    dotenv.config({ path: sharedEnvPath, quiet: true });
  }

  if (fs.existsSync(localEnvPath)) {
    dotenv.config({ path: localEnvPath, quiet: true });
  }
}

module.exports = {
  loadEnv,
  SHARED_ALIVE_ENV_PATH
};
