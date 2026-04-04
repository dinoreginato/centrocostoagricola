const fs = require('fs');
const path = require('path');

const mappings = [
  { regex: /(?<!dark:)\bbg-white\b/g, replacement: 'bg-white dark:bg-gray-800' },
  { regex: /(?<!dark:)\bbg-gray-50\b/g, replacement: 'bg-gray-50 dark:bg-gray-900' },
  { regex: /(?<!dark:)\bbg-gray-100\b/g, replacement: 'bg-gray-100 dark:bg-gray-900' },
  { regex: /(?<!dark:)\btext-gray-900\b/g, replacement: 'text-gray-900 dark:text-gray-100' },
  { regex: /(?<!dark:)\btext-gray-800\b/g, replacement: 'text-gray-800 dark:text-gray-200' },
  { regex: /(?<!dark:)\btext-gray-700\b/g, replacement: 'text-gray-700 dark:text-gray-300' },
  { regex: /(?<!dark:)\btext-gray-600\b/g, replacement: 'text-gray-600 dark:text-gray-400' },
  { regex: /(?<!dark:)\btext-gray-500\b/g, replacement: 'text-gray-500 dark:text-gray-400' },
  { regex: /(?<!dark:)\bborder-gray-200\b/g, replacement: 'border-gray-200 dark:border-gray-700' },
  { regex: /(?<!dark:)\bborder-gray-300\b/g, replacement: 'border-gray-300 dark:border-gray-600' },
  { regex: /(?<!dark:)\bdivide-gray-200\b/g, replacement: 'divide-gray-200 dark:divide-gray-700' },
  { regex: /(?<!dark:)\bhover:bg-gray-50\b/g, replacement: 'hover:bg-gray-50 dark:hover:bg-gray-700' },
  { regex: /(?<!dark:)\bhover:bg-gray-100\b/g, replacement: 'hover:bg-gray-100 dark:hover:bg-gray-700' },
];

function processDirectory(directory) {
  const files = fs.readdirSync(directory);

  for (const file of files) {
    const fullPath = path.join(directory, file);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      processDirectory(fullPath);
    } else if (fullPath.endsWith('.tsx') || fullPath.endsWith('.ts')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      let originalContent = content;
      
      for (const { regex, replacement } of mappings) {
        content = content.replace(regex, replacement);
      }
      
      // Additional cleanup: avoid double applying if already done
      content = content.replace(/dark:bg-gray-800 dark:bg-gray-800/g, 'dark:bg-gray-800');
      // more cleanups if necessary...

      if (content !== originalContent) {
        fs.writeFileSync(fullPath, content, 'utf8');
        console.log(`Updated: ${fullPath}`);
      }
    }
  }
}

processDirectory(path.join(__dirname, '../src'));
console.log('Done replacing common utility classes for dark mode.');
