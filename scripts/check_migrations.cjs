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
const timestampedSet = new Set(timestamped);

const legacyReplacements = {
  '20250226_add_machinery_details_and_income.sql': '20250226090000_create_machines_and_income_entries.sql',
  '20250226_add_machinery_details_and_income_v2.sql': '20250226090000_create_machines_and_income_entries.sql',
  '20250226_fix_machines_rls.sql': '20250226090000_create_machines_and_income_entries.sql',
  'add_application_link_to_inventory.sql': '20260422191500_add_application_item_link_to_inventory_movements.sql',
  'create_application_orders.sql': '20260322000000_create_application_orders.sql',
  '20260327_phytosanitary_programs.sql': '20260327000000_create_phytosanitary_programs.sql',
  'create_official_products.sql': '20260422190500_create_official_products.sql',
  'create_production_records.sql': '20260226090000_create_production_records.sql',
  'create_new_sections.sql': '20260317050000_create_assignment_tables.sql',
  'create_labor_assignments.sql': '20260317050000_create_assignment_tables.sql',
  'add_labor_type_to_assignments.sql': '20260317050000_create_assignment_tables.sql',
  'allow_negative_assignments.sql': '20260317050000_create_assignment_tables.sql',
  'update_application_orders_header.sql': '20260322000000_create_application_orders.sql',
  '20260323_add_completed_date_to_app_orders.sql': '20260322000000_create_application_orders.sql',
  '20240327_add_protection_days.sql': '20260322000000_create_application_orders.sql',
  'add_unique_constraint_official_products.sql': '20260422190500_create_official_products.sql',
};

function hasTimestampedReplacement(legacyName) {
  const direct = legacyReplacements[legacyName];
  if (direct && timestampedSet.has(direct)) return true;

  const m = legacyName.match(/^(\d{8})_(.+\.sql)$/);
  if (m) {
    const date8 = m[1];
    const rest = m[2];
    const candidate = timestamped.find((f) => f.startsWith(date8) && f.slice(8, 14).match(/^\d{6}$/) && f.endsWith(`_${rest}`));
    return Boolean(candidate);
  }

  return false;
}

const legacyWithReplacement = legacy.filter(hasTimestampedReplacement);
const legacyRemaining = legacy.filter((f) => !hasTimestampedReplacement(f));

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

if (legacyRemaining.length > 0) {
  console.log('\n[migrations] Legacy (non-timestamp) files (Supabase CLI will not apply these automatically):');
  for (const f of legacyRemaining) console.log(`- ${f}`);
}

if (legacyWithReplacement.length > 0) {
  console.log('\n[migrations] Legacy files that appear to be superseded by timestamped migrations:');
  for (const f of legacyWithReplacement) console.log(`- ${f}`);
}

const hasIssues = duplicates.length > 0 || outOfOrder || legacyRemaining.length > 0;
if (strict && hasIssues) {
  process.exitCode = 1;
}
