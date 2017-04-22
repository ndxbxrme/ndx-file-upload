'use strict'
fs = require 'fs'
path = require 'path'
mkdirp = require 'mkdirp'
multiparty = require 'connect-multiparty'

module.exports = (ndx) ->
  callbacks =
    upload: []
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
        rs = fs.createReadStream file.path
        ws = fs.createWriteStream outpath
        rs.pipe ws
        rs.on 'end', ->
          fs.unlinkSync file.path
        outobj =
          filename: filename
          path: outpath.replace /\\/g, /\//
          originalFilename: file.originalFilename
          type: file.type
          size: file.size
          date: new Date().valueOf()
          ext: path.extname(file.originalFilename).replace /^\./, ''
        ndx.extend outobj, req.body
        syncCallback 'upload', outobj
        outobj
      if Object.prototype.toString.call(req.files.file) is '[object Array]'
        for file in req.files.file
          output.push saveFile file
      else
        output.push saveFile req.files.file
      res.json output
  if ndx.settings.serveUploads or process.env.SERVE_UPLOADS
    ndx.app.use '/uploads', ndx.static('./uploads')