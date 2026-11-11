'use strict';

const http = require('http');

const TEST_TOKEN = 'test-health-token';

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ res, data }));
    }).on('error', reject);
  });
}

function whenListening(server) {
  return new Promise((resolve, reject) => {
    if (server.listening) return resolve();
    server.once('listening', resolve);
    server.once('error', reject);
  });
}

describe('health module', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.HEALTH_ENABLED;
    delete process.env.HEALTH_PORT;
    delete process.env.HEALTH_TOKEN;
    delete process.env.HEALTH_HOST;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('recordJobRun records success status', () => {
    const { recordJobRun } = require('../src/health');
    recordJobRun('success');
  });

  test('recordJobRun records error status', () => {
    const { recordJobRun } = require('../src/health');
    recordJobRun('error');
  });

  test('startHealthServer returns null when HEALTH_ENABLED is not true', () => {
    delete process.env.HEALTH_ENABLED;
    const { startHealthServer } = require('../src/health');
    const server = startHealthServer();
    expect(server).toBeNull();
  });

  test('startHealthServer returns null when HEALTH_ENABLED is true but HEALTH_TOKEN is unset', () => {
    process.env.HEALTH_ENABLED = 'true';
    process.env.HEALTH_PORT = '0';
    const { startHealthServer } = require('../src/health');
    const server = startHealthServer();
    expect(server).toBeNull();
  });

  test('startHealthServer starts and responds to /health with a valid Bearer token', (done) => {
    process.env.HEALTH_ENABLED = 'true';
    process.env.HEALTH_PORT = '0';
    process.env.HEALTH_TOKEN = TEST_TOKEN;
    const { startHealthServer } = require('../src/health');
    const server = startHealthServer();
    expect(server).not.toBeNull();

    whenListening(server).then(async () => {
      try {
        const addr = server.address();
        expect(addr.address).toBe('127.0.0.1');
        const port = addr.port;
        const auth = { Authorization: `Bearer ${TEST_TOKEN}` };

        const { res, data } = await httpGet(`http://127.0.0.1:${port}/health`, auth);
        const body = JSON.parse(data);
        expect(res.statusCode).toBe(200);
        expect(body.status).toBe('ok');
        expect(body).toHaveProperty('uptime');
        expect(body).toHaveProperty('nodeVersion');
        expect(body).toHaveProperty('timestamp');
        expect(body).toHaveProperty('jobRunsTotal');

        const unknown = await httpGet(`http://127.0.0.1:${port}/unknown`, auth);
        expect(unknown.res.statusCode).toBe(404);
        server.close(done);
      } catch (err) {
        server.close(() => done(err));
      }
    }).catch(done);
  }, 10000);

  test('unauthenticated GET /health and /metrics return 401 without telemetry', (done) => {
    process.env.HEALTH_ENABLED = 'true';
    process.env.HEALTH_PORT = '0';
    process.env.HEALTH_TOKEN = TEST_TOKEN;
    const { startHealthServer, recordJobRun, _resetForTests } = require('../src/health');
    _resetForTests();
    recordJobRun('success');
    const server = startHealthServer();

    whenListening(server).then(async () => {
      try {
        const port = server.address().port;

        const health = await httpGet(`http://127.0.0.1:${port}/health`);
        expect(health.res.statusCode).toBe(401);
        expect(health.data).not.toContain('nodeVersion');
        expect(health.data).not.toContain('jobRunsTotal');

        const metrics = await httpGet(`http://127.0.0.1:${port}/metrics`);
        expect(metrics.res.statusCode).toBe(401);
        expect(metrics.data).not.toContain('esocial_job_runs_total');

        const wrong = await httpGet(`http://127.0.0.1:${port}/health`, {
          Authorization: 'Bearer wrong-token',
        });
        expect(wrong.res.statusCode).toBe(401);

        server.close(done);
      } catch (err) {
        server.close(() => done(err));
      }
    }).catch(done);
  }, 10000);

  test('renderMetrics emits Prometheus text format', () => {
    const { renderMetrics, recordJobRun, _resetForTests } = require('../src/health');
    _resetForTests();
    recordJobRun('success');
    recordJobRun('success');
    recordJobRun('error');
    const text = renderMetrics();
    expect(text).toContain('# TYPE esocial_uptime_seconds gauge');
    expect(text).toContain('# TYPE esocial_job_runs_total counter');
    expect(text).toContain('esocial_job_runs_total{status="success"} 2');
    expect(text).toContain('esocial_job_runs_total{status="error"} 1');
    expect(text).toMatch(/esocial_last_job_timestamp_seconds \d+/);
    expect(text).toMatch(/esocial_uptime_seconds \d+/);
  });

  test('renderMetrics reports zeros when no runs recorded', () => {
    const { renderMetrics, _resetForTests } = require('../src/health');
    _resetForTests();
    const text = renderMetrics();
    expect(text).toContain('esocial_job_runs_total{status="success"} 0');
    expect(text).toContain('esocial_job_runs_total{status="error"} 0');
    expect(text).toContain('esocial_last_job_timestamp_seconds 0');
  });

  test('startHealthServer responds to /metrics with Prometheus format when authorized', (done) => {
    process.env.HEALTH_ENABLED = 'true';
    process.env.HEALTH_PORT = '0';
    process.env.HEALTH_TOKEN = TEST_TOKEN;
    const { startHealthServer, recordJobRun, _resetForTests } = require('../src/health');
    _resetForTests();
    recordJobRun('success');
    const server = startHealthServer();

    whenListening(server).then(async () => {
      try {
        const port = server.address().port;
        const { res, data } = await httpGet(`http://127.0.0.1:${port}/metrics`, {
          Authorization: `Bearer ${TEST_TOKEN}`,
        });
        expect(res.statusCode).toBe(200);
        expect(res.headers['content-type']).toContain('text/plain');
        expect(data).toContain('esocial_job_runs_total{status="success"} 1');
        server.close(done);
      } catch (err) {
        server.close(() => done(err));
      }
    }).catch(done);
  }, 10000);
});
