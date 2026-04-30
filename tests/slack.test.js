'use strict';

jest.mock('axios', () => ({ post: jest.fn() }));
const axios = require('axios');
const { sendSlack } = require('../src/notifications/slack');

describe('sendSlack', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.SLACK_WEBHOOK_URL;
    delete process.env.SLACK_TIMEOUT_MS;
    axios.post.mockReset();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('returns false and skips POST when SLACK_WEBHOOK_URL is unset', async () => {
    const result = await sendSlack('hello');
    expect(result).toBe(false);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('POSTs to webhook with text payload when configured', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/AAA/BBB/CCC';
    axios.post.mockResolvedValue({ status: 200 });

    const result = await sendSlack('hello world');

    expect(result).toBe(true);
    expect(axios.post).toHaveBeenCalledTimes(1);
    const [url, body, config] = axios.post.mock.calls[0];
    expect(url).toBe('https://hooks.slack.com/services/AAA/BBB/CCC');
    expect(body).toEqual({ text: 'hello world' });
    expect(config.timeout).toBe(5000);
  });

  test('honors custom timeout from SLACK_TIMEOUT_MS', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/X/Y/Z';
    process.env.SLACK_TIMEOUT_MS = '10000';
    axios.post.mockResolvedValue({ status: 200 });

    await sendSlack('hi');

    expect(axios.post.mock.calls[0][2].timeout).toBe(10000);
  });

  test('forwards optional username and iconEmoji', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/X/Y/Z';
    axios.post.mockResolvedValue({ status: 200 });

    await sendSlack('hi', { username: 'eSocial Bot', iconEmoji: ':robot_face:' });

    const body = axios.post.mock.calls[0][1];
    expect(body).toEqual({
      text: 'hi',
      username: 'eSocial Bot',
      icon_emoji: ':robot_face:',
    });
  });

  test('swallows errors and returns false', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/X/Y/Z';
    axios.post.mockRejectedValue(new Error('connect ETIMEDOUT'));

    const result = await sendSlack('boom');

    expect(result).toBe(false);
  });
});
