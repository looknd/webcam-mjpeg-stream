// Dependencies
var koa = require('koa')
var Stream = require('stream')
var http = require('http')
var fs = require('fs')
var path = require('path')
var spawn = require('child_process').spawn

// Environmental variables
var interval = 1000 * (parseInt(process.env.SNAPSHOT_INTERVAL, 10) || 5)
var port = parseInt(process.env.PORT, 10) || null

// Image snapshot stream
var snapshots = new Stream.PassThrough()

snapshots.on('error', function (err) {
  throw err
})

setInterval(snapshot, interval)
snapshot()

function snapshot() {
  var proc = spawn('imagesnap', ['-'])

  proc.on('error', function (err) {
    snapshots.emit('error', err)
  })

  var buffers = []

  proc.stdout.on('data', function (chunk) {
    buffers.push(chunk)
  })

  proc.stdout.once('end', function () {
    snapshots.write('id: ' + Date.now() + '\n')
    snapshots.write('event: image\n')
    snapshots.write('data: ' + Buffer.concat(buffers).toString('base64') + '\n\n')

    buffers = null
  })
}

// Create the app
var app = koa()
var template = fs.readFileSync(path.join(__dirname, 'index.html'))

app.use(require('koa-compress')({
  flush: require('zlib').Z_SYNC_FLUSH
}))

app.use(function (next) {
  return function* () {
    if (this.path !== '/stream')
      return yield next

    this.set('Content-Type', 'text/event-stream')
    this.set('Cache-Control', 'max-age=0, no-cache')
    this.set('Connection', 'keep-alive')

    var stream = this.body = new Stream.PassThrough()

    snapshots.pipe(stream)

    this.req.socket.once('close', function () {
      snapshots.unpipe(stream)
    })
  }
})

app.use(function (next) {
  return function* () {
    if (this.path !== '/')
      return yield next

    this.type = 'html'
    this.body = template
  }
})

// Create the server
var server = http.createServer()
server.on('request', app.callback())
server.timeout = Infinity
server.listen(port, function (err) {
  if (err)
    throw err

  console.log('Server listening on port ' + server.address().port + '.')
})