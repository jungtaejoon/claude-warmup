import test from 'node:test';
import assert from 'node:assert/strict';
import { toMs, usageFromReport, usageFromText, parseResetText, sessionResetFromRateLimits } from '../src/usage.js';

test('toMs accepts seconds, ms, numeric strings and ISO', () => {
  assert.equal(toMs(1762578000), 1762578000000);
  assert.equal(toMs(1762578000000), 1762578000000);
  assert.equal(toMs('1762578000'), 1762578000000);
  assert.equal(toMs('2025-11-08T05:00:00.000Z'), Date.UTC(2025, 10, 8, 5));
  assert.equal(toMs(null), null);
  assert.equal(toMs('soon'), null);
  assert.equal(toMs(0), null);
});

test('usageFromReport reads the structured /usage twin', () => {
  const report = {
    session: { total_cost_usd: 0 },
    rate_limits: {
      limits: [
        { kind: 'session', group: 'session', percent: 23.4, resets_at: '2026-11-08T06:00:00Z', severity: 'normal', is_active: true },
        { kind: 'weekly_all', group: 'weekly', percent: 41, resets_at: '2026-11-12T01:00:00Z', severity: 'warning' },
        { kind: 'weekly_scoped', group: 'weekly', percent: 7, resets_at: null, scope: { model: { display_name: 'Opus' } }, severity: 'normal' },
      ],
      extra_usage: { is_enabled: false },
    },
  };
  const u = usageFromReport(report);
  assert.equal(u.ok, true);
  assert.equal(u.source, 'usage_report');
  assert.equal(u.rows.length, 3);
  assert.equal(u.session.percent, 23.4);
  assert.equal(u.session.resetsAt, Date.UTC(2026, 10, 8, 6));
  assert.equal(u.rows[2].scopeName, 'Opus');
  assert.deepEqual(u.extraUsage, { is_enabled: false });
});

test('usageFromReport reports missing plan data', () => {
  assert.deepEqual(usageFromReport({ rate_limits: null }), { ok: false, reason: 'no_plan_data' });
  assert.deepEqual(usageFromReport({ rate_limits: { limits: null } }), { ok: false, reason: 'usage_fetch_failed' });
  assert.equal(usageFromReport({ something: 'else' }), null);
  assert.equal(usageFromReport(null), null);
});

test('usageFromText parses the printed /usage lines', () => {
  const now = new Date(2026, 10, 8, 10, 0).getTime();
  const text = [
    'Current session: 12% used · resets 3pm (Asia/Seoul)',
    'Current week (all models): 41% used · resets Nov 12, 10am (Asia/Seoul)',
    'Current week (Sonnet only): 3% used',
    'Total cost: $0.00',
  ].join('\n');
  const u = usageFromText(text, now);
  assert.equal(u.ok, true);
  assert.deepEqual(u.rows.map((r) => r.kind), ['session', 'weekly_all', 'weekly_scoped']);
  assert.equal(u.session.percent, 12);
  assert.equal(u.session.resetsAt, new Date(2026, 10, 8, 15, 0).getTime());
  assert.equal(u.rows[1].resetsAt, new Date(2026, 10, 12, 10, 0).getTime());
  assert.equal(u.rows[2].scopeName, 'Sonnet only');
  assert.equal(usageFromText('Total cost: $0.00'), null);
});

test('parseResetText', () => {
  const now = new Date(2026, 10, 8, 16, 0).getTime();
  assert.equal(parseResetText('3pm', now), new Date(2026, 10, 9, 15, 0).getTime()); // already past -> tomorrow
  assert.equal(parseResetText('5:30pm (Asia/Seoul)', now), new Date(2026, 10, 8, 17, 30).getTime());
  assert.equal(parseResetText('12am', now), new Date(2026, 10, 9, 0, 0).getTime());
  assert.equal(parseResetText('Jan 3, 9am', now), new Date(2027, 0, 3, 9, 0).getTime());
  assert.equal(parseResetText('18:00', now), new Date(2026, 10, 8, 18, 0).getTime());
  assert.equal(parseResetText('later', now), null);
});

test('sessionResetFromRateLimits prefers unifiedWindows.five_hour', () => {
  assert.equal(sessionResetFromRateLimits([{ status: 'allowed', unifiedWindows: { five_hour: { resetsAt: 1762578000 } } }]), 1762578000000);
  assert.equal(sessionResetFromRateLimits([{ status: 'allowed', rateLimitType: 'five_hour', resetsAt: 1762578000 }]), 1762578000000);
  assert.equal(sessionResetFromRateLimits([{ status: 'allowed', rateLimitType: 'seven_day', resetsAt: 1762578000 }]), null);
  assert.equal(sessionResetFromRateLimits([]), null);
});
