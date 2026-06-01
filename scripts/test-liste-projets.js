#!/usr/bin/env node
import { spawn } from 'child_process'
import { join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
import { dirname } from 'path'

const cli = spawn('node', ['dist/cli-main.js'], {
  cwd: join(__dirname, '..'),
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env },
  shell: true,
})

let output = ''
let sentListe = false
let sentExit = false

cli.stdout.on('data', (data) => {
  output += data.toString()
})

cli.stderr.on('data', (data) => {
  output += '[STDERR] ' + data.toString()
})

cli.on('close', () => {
  const clean = output.replace(/\x1b\[[0-9;]*m/g, '')
  const hasProjectList = clean.includes('soulseek') || clean.includes('Projets disponibles')
  const hasIntercomMsg = clean.includes('équipe compétente')

  if (hasIntercomMsg) {
    console.log('\n❌ FAILURE: Routé via intercom')
  } else if (hasProjectList) {
    console.log('\n✅ SUCCESS: Script-runner a exécuté directement !')
  } else {
    console.log('\n⚠️  À VÉRIFIER:')
  }
  console.log('=== Last 1500 chars ===')
  console.log(clean.slice(-1500))
  console.log('=== END ===')
})

// Feed input after a delay
setTimeout(() => {
  cli.stdin.write('liste les projets\n')
}, 3000)

// Exit after another delay
setTimeout(() => {
  cli.stdin.write('fin\n')
}, 8000)

// Safety kill
setTimeout(() => {
  cli.kill()
}, 15000)
