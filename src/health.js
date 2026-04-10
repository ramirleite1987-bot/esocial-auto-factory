'use strict';

const http = require('http');
const logger = require('./utils/logger').child({ context: 'health' });

const HEALTH_PORT = Number(process.env.HEALTH_PORT) || 3000;

let lastJobRun = null;
let lastJobStatus = null;

/**
 * Record the result of the last job run.
 * @param {'success'|'error'} status
 */
function recordJobRun(status) {
  lastJobRun = new Date().toISOString();
  lastJobStatus = status;
}

/**
 * Start a minimal HTTP health check server.
 * Responds to GET /health with JSON status.
 */
function startHealthServer() {
  if (process.env.HEALTH_ENABLED !== 'true') {
    logger.debug('Health check server disabled (set HEALTH_ENABLED=true to enable)');
    return null;
  }

  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      const payload = {
        status: 'ok',
        uptime: Math.floor(process.uptime()),
        nodeVersion: process.version,
        lastJobRun,
        lastJobStatus,
        timestamp: new Date().toISOString(),
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
      return;
    }

    res.writeHead(404);
    res.end();
  });

  server.listen(HEALTH_PORT, () => {
    logger.info(`Health check server listening on port ${HEALTH_PORT}`);
  });

  server.on('error', (err) => {
    logger.error(`Health check server error: ${err.message}`);
  });

  return server;
}

module.exports = { startHealthServer, recordJobRun };
