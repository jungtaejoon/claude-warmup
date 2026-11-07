#!/usr/bin/env node
// Stand-in for the `claude` CLI in tests. It mimics the stream-json shapes of Claude Code 2.1.x.
// FAKE_CLAUDE_SCENARIO: idle | active | no_report | text_only | logged_out | model_missing | rejected_5h | flags_broken
// FAKE_CLAUDE_LOG: file that receives one JSON line per invocation (the argv).
import fs from 'node:fs';

const args = process.argv.slice(2);
const scenario = process.env.FAKE_CLAUDE_SCENARIO || 'idle';
if (process.env.FAKE_CLAUDE_LOG) fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, `${JSON.stringify(args)}\n`);
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);

const HOUR = 3600e3;
const now = Date.now();
const topOfHour = Math.floor(now / HOUR) * HOUR;
const activeReset = topOfHour + 3 * HOUR; // a window that is already running
const newReset = topOfHour + 5 * HOUR; // the window a ping would start

if (args[0] === '--version') {
  console.log('2.1.999 (Claude Code)');
  process.exit(0);
}
if (args[0] === '--help') {
  console.log(`Usage: claude [options] [command] [prompt]
Options:
  --model <model>             Model for the current session
  --no-session-persistence    Disable session persistence
  --output-format <format>    Output format
  --safe-mode                 Start with all customizations disabled
  --strict-mcp-config         Only use MCP servers from --mcp-config
  --system-prompt <prompt>    System prompt to use for the session
  --tools <tools...>          Specify the list of available tools
  --verbose                   Override verbose mode setting`);
  process.exit(0);
}
if (args[0] === 'auth') {
  out(scenario === 'logged_out'
    ? { loggedIn: false, authMethod: 'none' }
    : { loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'max' });
  process.exit(0);
}

const prompt = args[args.indexOf('-p') + 1];
const init = { type: 'system', subtype: 'init', model: 'claude-haiku-5-5', apiKeySource: 'none', tools: [] };
const zeroUsage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };

if (prompt === '/usage') {
  out(init);
  const active = scenario === 'active' || scenario === 'rejected_5h';
  const costText = 'Total cost:            $0.0000\nUsage:                 0 input, 0 output';
  if (scenario === 'logged_out' || scenario === 'no_report') {
    out({ type: 'assistant', message: { model: '<synthetic>', content: [{ type: 'text', text: costText }] } });
    out({ type: 'result', subtype: 'success', is_error: false, num_turns: 0, total_cost_usd: 0, usage: zeroUsage, result: costText });
    process.exit(0);
  }
  const rows = [
    { kind: 'session', group: 'session', percent: active ? 23 : 0, resets_at: active ? new Date(activeReset).toISOString() : null, scope: null, severity: 'normal', is_active: true },
    { kind: 'weekly_all', group: 'weekly', percent: 41, resets_at: new Date(topOfHour + 50 * HOUR).toISOString(), scope: null, severity: 'normal', is_active: false },
    { kind: 'weekly_scoped', group: 'weekly', percent: 7, resets_at: new Date(topOfHour + 50 * HOUR).toISOString(), scope: { model: { display_name: 'Sonnet' } }, severity: 'normal', is_active: false },
  ];
  const text = `Current session: ${active ? 23 : 0}% used${active ? ' · resets 3pm (Asia/Seoul)' : ''}\nCurrent week (all models): 41% used · resets Nov 12, 10am (Asia/Seoul)`;
  const msg = { type: 'assistant', message: { model: '<synthetic>', content: [{ type: 'text', text }] } };
  if (scenario !== 'text_only') msg.usage_report = { session: { total_cost_usd: 0 }, rate_limits: { limits: rows, extra_usage: null } };
  out(msg);
  out({ type: 'result', subtype: 'success', is_error: false, num_turns: 0, total_cost_usd: 0, usage: zeroUsage, result: text });
  process.exit(0);
}

// Anything else is a ping.
out(init);
if (scenario === 'logged_out') {
  out({ type: 'assistant', message: { model: '<synthetic>', content: [{ type: 'text', text: 'Not logged in · Please run /login' }] } });
  out({ type: 'result', subtype: 'success', is_error: true, num_turns: 1, total_cost_usd: 0, usage: zeroUsage, result: 'Not logged in · Please run /login' });
  process.exit(1);
}
if (scenario === 'model_missing' && args.includes('--model')) {
  const m = args[args.indexOf('--model') + 1];
  out({ type: 'result', subtype: 'success', is_error: true, num_turns: 1, total_cost_usd: 0, usage: zeroUsage, result: `There's an issue with the selected model (${m}). It may not exist or you may not have access to it.` });
  process.exit(1);
}
if (scenario === 'flags_broken' && args.includes('--tools')) {
  process.stderr.write("error: option '--tools <tools...>' argument missing\n");
  process.exit(1);
}
if (scenario === 'rejected_5h') {
  out({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: Math.floor(activeReset / 1000), rateLimitType: 'five_hour' } });
  out({ type: 'result', subtype: 'success', is_error: true, num_turns: 1, total_cost_usd: 0, usage: zeroUsage, api_error_status: 429, result: "You've hit your limit · resets 3pm" });
  process.exit(1);
}
const reset = scenario === 'active' ? activeReset : newReset;
if (scenario !== 'no_report') {
  out({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', resetsAt: Math.floor(reset / 1000), rateLimitType: 'five_hour', unifiedWindows: { five_hour: { utilization: 0.01, resetsAt: Math.floor(reset / 1000), status: 'allowed' } } } });
}
out({ type: 'assistant', message: { model: 'claude-haiku-5-5', content: [{ type: 'text', text: 'ok' }] } });
out({ type: 'result', subtype: 'success', is_error: false, num_turns: 1, total_cost_usd: 0.0001, usage: { ...zeroUsage, input_tokens: 25, output_tokens: 2 }, result: 'ok' });
