#!/usr/bin/env node
const major = Number(process.versions.node.split('.')[0]);
if (major < 18) {
  console.error(`claude-warmup needs Node.js 18 or newer (you have ${process.version}).`);
  process.exit(1);
}

const { main } = await import('../src/cli.js');

try {
  process.exitCode = (await main(process.argv.slice(2))) ?? 0;
} catch (err) {
  console.error(err && err.stack ? err.stack : String(err));
  process.exitCode = 1;
}
