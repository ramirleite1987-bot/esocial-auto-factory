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
});
