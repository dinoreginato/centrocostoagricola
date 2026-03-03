const fs = require('fs');
const path = 'C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js';
try {
  fs.copyFileSync(path, './npm-cli.js');
  console.log('Copied successfully');
} catch (err) {
  console.error('Error copying:', err);
}
