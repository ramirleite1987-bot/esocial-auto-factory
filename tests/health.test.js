'use strict';

const http = require('http');

describe('health module', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
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

  test('startHealthServer starts and responds to /health', (done) => {
    process.env.HEALTH_ENABLED = 'true';
    process.env.HEALTH_PORT = '0';
    const { startHealthServer } = require('../src/health');
    const server = startHealthServer();
    expect(server).not.toBeNull();

    server.on('listening', () => {
      const port = server.address().port;

      http.get(`http://localhost:${port}/health`, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          const body = JSON.parse(data);
          expect(res.statusCode).toBe(200);
          expect(body.status).toBe('ok');
          expect(body).toHaveProperty('uptime');
          expect(body).toHaveProperty('nodeVersion');
          expect(body).toHaveProperty('timestamp');
          expect(body).toHaveProperty('jobRunsTotal');

          // Now test 404 on same server
          http.get(`http://localhost:${port}/unknown`, (res404) => {
            expect(res404.statusCode).toBe(404);
            res404.resume();
            server.close(done);
          });
        });
      });
    });
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

  test('startHealthServer responds to /metrics with Prometheus format', (done) => {
    process.env.HEALTH_ENABLED = 'true';
    process.env.HEALTH_PORT = '0';
    const { startHealthServer, recordJobRun, _resetForTests } = require('../src/health');
    _resetForTests();
    recordJobRun('success');
    const server = startHealthServer();

    server.on('listening', () => {
      const port = server.address().port;
      http.get(`http://localhost:${port}/metrics`, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          expect(res.statusCode).toBe(200);
          expect(res.headers['content-type']).toContain('text/plain');
          expect(data).toContain('esocial_job_runs_total{status="success"} 1');
          server.close(done);
        });
      });
    });
  }, 10000);
});
