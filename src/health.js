'use strict';

const http = require('http');
const logger = require('./utils/logger').child({ context: 'health' });

function resolveHealthPort() {
  const raw = process.env.HEALTH_PORT;
  if (raw === undefined || raw === '') return 3000;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 65535) return 3000;
  return parsed;
}

const PROCESS_START_MS = Date.now();

let lastJobRun = null;
let lastJobStatus = null;
let lastJobTimestampSeconds = null;
const jobRunsTotal = { success: 0, error: 0 };

/**
 * Record the result of the last job run.
 * Updates aggregate counters used by the /metrics endpoint.
 * @param {'success'|'error'} status
 */
function recordJobRun(status) {
  lastJobRun = new Date().toISOString();
  lastJobStatus = status;
  lastJobTimestampSeconds = Math.floor(Date.now() / 1000);
  if (status === 'success' || status === 'error') {
    jobRunsTotal[status] += 1;
  }
}

/**
 * Render Prometheus text-format metrics for the current process.
 * @returns {string}
 */
function renderMetrics() {
  const uptimeSeconds = Math.floor((Date.now() - PROCESS_START_MS) / 1000);
  const lines = [
    '# HELP esocial_uptime_seconds Process uptime in seconds.',
    '# TYPE esocial_uptime_seconds gauge',
    `esocial_uptime_seconds ${uptimeSeconds}`,
    '# HELP esocial_job_runs_total Total number of job executions by status.',
    '# TYPE esocial_job_runs_total counter',
    `esocial_job_runs_total{status="success"} ${jobRunsTotal.success}`,
    `esocial_job_runs_total{status="error"} ${jobRunsTotal.error}`,
    '# HELP esocial_last_job_timestamp_seconds Unix timestamp of the last job run (0 if none).',
    '# TYPE esocial_last_job_timestamp_seconds gauge',
    `esocial_last_job_timestamp_seconds ${lastJobTimestampSeconds || 0}`,
  ];
  return lines.join('\n') + '\n';
}

/**
 * Reset internal counters and last-run state. Intended for tests.
 */
function _resetForTests() {
  lastJobRun = null;
  lastJobStatus = null;
  lastJobTimestampSeconds = null;
  jobRunsTotal.success = 0;
  jobRunsTotal.error = 0;
}

/**
 * Start a minimal HTTP health check server.
 * Routes:
 *   GET /health   → JSON status
 *   GET /metrics  → Prometheus text-format metrics
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
        jobRunsTotal: { ...jobRunsTotal },
        timestamp: new Date().toISOString(),
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
      return;
    }

    if (req.method === 'GET' && req.url === '/metrics') {
      res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
      res.end(renderMetrics());
      return;
    }

    res.writeHead(404);
    res.end();
  });

  const port = resolveHealthPort();
  server.listen(port, () => {
    logger.info(`Health check server listening on port ${server.address().port}`);
  });

  server.on('error', (err) => {
    logger.error(`Health check server error: ${err.message}`);
  });

  return server;
}

module.exports = { startHealthServer, recordJobRun, renderMetrics, _resetForTests };
