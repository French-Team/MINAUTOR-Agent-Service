import { readFileSync } from 'node:fs'

const raw = readFileSync('data/scripts/registry.yaml', 'utf-8')
console.log('=== RAW FILE ===')
console.log(raw.slice(0, 500))
console.log('=== END ===')
console.log('Total lines:', raw.split('\n').length)

const lines = raw.split('\n')
// Test the first 10 lines
for (let i = 0; i < 30; i++) {
  const trimmed = lines[i].trimEnd()
  const scriptMatch = trimmed.match(/^-\s+pattern:\s*"(.+)"/)
  console.log(`Line ${i}: ${JSON.stringify(trimmed)} → ${scriptMatch ? 'MATCH: ' + JSON.stringify(scriptMatch[1]) : 'no match'}`)
}
