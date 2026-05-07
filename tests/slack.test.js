'use strict';

jest.mock('axios', () => ({ post: jest.fn() }));
const axios = require('axios');

const slack = require('../src/notifications/slack');

const VALID_URL = 'https://hooks.slack.com/services/T000/B000/secret';
const originalEnv = process.env;

describe('slack notifications', () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.SLACK_WEBHOOK_URL;
    delete process.env.SLACK_TIMEOUT_MS;
    axios.post.mockReset();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('getWebhookUrl', () => {
    test('returns null when env var is unset', () => {
      expect(slack.getWebhookUrl()).toBeNull();
    });

    test('returns the configured URL', () => {
      process.env.SLACK_WEBHOOK_URL = VALID_URL;
      expect(slack.getWebhookUrl()).toBe(VALID_URL);
    });
  });

  describe('buildPayload', () => {
    test('produces text + blocks with header and context footer', () => {
      const payload = slack.buildPayload({
        emoji: ':bell:',
        title: 'Hello',
        text: 'fallback',
        body: 'a body',
      });
      expect(payload.text).toBe('fallback');
      expect(Array.isArray(payload.blocks)).toBe(true);
      expect(payload.blocks[0].type).toBe('header');
      expect(payload.blocks[0].text.text).toContain('Hello');
      expect(payload.blocks[payload.blocks.length - 1].type).toBe('context');
    });

    test('renders fields as a section with mrkdwn entries', () => {
      const payload = slack.buildPayload({
        emoji: ':bell:',
        title: 'X',
        text: 'x',
        fields: [
          { label: 'A', value: '1' },
          { label: 'B', value: '2' },
        ],
      });
      const fieldSection = payload.blocks.find((b) => b.type === 'section' && b.fields);
      expect(fieldSection).toBeDefined();
      expect(fieldSection.fields).toHaveLength(2);
      expect(fieldSection.fields[0].text).toBe('*A*\n1');
    });

    test('caps fields to 10 entries', () => {
      const fields = Array.from({ length: 15 }, (_, i) => ({ label: `L${i}`, value: `${i}` }));
      const payload = slack.buildPayload({ emoji: ':bell:', title: 'X', text: 'x', fields });
      const fieldSection = payload.blocks.find((b) => b.type === 'section' && b.fields);
      expect(fieldSection.fields).toHaveLength(10);
    });
  });

  describe('sendSlack', () => {
    test('returns false and skips POST when SLACK_WEBHOOK_URL is unset', async () => {
      const result = await slack.sendSlack('hello');
      expect(result).toBe(false);
      expect(axios.post).not.toHaveBeenCalled();
    });

    test('POSTs a text payload when called with a string', async () => {
      process.env.SLACK_WEBHOOK_URL = VALID_URL;
      axios.post.mockResolvedValue({ status: 200 });

      const result = await slack.sendSlack('hello world');

      expect(result).toBe(true);
      expect(axios.post).toHaveBeenCalledTimes(1);
      const [url, body, config] = axios.post.mock.calls[0];
      expect(url).toBe(VALID_URL);
      expect(body).toEqual({ text: 'hello world' });
      expect(config.timeout).toBe(5000);
      expect(config.headers['Content-Type']).toBe('application/json');
    });

    test('forwards a Block Kit payload object as-is', async () => {
      process.env.SLACK_WEBHOOK_URL = VALID_URL;
      axios.post.mockResolvedValue({ status: 200, data: 'ok' });

      const payload = slack.buildPayload({ emoji: ':bell:', title: 'T', text: 'fallback' });
      const result = await slack.sendSlack(payload);

      expect(result).toBe(true);
      const [, body] = axios.post.mock.calls[0];
      expect(body).toBe(payload);
      expect(body.text).toBe('fallback');
    });

    test('honors custom timeout from SLACK_TIMEOUT_MS', async () => {
      process.env.SLACK_WEBHOOK_URL = VALID_URL;
      process.env.SLACK_TIMEOUT_MS = '10000';
      axios.post.mockResolvedValue({ status: 200 });

      await slack.sendSlack('hi');

      expect(axios.post.mock.calls[0][2].timeout).toBe(10000);
    });

    test('forwards optional username and iconEmoji', async () => {
      process.env.SLACK_WEBHOOK_URL = VALID_URL;
      axios.post.mockResolvedValue({ status: 200 });

      await slack.sendSlack('hi', { username: 'eSocial Bot', iconEmoji: ':robot_face:' });

      const body = axios.post.mock.calls[0][1];
      expect(body).toEqual({
        text: 'hi',
        username: 'eSocial Bot',
        icon_emoji: ':robot_face:',
      });
    });

    test('swallows network errors and returns false', async () => {
      process.env.SLACK_WEBHOOK_URL = VALID_URL;
      axios.post.mockRejectedValue(new Error('connect ETIMEDOUT'));

      const result = await slack.sendSlack('boom');

      expect(result).toBe(false);
    });
  });

  describe('notifyPayment', () => {
    test('formats fields with periodo, guiaId, valor and pdfPath', async () => {
      process.env.SLACK_WEBHOOK_URL = VALID_URL;
      axios.post.mockResolvedValue({ status: 200, data: 'ok' });

      await slack.notifyPayment({
        periodo: '03/2025',
        pdfPath: '/tmp/DAE-03-2025.pdf',
        valor: 1234.5,
        guiaId: 'g-42',
      });

      const body = axios.post.mock.calls[0][1];
      expect(body.text).toContain('03/2025');
      const fieldSection = body.blocks.find((b) => b.type === 'section' && b.fields);
      const labels = fieldSection.fields.map((f) => f.text.split('\n')[0]);
      expect(labels).toEqual(expect.arrayContaining(['*Competência*', '*Guia*', '*Valor*', '*PDF*']));
    });

    test('omits valor when not provided', async () => {
      process.env.SLACK_WEBHOOK_URL = VALID_URL;
      axios.post.mockResolvedValue({ status: 200, data: 'ok' });

      await slack.notifyPayment({ periodo: '03/2025' });

      const body = axios.post.mock.calls[0][1];
      const fieldSection = body.blocks.find((b) => b.type === 'section' && b.fields);
      const labels = fieldSection.fields.map((f) => f.text.split('\n')[0]);
      expect(labels).not.toContain('*Valor*');
    });
  });

  describe('notifyError', () => {
    test('uses error message and includes context', async () => {
      process.env.SLACK_WEBHOOK_URL = VALID_URL;
      axios.post.mockResolvedValue({ status: 200, data: 'ok' });

      await slack.notifyError({
        context: 'gerar guia',
        error: new Error('timeout'),
        periodo: '03/2025',
      });

      const body = axios.post.mock.calls[0][1];
      expect(body.text).toContain('gerar guia');
      expect(body.text).toContain('timeout');
      expect(body.blocks[0].text.text).toContain('Problema na integração');
    });

    test('accepts plain string errors', async () => {
      process.env.SLACK_WEBHOOK_URL = VALID_URL;
      axios.post.mockResolvedValue({ status: 200, data: 'ok' });

      await slack.notifyError({ context: 'auth', error: 'sessão inválida' });

      const body = axios.post.mock.calls[0][1];
      expect(body.text).toContain('sessão inválida');
    });
  });

  describe('notifyConfirmation', () => {
    test('uses checkmark emoji and includes title in header', async () => {
      process.env.SLACK_WEBHOOK_URL = VALID_URL;
      axios.post.mockResolvedValue({ status: 200, data: 'ok' });

      await slack.notifyConfirmation({
        title: 'Folha encerrada',
        message: 'Tudo certo',
        fields: [{ label: 'Competência', value: '03/2025' }],
      });

      const body = axios.post.mock.calls[0][1];
      expect(body.blocks[0].text.text).toContain(':white_check_mark:');
      expect(body.blocks[0].text.text).toContain('Folha encerrada');
    });
  });
});
