const fs = require('fs');
const path = require('path');

const agentsDir = path.join(__dirname, '.agents');
const files = fs.readdirSync(agentsDir).filter(f => f.endsWith('.ts') && f !== 'tsconfig.json');

let fixed = 0;

for (const file of files) {
  const filePath = path.join(agentsDir, file);
  let content = fs.readFileSync(filePath, 'utf-8');
  const original = content;

  // Step 1: Fix over-escaped backticks in instructionsPrompt
  // Replace \\\` (3 backslashes + backtick) with \` (1 backslash + backtick)
  // In the raw file, \\\` means backslash-backslash-backslash-backtick
  // In a template literal, \\\` produces \` (backslash + backtick) 
  // We want \` which produces just backtick
  content = content.replace(/\\\\\\`/g, '\\`');

  // Step 2: Fix over-escaped backticks in spawnerPrompt
  content = content.replace(/\\\\\\`/g, '\\`');
  
  // Step 3: Ensure instructionsPrompt has a closing backtick before spawnerPrompt:
  // Look for the pattern: end of instructionsPrompt content followed by spawnerPrompt:
  // Without a closing backtick in between
  const ipRegex = /(instructionsPrompt:\s*`[\s\S]*?)(\n\s*spawnerPrompt:)/g;
  content = content.replace(ipRegex, (match, promptContent, rest) => {
    // Check if the promptContent already ends with a backtick
    if (promptContent.endsWith('`')) {
      return match; // Already has closing backtick
    }
    // Add closing backtick and comma
    return promptContent + '`,\n' + rest.trimStart();
  });

  // Step 4: Ensure spawnerPrompt has a closing backtick
  // Look for spawnerPrompt: `...  followed by toolConfig: without closing backtick
  const spRegex = /(spawnerPrompt:\s*`[\s\S]*?)(\n\s*toolConfig:)/g;
  content = content.replace(spRegex, (match, promptContent, rest) => {
    if (promptContent.endsWith('`')) {
      return match;
    }
    return promptContent + '`,\n' + rest.trimStart();
  });

  // Step 5: Final cleanup - if any \\\\\` exists (4 backslashes + backtick)
  content = content.replace(/\\\\\\`/g, '\\`');

  if (content !== original) {
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`✓ Fixed: ${file}`);
    fixed++;
  }
}

console.log(`\n${fixed} file(s) fixed.`);
