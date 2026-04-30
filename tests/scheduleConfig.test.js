'use strict';

describe('resolveSchedule', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.CRON_SCHEDULE;
    delete process.env.JOB_DIA_FECHAMENTO;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('returns default schedule when nothing is set', () => {
    const { resolveSchedule, DEFAULT_SCHEDULE } = require('../src/utils/scheduleConfig');
    expect(resolveSchedule()).toBe(DEFAULT_SCHEDULE);
    expect(DEFAULT_SCHEDULE).toBe('0 8 7 * *');
  });

  test('builds expression from JOB_DIA_FECHAMENTO', () => {
    process.env.JOB_DIA_FECHAMENTO = '15';
    const { resolveSchedule } = require('../src/utils/scheduleConfig');
    expect(resolveSchedule()).toBe('0 8 15 * *');
  });

  test('CRON_SCHEDULE wins over JOB_DIA_FECHAMENTO', () => {
    process.env.CRON_SCHEDULE = '*/30 * * * *';
    process.env.JOB_DIA_FECHAMENTO = '7';
    const { resolveSchedule } = require('../src/utils/scheduleConfig');
    expect(resolveSchedule()).toBe('*/30 * * * *');
  });

  test('throws on non-numeric JOB_DIA_FECHAMENTO with clear message', () => {
    process.env.JOB_DIA_FECHAMENTO = 'abc';
    const { resolveSchedule } = require('../src/utils/scheduleConfig');
    expect(() => resolveSchedule()).toThrow(/JOB_DIA_FECHAMENTO inválido: "abc"/);
  });

  test('throws on out-of-range JOB_DIA_FECHAMENTO (too high)', () => {
    process.env.JOB_DIA_FECHAMENTO = '32';
    const { resolveSchedule } = require('../src/utils/scheduleConfig');
    expect(() => resolveSchedule()).toThrow(/JOB_DIA_FECHAMENTO inválido: "32"/);
  });

  test('throws on out-of-range JOB_DIA_FECHAMENTO (too low)', () => {
    process.env.JOB_DIA_FECHAMENTO = '0';
    const { resolveSchedule } = require('../src/utils/scheduleConfig');
    expect(() => resolveSchedule()).toThrow(/JOB_DIA_FECHAMENTO inválido: "0"/);
  });

  test('throws on non-integer JOB_DIA_FECHAMENTO', () => {
    process.env.JOB_DIA_FECHAMENTO = '7.5';
    const { resolveSchedule } = require('../src/utils/scheduleConfig');
    expect(() => resolveSchedule()).toThrow(/JOB_DIA_FECHAMENTO inválido: "7.5"/);
  });

  test('throws on invalid CRON_SCHEDULE', () => {
    process.env.CRON_SCHEDULE = 'this is not cron';
    const { resolveSchedule } = require('../src/utils/scheduleConfig');
    expect(() => resolveSchedule()).toThrow(/Invalid cron expression/);
  });

  test('accepts boundary values 1 and 31', () => {
    process.env.JOB_DIA_FECHAMENTO = '1';
    let { resolveSchedule } = require('../src/utils/scheduleConfig');
    expect(resolveSchedule()).toBe('0 8 1 * *');

    jest.resetModules();
    process.env.JOB_DIA_FECHAMENTO = '31';
    ({ resolveSchedule } = require('../src/utils/scheduleConfig'));
    expect(resolveSchedule()).toBe('0 8 31 * *');
  });
});
