const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SERVICES_DIR = path.join(ROOT, 'src', 'services');

const FILE_EXT = new Set(['.ts', '.tsx']);

const PATTERNS = [
  { re: /\bpayload:\s*any\b/, reason: 'payload:any' },
  { re: /\bpatch:\s*any\b/, reason: 'patch:any' },
  { re: /\brows:\s*any\[\]\b/, reason: 'rows:any[]' },
  { re: /\bas any\b/, reason: 'as any' }
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

function isCodeFile(filePath) {
  return FILE_EXT.has(path.extname(filePath));
}

const files = fs.existsSync(SERVICES_DIR) ? walk(SERVICES_DIR).filter(isCodeFile) : [];

const violations = [];
for (const filePath of files) {
  const content = fs.readFileSync(filePath, 'utf8');
  for (const { re, reason } of PATTERNS) {
    if (re.test(content)) {
      violations.push({ filePath, reason });
      break;
    }
  }
}

if (violations.length > 0) {
  process.stderr.write('Service typing violations found:\n');
  for (const v of violations) {
    process.stderr.write(`- ${path.relative(ROOT, v.filePath)} (${v.reason})\n`);
  }
  process.exit(1);
}

process.stdout.write('Service typing checks OK\n');

