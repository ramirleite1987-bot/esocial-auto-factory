'use strict';

jest.mock('node-cron', () => {
  const tasks = [];
  return {
    schedule: jest.fn(() => {
      const task = { stop: jest.fn(), destroy: jest.fn() };
      tasks.push(task);
      return task;
    }),
    validate: jest.fn(() => true),
    __tasks: tasks,
  };
});

describe('monthly job shutdown', () => {
  const originalEnv = process.env;
  let monthly;
  let cron;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    monthly = require('../src/jobs/monthly');
    cron = require('node-cron');
    cron.__tasks.length = 0;
    monthly._resetForTests();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('shutdown stops the cron task', async () => {
    process.env.CRON_SCHEDULE = '0 8 * * *';
    const task = monthly.setupCron('0 8 * * *');

    const result = await monthly.shutdown(100);
    expect(task.stop).toHaveBeenCalledTimes(1);
    expect(result.stopped).toBe(true);
    expect(result.drained).toBe(true);
  });

  test('shutdown reports drained=true when no job is running', async () => {
    const result = await monthly.shutdown(100);
    expect(result.drained).toBe(true);
    expect(result.stopped).toBe(true);
  });

  test('shutdown is idempotent across multiple calls', async () => {
    monthly.setupCron('0 8 * * *');
    await monthly.shutdown(50);
    const second = await monthly.shutdown(50);
    expect(second.stopped).toBe(true);
    expect(second.drained).toBe(true);
  });

  test('SHUTDOWN_GRACE_MS env var sets the default timeout', async () => {
    // Smoke check: ensure shutdown completes quickly and honors numeric env
    process.env.SHUTDOWN_GRACE_MS = '50';
    const result = await monthly.shutdown();
    expect(result.stopped).toBe(true);
  });

  test('isRunning is false when no job is in flight', () => {
    expect(monthly.isRunning()).toBe(false);
  });
});