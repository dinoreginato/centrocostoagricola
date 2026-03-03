const { spawn } = require('child_process');
const npmPath = 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js';
const npxPath = 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npx-cli.js';

console.log('Step 1: Installing vercel...');
const install = spawn('node', [npmPath, 'install', 'vercel', '-D'], { stdio: 'inherit', shell: false });

install.on('close', (code) => {
  if (code !== 0) {
    console.error('Install failed with code', code);
    process.exit(code);
  }
  console.log('Step 1 Done. Step 2: Deploying...');
  
  // Use local vercel if possible, or npx
  // Trying npx first
  const deploy = spawn('node', [npxPath, 'vercel', '--prod', '--yes'], { stdio: 'inherit', shell: false });
  
  deploy.on('close', (c) => {
    console.log('Deploy finished with code', c);
  });
});
