'use strict'
fs = require 'fs'
path = require 'path'
mkdirp = require 'mkdirp'
multiparty = require 'connect-multiparty'
atob = require 'atob'
mime = require 'mime'
crypto = require 'crypto'
zlib = require 'zlib'

algorithm = 'aes-256-ctr'

module.exports = (ndx) ->
  doencrypt = !ndx.settings.DO_NOT_ENCRYPT
  dozip = !ndx.settings.DO_NOT_ENCRYPT
  callbacks =
    upload: []
    download: []
  syncCallback = (name, obj, cb) ->
    if callbacks[name] and callbacks[name].length
      for callback in callbacks[name]
        callback obj
    cb?()
  ndx.app.post '/api/upload', ndx.authenticate(), multiparty(), (req, res) ->
    output = []
    folder = './uploads'
    if req.body.folder
      folder = path.join folder, req.body.folder
    mkdirp folder, (err) ->
      saveFile = (file) ->
        filename = ndx.generateID(12) + path.extname(file.originalFilename)
        outpath = path.join(folder, filename)
        encrypt = crypto.createCipher algorithm, ndx.settings.ENCRYPTION_KEY or ndx.settings.SESSION_SECRET or '5random7493nonsens!e'
        gzip = zlib.createGzip()
        rs = fs.createReadStream file.path
        ws = fs.createWriteStream outpath
        st = null
        if dozip
          st = rs.pipe gzip
        if doencrypt
          if st
            st = st.pipe encrypt
          else
            st = rs.pipe encrypt
        if not st
          st = rs
        st.pipe ws
        rs.on 'end', ->
          fs.unlinkSync file.path
        outobj =
          filename: filename
          path: outpath.replace /\\/g, '/'
          originalFilename: file.originalFilename
          type: file.type
          basetype: file.type.replace /\/.*/, ''
          size: file.size
          date: new Date().valueOf()
          ext: path.extname(file.originalFilename).replace /^\./, ''
        ndx.extend outobj, req.body
        syncCallback 'upload', 
          user: ndx.user
          obj: outobj
        outobj
      if Object.prototype.toString.call(req.files.file) is '[object Array]'
        for file in req.files.file
          output.push saveFile file
      else if req.files.file
        output.push saveFile req.files.file
      else
        console.log 'no file'
      res.json output
  ndx.app.get '/api/download/:data', ndx.authenticate(), (req, res, next) ->
    try
      document = JSON.parse atob req.params.data
      mimetype = mime.lookup document.path
      res.setHeader 'Content-disposition', 'attachment; filename=' + document.filename
      res.setHeader 'Content-type', mimetype
      filestream = fs.createReadStream document.path
      decrypt = crypto.createDecipher algorithm, ndx.settings.ENCRYPTION_KEY or ndx.settings.SESSION_SECRET or '5random7493nonsens!e'
      gunzip = zlib.createGunzip()
      st = filestream
      if doencrypt
        st = st.pipe decrypt
      if dozip
        st = st.pipe gunzip
      st.pipe res
      syncCallback 'download', 
        user: ndx.user
        obj: document
    catch e
      console.log e
      next e
  ndx.fileUpload =
    on: (name, callback) ->
      callbacks[name].push callback
    off: (name, callback) ->
      callbacks[name].splice callbacks[name].indexOf(callback), 1
    download: (res, data, filename) ->
      mimetype = mime.lookup filename
      res.setHeader 'Content-disposition', 'attachment; filename=' + filename
      res.setHeader 'Content-type', mimetype
      res.end data
      syncCallback 'download', 
        user: ndx.user
        obj:
          filename: filename
          mimetype: mimetype
    downloadStream: (res, stream, filename) ->
      mimetype = mime.lookup filename
      res.setHeader 'Content-disposition', 'attachment; filename=' + filename
      res.setHeader 'Content-type', mimetype
      stream.pipe res
      syncCallback 'download', 
        user: ndx.user
        obj:
          filename: filename
          mimetype: mimetype
      
  if ndx.settings.SERVE_UPLOADS or process.env.SERVE_UPLOADS
    ndx.app.use '/uploads', ndx.static('./uploads')