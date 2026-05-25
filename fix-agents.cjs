const fs = require('fs');
const files = ['agent-debugger.ts','agent-manager.ts','agent-quality.ts','agent-scrutineer.ts','agent-postmortem.ts','agent-telecom.ts'];

let fixed = 0;
for (const f of files) {
  let c = fs.readFileSync('.agents/' + f, 'utf-8');
  const orig = c;

  // Step 1: Escape bare backticks inside instructionsPrompt content
  // The pattern: instructionsPrompt: `... content with ` bare backticks ` ...
  // We need to replace ` with \` inside the instructionsPrompt text
  // But NOT the opening backtick of instructionsPrompt, and NOT the closing one
  
  // Find instructionsPrompt opening marker
  const ipStart = c.indexOf('instructionsPrompt: `');
  if (ipStart === -1) continue;
  
  // Find spawnerPrompt marker (which comes after instructionsPrompt)
  const spStart = c.indexOf('\nspawnerPrompt:', ipStart);
  if (spStart === -1) continue;
  
  // Content between instructionsPrompt opening and spawnerPrompt line
  const beforeIP = c.substring(0, ipStart + 'instructionsPrompt: `'.length);
  const ipContent = c.substring(ipStart + 'instructionsPrompt: `'.length, spStart);
  const afterIP = c.substring(spStart);
  
  // In the ipContent, escape ALL backticks that are NOT already preceded by a backslash
  // We use negative lookbehind: replace ` that is not preceded by \
  let fixedContent = ipContent.replace(/(?<!\\)`/g, '\\`');
  
  c = beforeIP + fixedContent + afterIP;

  // Step 2: Fix the spawnerPrompt line - remove trailing extra `, if present
  // The extra `, after spawnerPrompt: `...` should be removed
  c = c.replace(/`,\n\s*toolConfig:/g, '`,\n  toolConfig:');

  if (c !== orig) {
    fs.writeFileSync('.agents/' + f, c, 'utf-8');
    console.log('✓ Fixed: ' + f);
    fixed++;
  }
}

console.log('\n' + fixed + ' file(s) fixed.');
