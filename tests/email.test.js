'use strict';

jest.mock('nodemailer', () => {
  const verify = jest.fn();
  const sendMail = jest.fn();
  return {
    createTransport: jest.fn(() => ({ verify, sendMail })),
    __mocks: { verify, sendMail },
  };
});

const nodemailer = require('nodemailer');
const { verify: verifyMock, sendMail: sendMailMock } = nodemailer.__mocks;
const createTransportMock = nodemailer.createTransport;

function freshEmail() {
  jest.resetModules();
  jest.doMock('nodemailer', () => nodemailer);
  return require('../src/notifications/email');
}

beforeEach(() => {
  verifyMock.mockReset();
  sendMailMock.mockReset();
  createTransportMock.mockClear();
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_PORT;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  delete process.env.EMAIL_TO;
});

const { escapeHtml, successTemplate, failureTemplate } = require('../src/notifications/email');

describe('escapeHtml', () => {
  test('escapes the five core HTML metacharacters', () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;',
    );
    expect(escapeHtml("Tom & Jerry's")).toBe('Tom &amp; Jerry&#39;s');
  });

  test('returns empty string for null/undefined', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  test('coerces non-strings to string', () => {
    expect(escapeHtml(42)).toBe('42');
    expect(escapeHtml(true)).toBe('true');
  });

  test('escapes & only once (no double-encoding)', () => {
    expect(escapeHtml('&amp;')).toBe('&amp;amp;');
  });
});

describe('successTemplate', () => {
  test('escapes HTML in body', () => {
    const html = successTemplate('<b>boom</b>');
    expect(html).toContain('&lt;b&gt;boom&lt;/b&gt;');
    expect(html).not.toContain('<b>boom</b>');
  });

  test('preserves multi-line bodies as <br/>', () => {
    const html = successTemplate('line1\nline2');
    expect(html).toContain('line1<br/>line2');
  });
});

describe('failureTemplate', () => {
  test('escapes HTML in body', () => {
    const html = failureTemplate('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img src=x');
  });

  test('renders body inside a <pre> block to preserve formatting', () => {
    const stack = 'Error: boom\n  at file.js:10:5\n  at file.js:20:3';
    const html = failureTemplate(stack);
    expect(html).toContain('<pre');
    expect(html).toContain('Error: boom\n  at file.js:10:5');
  });
});

describe('initEmail', () => {
  test('creates transporter from SMTP env vars and verifies it', async () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_USER = 'u';
    process.env.SMTP_PASS = 'p';
    verifyMock.mockResolvedValue(true);

    const { initEmail } = freshEmail();
    await initEmail();

    expect(createTransportMock).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      auth: { user: 'u', pass: 'p' },
    });
    expect(verifyMock).toHaveBeenCalled();
  });

  test('uses secure=true when SMTP_PORT is 465', async () => {
    process.env.SMTP_PORT = '465';
    verifyMock.mockResolvedValue(true);

    const { initEmail } = freshEmail();
    await initEmail();

    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({ port: 465, secure: true }),
    );
  });

  test('defaults port to 587 when SMTP_PORT is unset', async () => {
    verifyMock.mockResolvedValue(true);

    const { initEmail } = freshEmail();
    await initEmail();

    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({ port: 587, secure: false }),
    );
  });

  test('swallows verification errors and leaves transporter null', async () => {
    verifyMock.mockRejectedValue(new Error('SMTP unreachable'));

    const { initEmail, sendEmail } = freshEmail();
    await expect(initEmail()).resolves.toBeUndefined();

    await sendEmail({ subject: 's', body: 'b' });
    expect(sendMailMock).not.toHaveBeenCalled();
  });
});

describe('sendEmail', () => {
  test('lazy-initializes the transporter on first call', async () => {
    verifyMock.mockResolvedValue(true);
    sendMailMock.mockResolvedValue({ messageId: 'mid-1' });
    process.env.SMTP_USER = 'sender@example.com';
    process.env.EMAIL_TO = 'dest@example.com';

    const { sendEmail } = freshEmail();
    await sendEmail({ subject: 'hello', body: 'world' });

    expect(createTransportMock).toHaveBeenCalledTimes(1);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const call = sendMailMock.mock.calls[0][0];
    expect(call.from).toBe('sender@example.com');
    expect(call.to).toBe('dest@example.com');
    expect(call.subject).toBe('hello');
    expect(call.html).toContain('world');
    expect(call.html).toContain('Processamento Concluído');
    expect(call.attachments).toEqual([]);
  });

  test('uses the failure template when isError=true', async () => {
    verifyMock.mockResolvedValue(true);
    sendMailMock.mockResolvedValue({ messageId: 'mid-2' });

    const { sendEmail } = freshEmail();
    await sendEmail({ subject: 'err', body: 'stack', isError: true });

    const call = sendMailMock.mock.calls[0][0];
    expect(call.html).toContain('Falha no Processamento');
    expect(call.html).toContain('<pre');
  });

  test('passes through provided attachments', async () => {
    verifyMock.mockResolvedValue(true);
    sendMailMock.mockResolvedValue({ messageId: 'mid-3' });

    const attachments = [{ filename: 'DAE.pdf', path: '/tmp/DAE.pdf' }];
    const { sendEmail } = freshEmail();
    await sendEmail({ subject: 's', body: 'b', attachments });

    expect(sendMailMock.mock.calls[0][0].attachments).toBe(attachments);
  });

  test('skips silently when SMTP init fails (no transporter)', async () => {
    verifyMock.mockRejectedValue(new Error('boom'));

    const { sendEmail } = freshEmail();
    await sendEmail({ subject: 's', body: 'b' });

    expect(sendMailMock).not.toHaveBeenCalled();
  });

  test('does not throw when sendMail itself fails', async () => {
    verifyMock.mockResolvedValue(true);
    sendMailMock.mockRejectedValue(new Error('connection reset'));

    const { sendEmail } = freshEmail();
    await expect(sendEmail({ subject: 's', body: 'b' })).resolves.toBeUndefined();
    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });

  test('accepts being called with no arguments and bails gracefully', async () => {
    verifyMock.mockResolvedValue(true);
    sendMailMock.mockResolvedValue({ messageId: 'mid-4' });

    const { sendEmail } = freshEmail();
    await expect(sendEmail()).resolves.toBeUndefined();
  });
});
