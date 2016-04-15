var pull   = require('pull-stream')
var toPull = require('stream-to-pull-stream')
var cat    = require('pull-cat')
var ident  = require('pull-identify-filetype')
var mime   = require('mime-types')
var URL    = require('url')
var fs     = require('fs')
var refs   = require('ssb-ref')
var Stack  = require('stack')
var ip     = require('ip')

exports = module.exports = function (sbot, config) {
  require('http').createServer(exports.BlobStack(sbot)).listen(7777)
  .on('error', function (err) {
    console.error(err.stack)
  })
}

function respond (res, status, message) {
  res.writeHead(status)
  res.end(message)
}

function respondSource (res, source, wrap) {
  if(wrap) {
    res.writeHead(200, {'Content-Type': 'text/html'})
    pull(
      cat([
        pull.once('<html><body><script>'),
        source,
        pull.once('</script></body></html>')
      ]),
      toPull.sink(res)
    )
  }
  else {
    pull(
      source,
      ident(function (type) {
        if (type) res.writeHead(200, {'Content-Type': mime.lookup(type)})
      }),
      toPull.sink(res)
    )
  }
}

var Localhost = exports.Localhost = function () {
  return function (req, res, next) {
    if (!ip.isLoopback(req.socket.remoteAddress))
      return respond(res, 403, 'Remote access forbidden')
    next()
  }
}

var CSP = exports.CSP = function (origin) {
  return function (req, res, next) {
    res.setHeader('Content-Security-Policy', 
      "default-src "+origin+" 'unsafe-inline' 'unsafe-eval' data:; "+
      "object-src 'none'; "+
      "frame-src 'none'; "+
      "sandbox"
    )
    next()
  }
}

var ServeBlobs = exports.ServeBlobs = function (sbot) {
  return function (req, res, next) {
    var parsed = URL.parse(req.url, true)
    var hash = parsed.pathname.slice(1)
    sbot.blobs.want(hash, function(err, has) {
      if (!has) return respond(res, 404, 'File not found')

      // optional name override
      if (parsed.query.name)
        res.setHeader('Content-Disposition', 'inline; filename='+encodeURIComponent(parsed.query.name))

      // serve
      respondSource(res, sbot.blobs.get(hash), false)
    })
  }
}

var ServeFiles = exports.ServeFiles = function () {
  return function (req, res, next) {
    var parsed = URL.parse(req.url, true)
    fs.stat(parsed.pathname, function (err, stat) {
      if(err) return respond(res, 404, 'File not found')
      if(!stat.isFile()) return respond(res, 403, 'May only load filess')
      respondSource(
        res,
        toPull.source(fs.createReadStream(parsed.pathname)),
        false
      )
    })
  }
}

exports.BlobStack = function (sbot, opts) {
  return Stack(
    Localhost(),
    CSP('http://localhost:7777'),
    ServeBlobs(sbot)
  )
}

exports.FileStack = function (opts) {
  return Stack(
    Localhost(),
    CSP('http://localhost:7777'),
    ServeFiles()
  )
}
