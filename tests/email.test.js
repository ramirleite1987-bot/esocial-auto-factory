'use strict';

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
