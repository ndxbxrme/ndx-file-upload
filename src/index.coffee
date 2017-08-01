'use strict'
fs = require 'fs'
path = require 'path'
mkdirp = require 'mkdirp'
multiparty = require 'connect-multiparty'
atob = require 'atob'
mime = require 'mime'
crypto = require 'crypto'
zlib = require 'zlib'
AWS = require 'aws-sdk'
async = require 'async'

module.exports = (ndx) ->
  algorithm = ndx.settings.ENCRYPTION_ALGORITHM or 'aes-256-ctr'
  useAWS = ndx.settings.FILEUPLOAD_AWS or process.env.FILEUPLOAD_AWS
  AWS.config.bucket = ndx.settings.FILEUPLOAD_AWS_BUCKET or process.env.FILEUPLOAD_AWS_BUCKET or ndx.settings.AWS_BUCKET
  AWS.config.region = ndx.settings.FILEUPLOAD_AWS_REGION or process.env.FILEUPLOAD_AWS_REGION or ndx.settings.AWS_REGION or 'us-east-1'
  AWS.config.accessKeyId = ndx.settings.FILEUPLOAD_AWS_ID or process.env.FILEUPLOAD_AWS_ID or ndx.settings.AWS_ID
  AWS.config.secretAccessKey = ndx.settings.FILEUPLOAD_AWS_KEY or process.env.FILEUPLOAD_AWS_KEY or ndx.settings.AWS_KEY
  awsPrefix = ndx.settings.FILEUPLOAD_AWS_PREFIX or process.env.FILEUPLOAD_AWS_PREFIX or ndx.settings.AWS_PREFIX or process.env.AWS_PREFIX or ''
  #console.log 'AWS config', AWS.config
  S3 = new AWS.S3()
  s3Stream = require('s3-upload-stream') S3
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
    ((user) ->
      output = []
      folder = 'uploads'
      if req.body.folder
        folder = path.join folder, req.body.folder
      mkdirp folder, (err) ->
        saveFile = (file, callback) ->
          if file
            filename = ndx.generateID(12) + path.extname(file.originalFilename)
            outpath = path.join(folder, filename)
            encrypt = crypto.createCipher algorithm, ndx.settings.ENCRYPTION_KEY or ndx.settings.SESSION_SECRET or '5random7493nonsens!e'
            gzip = zlib.createGzip()
            rs = fs.createReadStream file.path
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
            ws = null
            if useAWS
              ws = s3Stream.upload
                Bucket: AWS.config.bucket
                Key: awsPrefix + outpath.replace(/\\/g, '/')
            else
              ws = fs.createWriteStream outpath
            st.pipe ws
            ws.on 'error', (err) ->
              console.log 'write error', err
            done = ->
              fs.unlinkSync file.path
              outobj =
                filename: filename
                path: awsPrefix + outpath.replace(/\\/g, '/')
                originalFilename: file.originalFilename
                type: file.type
                basetype: file.type.replace /\/.*/, ''
                size: file.size
                date: new Date().valueOf()
                ext: path.extname(file.originalFilename).replace /^\./, ''
                tags: req.body.tags
              ndx.extend outobj, req.body
              callback null, outobj
              syncCallback 'upload', 
                user: user
                obj: outobj
            if useAWS
              ws.on 'uploaded', done
            else
              ws.on 'finish', done
            rs.on 'error', (e) ->
              callback e, null
            encrypt.on 'error', (e) ->
              console.log e
            gzip.on 'error', (e) ->
              console.log e
          else
            callback 'no file', null
          #outobj
        files = []
        if Object.prototype.toString.call(req.files.file) is '[object Array]'
          files = req.files.file
        else
          if req.files.file
            files = [req.files.file]
        if files.length
          async.map files, saveFile, (err, output) ->
            res.json output
    )(ndx.user)
  ndx.app.get '/api/download/:data', ndx.authenticate(), (req, res, next) ->
    ((user) ->
      try
        document = JSON.parse atob req.params.data
        mimetype = mime.lookup document.path
        res.setHeader 'Content-disposition', 'attachment; filename=' + document.filename
        res.setHeader 'Content-type', mimetype
        decrypt = crypto.createDecipher algorithm, ndx.settings.ENCRYPTION_KEY or ndx.settings.SESSION_SECRET or '5random7493nonsens!e'
        gunzip = zlib.createGunzip()
        st = null
        if useAWS
          st = S3.getObject
            Bucket: AWS.config.bucket
            Key: document.path
          .createReadStream()
        else
          st = fs.createReadStream document.path
        if doencrypt
          st = st.pipe decrypt
        if dozip
          st = st.pipe gunzip
        st.pipe res
        st.on 'error', (e) ->
          console.log e
        decrypt.on 'error', (e) ->
          console.log e
        gunzip.on 'error', (e) ->
          console.log e
        st.on 'end', ->
          syncCallback 'download', 
            user: ndx.user
            obj: document
      catch e
        console.log e
        next e
    )(ndx.user)
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