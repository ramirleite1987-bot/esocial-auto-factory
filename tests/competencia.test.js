'use strict';

describe('getCompetencia', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.COMPETENCIA_MES;
    delete process.env.COMPETENCIA_ANO;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('returns env values when both COMPETENCIA_MES and COMPETENCIA_ANO are set', () => {
    process.env.COMPETENCIA_MES = '5';
    process.env.COMPETENCIA_ANO = '2025';
    const { getCompetencia } = require('../src/utils/competencia');
    const result = getCompetencia();
    expect(result).toEqual({ mes: 5, ano: 2025 });
  });

  test('returns previous month when env vars are "auto"', () => {
    process.env.COMPETENCIA_MES = 'auto';
    process.env.COMPETENCIA_ANO = 'auto';
    const { getCompetencia } = require('../src/utils/competencia');
    const result = getCompetencia();
    const now = new Date();
    let expectedMes = now.getMonth(); // 0-indexed, so Jan=0 gives 0 (previous month)
    let expectedAno = now.getFullYear();
    if (expectedMes === 0) {
      expectedMes = 12;
      expectedAno -= 1;
    }
    expect(result).toEqual({ mes: expectedMes, ano: expectedAno });
  });

  test('auto-calculates previous month when env vars are not set', () => {
    const { getCompetencia } = require('../src/utils/competencia');
    const result = getCompetencia();
    expect(result.mes).toBeGreaterThanOrEqual(1);
    expect(result.mes).toBeLessThanOrEqual(12);
    expect(result.ano).toBeGreaterThanOrEqual(2020);
  });

  test('handles January rollback to December of previous year', () => {
    // Mock only Date.prototype.getMonth and getFullYear
    const realDate = global.Date;
    const MockDate = class extends realDate {
      constructor(...args) {
        if (args.length === 0) {
          super(2025, 0, 15); // January 15, 2025
        } else {
          super(...args);
        }
      }
    };
    MockDate.now = realDate.now;
    global.Date = MockDate;

    const { getCompetencia } = require('../src/utils/competencia');
    const result = getCompetencia();
    expect(result).toEqual({ mes: 12, ano: 2024 });

    global.Date = realDate;
  });
});
