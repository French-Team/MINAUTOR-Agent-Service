const fs = require('fs');
const c = fs.readFileSync('.agents/agent-hecatonchires.ts', 'utf-8');
const start = c.indexOf('instructionsPrompt:');
const end = c.indexOf('toolConfig:');
const inner = c.substring(start, end);
const lines = inner.split('\n');
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('\\') || lines[i].includes('`')) {
    console.log((i + 1) + ': ' + JSON.stringify(lines[i]));
  }
}
