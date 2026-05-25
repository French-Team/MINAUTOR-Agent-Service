const fs = require('fs');
const files = ['agent-debugger.ts', 'agent-manager.ts', 'agent-quality.ts', 'agent-scrutineer.ts', 'agent-postmortem.ts', 'agent-telecom.ts', 'agent-superviseur.ts'];

for (const f of files) {
  const c = fs.readFileSync('.agents/' + f, 'utf-8');
  const s = c.indexOf('instructionsPrompt:');
  const e = c.indexOf('spawnerPrompt:');
  if (s === -1 || e === -1) continue;
  // Show 30 chars before spawnerPrompt:
  const around = c.substring(e - 40, e + 60);
  console.log('=== ' + f + ' ===');
  console.log(JSON.stringify(c.substring(e - 40, e + 70)));
  console.log('');
}
