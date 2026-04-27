const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MIGRATIONS_DIR = path.join(ROOT, 'supabase', 'migrations');

const args = new Set(process.argv.slice(2));
const strict = args.has('--strict');

function listSqlFiles(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.toLowerCase().endsWith('.sql'))
    .map((d) => d.name);
}

function isTimestamped(name) {
  return /^\d{14}_.+\.sql$/i.test(name);
}

function getTimestamp(name) {
  const m = name.match(/^(\d{14})_/);
  return m ? m[1] : null;
}

const all = listSqlFiles(MIGRATIONS_DIR);
const timestamped = all.filter(isTimestamped).sort((a, b) => a.localeCompare(b));
const legacy = all.filter((f) => !isTimestamped(f)).sort((a, b) => a.localeCompare(b));

const byTs = new Map();
for (const f of timestamped) {
  const ts = getTimestamp(f);
  if (!ts) continue;
  const list = byTs.get(ts) || [];
  list.push(f);
  byTs.set(ts, list);
}

const duplicates = Array.from(byTs.entries())
  .filter(([_ts, files]) => files.length > 1)
  .sort((a, b) => a[0].localeCompare(b[0]));

const sortedAll = [...timestamped].sort((a, b) => a.localeCompare(b));
const outOfOrder = timestamped.some((f, i) => f !== sortedAll[i]);

console.log('[migrations] directory:', MIGRATIONS_DIR);
console.log('[migrations] total:', all.length);
console.log('[migrations] timestamped:', timestamped.length);
console.log('[migrations] legacy:', legacy.length);

if (duplicates.length > 0) {
  console.log('\n[migrations] DUPLICATE timestamps found:');
  for (const [ts, files] of duplicates) {
    console.log(`- ${ts}`);
    for (const f of files) console.log(`  - ${f}`);
  }
}

if (outOfOrder) {
  console.log('\n[migrations] WARNING: timestamped file list is not lexicographically sorted.');
}

if (legacy.length > 0) {
  console.log('\n[migrations] Legacy (non-timestamp) files (Supabase CLI will not apply these automatically):');
  for (const f of legacy) console.log(`- ${f}`);
}

const hasIssues = duplicates.length > 0 || outOfOrder || legacy.length > 0;
if (strict && hasIssues) {
  process.exitCode = 1;
}
