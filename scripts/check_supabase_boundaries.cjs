const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const TARGET_DIRS = ['src/pages', 'src/components', 'src/contexts'].map((p) => path.join(ROOT, p));

const IMPORT_PATTERNS = [
  /from\s+['"]\.\.\/supabase\/client['"]/,
  /from\s+['"]\.\.\/\.\.\/supabase\/client['"]/,
  /from\s+['"]\.\.\/\.\.\/\.\.\/supabase\/client['"]/,
  /from\s+['"][^'"]*supabase\/client['"]/
];

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function isTsFile(filePath) {
  return filePath.endsWith('.ts') || filePath.endsWith('.tsx');
}

function checkFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');

  for (const re of IMPORT_PATTERNS) {
    if (re.test(content)) {
      return { filePath, reason: 'import_supabase_client' };
    }
  }

  if (/\bsupabase\s*[\.\(\[]/.test(content)) {
    return { filePath, reason: 'supabase_usage' };
  }

  return null;
}

const violations = [];
for (const dir of TARGET_DIRS) {
  if (!fs.existsSync(dir)) continue;
  const files = walk(dir).filter(isTsFile);
  for (const filePath of files) {
    const violation = checkFile(filePath);
    if (violation) violations.push(violation);
  }
}

if (violations.length > 0) {
  process.stderr.write('Supabase boundary violations found:\n');
  for (const v of violations) {
    process.stderr.write(`- ${path.relative(ROOT, v.filePath)} (${v.reason})\n`);
  }
  process.exit(1);
}

process.stdout.write('Supabase boundaries OK\n');
