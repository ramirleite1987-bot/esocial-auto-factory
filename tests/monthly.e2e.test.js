'use strict';

const fs = require('fs');

/*
 * End-to-end flow tests for the monthly job orchestrator (runJob).
 *
 * These drive the REAL src/jobs/monthly.js pipeline while mocking every
 * external boundary (gov.br auth, eSocial HTTP, email, WhatsApp, Slack,
 * health, audit log, competência). Each test exercises one operational
 * flow end to end and asserts the cross-cutting invariants (notifications,
 * audit logging, lock lifecycle, retry behaviour).
 */

const LOCK_FILE = '/tmp/esocial-auto.lock';

// --- Mock every boundary module the orchestrator imports ---
jest.mock('../src/auth/govbr', () => ({ authenticate: jest.fn() }));
jest.mock('../src/esocial/client', () => ({ createClient: jest.fn() }));
jest.mock('../src/esocial/folha', () => ({
  listarFolhasAbertas: jest.fn(),
  verificarCompetencia: jest.fn(),
  encerrarFolha: jest.fn(),
}));
jest.mock('../src/esocial/guia', () => ({
  gerarGuia: jest.fn(),
  downloadGuiaPDF: jest.fn(),
}));
jest.mock('../src/notifications/email', () => ({ sendEmail: jest.fn() }));
jest.mock('../src/notifications/whatsapp', () => ({ sendWhatsApp: jest.fn() }));
jest.mock('../src/notifications/slack', () => ({
  notifyPayment: jest.fn(),
  notifyError: jest.fn(),
  notifyConfirmation: jest.fn(),
}));
jest.mock('../src/health', () => ({ recordJobRun: jest.fn() }));
jest.mock('../src/utils/auditLog', () => ({ appendRun: jest.fn() }));
jest.mock('../src/utils/competencia', () => ({
  getCompetencia: jest.fn(() => ({ mes: 5, ano: 2026 })),
}));

function makeAxiosError(status) {
  const err = new Error(`HTTP ${status}`);
  err.response = { status };
  return err;
}

function cleanLock() {
  try {
    if (fs.existsSync(LOCK_FILE)) fs.unlinkSync(LOCK_FILE);
  } catch {
    /* ignore */
  }
}

describe('monthly job — e2e flows', () => {
  const originalEnv = process.env;

  let monthly;
  let authenticate;
  let createClient;
  let listarFolhasAbertas;
  let verificarCompetencia;
  let encerrarFolha;
  let gerarGuia;
  let downloadGuiaPDF;
  let sendEmail;
  let sendWhatsApp;
  let notifyPayment;
  let notifyError;
  let notifyConfirmation;
  let recordJobRun;
  let appendRun;

  /** Configure all mocks for a fully successful run. */
  function primeHappyPath() {
    authenticate.mockResolvedValue('cookie-session=abc123');
    createClient.mockReturnValue({ get: jest.fn(), post: jest.fn() });
    listarFolhasAbertas.mockResolvedValue([{ competencia: '05/2026', status: 'ABERTA' }]);
    verificarCompetencia.mockResolvedValue({ ok: true });
    encerrarFolha.mockResolvedValue({ status: 'ENCERRADA', valor: 123.45 });
    gerarGuia.mockResolvedValue('guia-789');
    downloadGuiaPDF.mockResolvedValue('/output/guias/DAE-05-2026.pdf');
    sendEmail.mockResolvedValue(undefined);
    sendWhatsApp.mockResolvedValue(undefined);
    notifyPayment.mockResolvedValue(true);
    notifyError.mockResolvedValue(true);
    notifyConfirmation.mockResolvedValue(true);
  }

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv, JOB_MAX_RETRIES: '2', WHATSAPP_NUMBER: '5511999999999' };
    cleanLock();

    monthly = require('../src/jobs/monthly');
    monthly._resetForTests();

    authenticate = require('../src/auth/govbr').authenticate;
    createClient = require('../src/esocial/client').createClient;
    ({ listarFolhasAbertas, verificarCompetencia, encerrarFolha } = require('../src/esocial/folha'));
    ({ gerarGuia, downloadGuiaPDF } = require('../src/esocial/guia'));
    ({ sendEmail } = require('../src/notifications/email'));
    ({ sendWhatsApp } = require('../src/notifications/whatsapp'));
    ({ notifyPayment, notifyError, notifyConfirmation } = require('../src/notifications/slack'));
    ({ recordJobRun } = require('../src/health'));
    ({ appendRun } = require('../src/utils/auditLog'));

    primeHappyPath();
  });

  afterEach(() => {
    cleanLock();
    jest.useRealTimers();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  // --- Flow 1: happy path ---
  test('happy path runs the full pipeline and records success', async () => {
    await monthly.runJob();

    // Pipeline ran in order with the authenticated client
    expect(authenticate).toHaveBeenCalledTimes(1);
    const client = createClient.mock.results[0].value;
    expect(createClient).toHaveBeenCalledWith('cookie-session=abc123');
    expect(listarFolhasAbertas).toHaveBeenCalledWith(client);
    expect(verificarCompetencia).toHaveBeenCalledWith(client, { mes: 5, ano: 2026 });
    expect(encerrarFolha).toHaveBeenCalledWith(client, { mes: 5, ano: 2026 });
    expect(gerarGuia).toHaveBeenCalledWith(client, { mes: 5, ano: 2026 });

    // PDF path derived from competência
    const dlArgs = downloadGuiaPDF.mock.calls[0];
    expect(dlArgs[1]).toBe('guia-789');
    expect(dlArgs[2]).toMatch(/DAE-05-2026\.pdf$/);

    // Slack: payroll-closed confirmation + payment-ready notification
    expect(notifyConfirmation).toHaveBeenCalledTimes(1);
    expect(notifyPayment).toHaveBeenCalledTimes(1);
    expect(notifyPayment.mock.calls[0][0]).toMatchObject({ periodo: '05/2026', guiaId: 'guia-789' });
    expect(notifyError).not.toHaveBeenCalled();

    // Email with PDF attachment + WhatsApp success
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const emailArg = sendEmail.mock.calls[0][0];
    expect(emailArg.subject).toContain('05/2026');
    expect(emailArg.attachments[0].filename).toBe('DAE-05-2026.pdf');
    expect(sendWhatsApp).toHaveBeenCalledWith('5511999999999', expect.stringContaining('05/2026'));

    // Bookkeeping
    expect(recordJobRun).toHaveBeenCalledWith('success');
    expect(appendRun).toHaveBeenCalledWith(expect.objectContaining({ status: 'success', periodo: '05/2026' }));

    // Lock released
    expect(fs.existsSync(LOCK_FILE)).toBe(false);
  });

  // --- Flow 2: persistent auth failure ---
  test('persistent auth failure sends error notifications and records error', async () => {
    jest.useFakeTimers();
    authenticate.mockRejectedValue(makeAxiosError(500));

    const p = monthly.runJob();
    const settled = p.catch((e) => e);
    await jest.runAllTimersAsync();
    const err = await settled;

    expect(err).toBeInstanceOf(Error);
    // Exhausted all retries (JOB_MAX_RETRIES=2)
    expect(authenticate).toHaveBeenCalledTimes(2);

    // Core pipeline never reached
    expect(encerrarFolha).not.toHaveBeenCalled();
    expect(gerarGuia).not.toHaveBeenCalled();

    // All three error channels fired
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ isError: true }));
    expect(sendWhatsApp).toHaveBeenCalledWith('5511999999999', expect.stringContaining('ERRO'));
    expect(notifyError).toHaveBeenCalledTimes(1);

    // Bookkeeping + lock
    expect(recordJobRun).toHaveBeenCalledWith('error');
    expect(appendRun).toHaveBeenCalledWith(expect.objectContaining({ status: 'error' }));
    expect(fs.existsSync(LOCK_FILE)).toBe(false);
  });

  // --- Flow 3: transient failure recovers via retry ---
  test('transient 5xx on encerrarFolha recovers on retry', async () => {
    jest.useFakeTimers();
    encerrarFolha
      .mockRejectedValueOnce(makeAxiosError(503))
      .mockResolvedValueOnce({ status: 'ENCERRADA' });

    const p = monthly.runJob();
    const settled = p.then(() => 'ok').catch((e) => e);
    await jest.runAllTimersAsync();
    const outcome = await settled;

    expect(outcome).toBe('ok');
    expect(encerrarFolha).toHaveBeenCalledTimes(2);
    expect(gerarGuia).toHaveBeenCalledTimes(1);
    expect(recordJobRun).toHaveBeenCalledWith('success');
  });

  // --- Flow 4: 4xx is not retried ---
  test('client error (403) on gerarGuia fails fast without retry', async () => {
    jest.useFakeTimers();
    gerarGuia.mockRejectedValue(makeAxiosError(403));

    const p = monthly.runJob();
    const settled = p.catch((e) => e);
    await jest.runAllTimersAsync();
    const err = await settled;

    expect(err).toBeInstanceOf(Error);
    expect(gerarGuia).toHaveBeenCalledTimes(1); // no retry on 4xx
    expect(downloadGuiaPDF).not.toHaveBeenCalled();
    expect(recordJobRun).toHaveBeenCalledWith('error');
  });

  // --- Flow 5: in-flight guard prevents concurrent runs ---
  test('concurrent runJob returns the same in-flight run', async () => {
    let release;
    authenticate.mockReturnValue(new Promise((resolve) => { release = () => resolve('cookie=x'); }));

    const p1 = monthly.runJob();
    const p2 = monthly.runJob(); // coalesces into the first run (guard)

    release();
    await Promise.all([p1, p2]);

    // Despite two runJob() calls, the pipeline executed once
    expect(authenticate).toHaveBeenCalledTimes(1);
    expect(encerrarFolha).toHaveBeenCalledTimes(1);
    expect(recordJobRun).toHaveBeenCalledTimes(1);
  });

  // --- Flow 6b: success-path Slack notifications must be awaited ---
  // Regression: under `--run-now`, index.js calls process.exit(0) right after
  // runJob() resolves. If the success Slack calls are fire-and-forget, their
  // webhook POSTs are killed before completing and the notifications are lost.
  test('awaits success Slack notifications before completing the run', async () => {
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    let releaseConfirm;
    let releasePayment;
    notifyConfirmation.mockReturnValue(new Promise((r) => { releaseConfirm = () => r(true); }));
    notifyPayment.mockReturnValue(new Promise((r) => { releasePayment = () => r(true); }));

    let done = false;
    const p = monthly.runJob().then(() => { done = true; });

    await flush();
    expect(notifyConfirmation).toHaveBeenCalledTimes(1);
    expect(done).toBe(false); // must be blocked awaiting the confirmation POST

    releaseConfirm();
    await flush();
    expect(notifyPayment).toHaveBeenCalledTimes(1);
    expect(done).toBe(false); // must be blocked awaiting the payment POST

    releasePayment();
    await p;
    expect(done).toBe(true);
  });

  // --- Flow 6: notification failures are best-effort ---
  test('success email failure does not fail the job', async () => {
    sendEmail.mockRejectedValue(new Error('SMTP down'));

    await expect(monthly.runJob()).resolves.toBeUndefined();

    // Core pipeline still succeeded; success still recorded
    expect(downloadGuiaPDF).toHaveBeenCalledTimes(1);
    expect(recordJobRun).toHaveBeenCalledWith('success');
    expect(appendRun).toHaveBeenCalledWith(expect.objectContaining({ status: 'success' }));
    expect(fs.existsSync(LOCK_FILE)).toBe(false);
  });
});
