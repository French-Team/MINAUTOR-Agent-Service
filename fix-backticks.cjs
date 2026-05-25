const fs = require('fs');
const path = require('path');
const glob = require('fs').readdirSync;

const agentsDir = path.join(__dirname, '.agents');
const files = fs.readdirSync(agentsDir).filter(f => f.endsWith('.ts') && f !== 'tsconfig.json');

let fixed = 0;

for (const file of files) {
  const filePath = path.join(agentsDir, file);
  let content = fs.readFileSync(filePath, 'utf-8');
  const original = content;

  // Match instructionsPrompt: `...` with multi-line content
  // We need to find backticks INSIDE the template literal that are NOT already escaped
  const startMarker = 'instructionsPrompt: `';
  const idx = content.indexOf(startMarker);
  if (idx === -1) continue;

  // Find the start of the template literal content (after the opening backtick)
  const start = idx + startMarker.length;
  
  // Find the closing backtick (the one that properly ends instructionsPrompt)
  // We need to track escaped backticks to find the real closing one
  let depth = 0;
  let closingIdx = -1;
  for (let i = start; i < content.length; i++) {
    if (content[i] === '\\' && i + 1 < content.length && content[i+1] === '`') {
      i++; // skip escaped backtick
      continue;
    }
    if (content[i] === '`') {
      closingIdx = i;
      break;
    }
  }

  if (closingIdx === -1) continue;

  // Now extract the inner content and find all unescaped backticks
  const before = content.substring(0, start);
  const inner = content.substring(start, closingIdx);
  const after = content.substring(closingIdx + 1);

  // Replace unescaped backticks in the inner content with escaped ones
  // A backtick is "unescaped" if preceded by an even number of backslashes (or 0)
  const fixedInner = inner.replace(/(?<!\\)(?:\\\\)*`/g, (match) => {
    // match includes the preceding non-backslash characters + the backtick
    // We need to replace just the backtick with \`
    const prefix = match.slice(0, -1);
    return prefix + '\\`';
  });

  if (fixedInner === inner) {
    // No actual changes needed - no bare backticks found
    // But let's check if there are already escaped backticks that might have been double-escaped
    continue;
  }

  content = before + fixedInner + after;

  if (content !== original) {
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`✓ Fixed: ${file}`);
    fixed++;
  }
}

console.log(`\n${fixed} file(s) fixed.`);
