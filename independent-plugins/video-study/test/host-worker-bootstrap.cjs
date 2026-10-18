// A Node child transports the real SDK worker protocol in a disposable profile.
process.parentPort = {
  on(name, callback) {
    if (name === 'message') process.on('message', data => callback({ data }))
  },
  postMessage(message) { if (process.connected) process.send(message) }
}
require(process.argv[2])
