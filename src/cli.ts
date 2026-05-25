import { main } from './cli-main.js'

main().catch(err => {
  console.error(`Fatal error: ${err.message}`)
  process.exit(1)
})
