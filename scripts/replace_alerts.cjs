const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'src');

function walkDir(dir, callback) {
  fs.readdirSync(dir).forEach(f => {
    const dirPath = path.join(dir, f);
    const isDirectory = fs.statSync(dirPath).isDirectory();
    isDirectory ? walkDir(dirPath, callback) : callback(dirPath);
  });
}

walkDir(srcDir, (filePath) => {
  if (filePath.endsWith('.tsx') || filePath.endsWith('.ts')) {
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Check if file uses alert
    if (content.includes('alert(')) {
      // Replace alert( with toast(
      content = content.replace(/\balert\(/g, 'toast(');
      
      // Replace toast('Error... with toast.error('Error... (basic heuristic)
      content = content.replace(/toast\(\s*(['"`])([Ee]rror.*?)\1/g, 'toast.error($1$2$1');
      
      // If it has toast but no import, add it
      if (content.includes('toast(') || content.includes('toast.')) {
        if (!content.includes("import { toast } from 'sonner'")) {
          // Add import after the first import or at top
          content = "import { toast } from 'sonner';\n" + content;
        }
      }
      
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`Updated ${filePath}`);
    }
  }
});
