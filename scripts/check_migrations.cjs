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
  'add_agronomic_fields.sql': '20240117090000_add_agronomic_fields.sql',
  'add_application_link_to_inventory.sql': '20260422191500_add_application_item_link_to_inventory_movements.sql',
  'delete_application_restore_stock.sql': '20260422189000_harden_application_and_assignment_rpcs.sql',
  'delete_all_applications.sql': '20260422189000_harden_application_and_assignment_rpcs.sql',
  'admin_management.sql': '20260422191000_harden_admin_management.sql',
  'create_assignment_summaries_rpc.sql': '20260422189000_harden_application_and_assignment_rpcs.sql',
  'create_delete_all_rpc.sql': '20260422189000_harden_application_and_assignment_rpcs.sql',
  'delete_function.sql': '20260422192500_delete_all_invoices_for_companies.sql',
  'emergency_fix_rls.sql': '20260226115600_backfill_production_records_company_id.sql',
  'fix_applications_update.sql': '20260422152000_update_application_inventory_with_fuel.sql',
  'fix_applications_visibility.sql': '20260422189000_harden_application_and_assignment_rpcs.sql',
  'fix_applications_visibility_ids.sql': '20260422189000_harden_application_and_assignment_rpcs.sql',
  'fix_applications_visibility_ids_v2.sql': '20260422189000_harden_application_and_assignment_rpcs.sql',
  'fix_company_deletion_cascade.sql': '20260422220000_fix_company_members_cascade.sql',
  'fix_duplicates_rpc.sql': '20260422221000_clean_invoice_duplicates.sql',
  'fix_get_company_members_access.sql': '20260422187000_harden_users_rpcs.sql',
  'fix_inventory_logic.sql': '20260422186000_harden_inventory_helpers.sql',
  'fix_labor_assignments_rls.sql': '20260422216000_consolidate_rls_policies.sql',
  'fix_labor_assignments_rls_v2.sql': '20260422216000_consolidate_rls_policies.sql',
  'fix_production_permissions.sql': '20260422216000_consolidate_rls_policies.sql',
  'fix_production_rls.sql': '20260422216000_consolidate_rls_policies.sql',
  'fix_production_rls_final.sql': '20260422216000_consolidate_rls_policies.sql',
  'simplify_production_rls.sql': '20260422216000_consolidate_rls_policies.sql',
  'fix_rpc_return_type.sql': '20260422189000_harden_application_and_assignment_rpcs.sql',
  'fix_rpc_visibility.sql': '20260422187000_harden_users_rpcs.sql',
  'fix_update_application_rpc_objective.sql': '20260422152000_update_application_inventory_with_fuel.sql',
  'force_clean_all_apps.sql': '20260422223000_force_clean_all_applications.sql',
  'force_delete_invoice.sql': '20260422141000_fix_delete_invoice_force_with_effects.sql',
  'optimize_applications_rls.sql': '20260422216000_consolidate_rls_policies.sql',
  'optimize_labor_rls.sql': '20260422216000_consolidate_rls_policies.sql',
  'rebuild_applications_logic.sql': '20260422189000_harden_application_and_assignment_rpcs.sql',
  'reverse_inventory.sql': '20260422186000_harden_inventory_helpers.sql',
  'update_application_rpc.sql': '20260422152000_update_application_inventory_with_fuel.sql',
  'update_rls_for_members.sql': '20260422216000_consolidate_rls_policies.sql',
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

const knownDuplicateTimestamps = {
  '20260226133000': ['20260422215000_consolidate_company_access_helpers.sql', '20260422216000_consolidate_rls_policies.sql'],
  '20260226140000': ['20260422218000_consolidate_price_per_kg.sql'],
  '20260226150000': ['20260422219000_consolidate_general_costs.sql', '20260422216000_consolidate_rls_policies.sql'],
  '20260316000000': ['20260422217000_consolidate_viewer_role.sql'],
};

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

const knownDuplicates = duplicates.filter(([ts]) => Boolean(knownDuplicateTimestamps[ts]));
const unknownDuplicates = duplicates.filter(([ts]) => !knownDuplicateTimestamps[ts]);

const sortedAll = [...timestamped].sort((a, b) => a.localeCompare(b));
const outOfOrder = timestamped.some((f, i) => f !== sortedAll[i]);

console.log('[migrations] directory:', MIGRATIONS_DIR);
console.log('[migrations] total:', all.length);
console.log('[migrations] timestamped:', timestamped.length);
console.log('[migrations] legacy:', legacy.length);

if (unknownDuplicates.length > 0) {
  console.log('\n[migrations] DUPLICATE timestamps found (unmapped):');
  for (const [ts, files] of unknownDuplicates) {
    console.log(`- ${ts}`);
    for (const f of files) console.log(`  - ${f}`);
  }
}

if (knownDuplicates.length > 0) {
  console.log('\n[migrations] DUPLICATE timestamps found (known + mitigated by canonical migrations):');
  for (const [ts, files] of knownDuplicates) {
    console.log(`- ${ts}`);
    for (const f of files) console.log(`  - ${f}`);
    const mitigations = knownDuplicateTimestamps[ts] || [];
    for (const m of mitigations) console.log(`  -> ${m}`);
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

const hasIssues = unknownDuplicates.length > 0 || outOfOrder || legacyRemaining.length > 0;
if (strict && hasIssues) {
  process.exitCode = 1;
}
