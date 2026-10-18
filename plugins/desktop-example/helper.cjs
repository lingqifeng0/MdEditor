const readline = require('node:readline')
const lines = readline.createInterface({ input: process.stdin })
lines.on('line', line => {
  try { const request = JSON.parse(line); process.stdout.write(JSON.stringify({ id: request.id, value: String(request.value), pid: process.pid }) + '\n') }
  catch (error) { process.stderr.write(String(error) + '\n') }
})
lines.on('close', () => process.exit(0))
