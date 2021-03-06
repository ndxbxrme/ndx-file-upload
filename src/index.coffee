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
base64 = require 'base64-stream'

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
            ws = fs.createWriteStream outpath
            st.pipe ws
            ws.on 'error', (err) ->
              console.log 'write error', err
              callback err, null
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
            ws.on 'finish', ->
              done()
              if useAWS
                ws = s3Stream.upload
                  Bucket: AWS.config.bucket
                  Key: awsPrefix + outpath.replace(/\\/g, '/')
                rs = fs.createReadStream outpath
                rs.pipe ws
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
  getReadStream = (path) ->
    new Promise (resolve, reject) ->
      decrypt = crypto.createDecipher algorithm, ndx.settings.ENCRYPTION_KEY or ndx.settings.SESSION_SECRET or '5random7493nonsens!e'
      gunzip = zlib.createGunzip()
      sendFileToRes = ->
        st = fs.createReadStream path
        if doencrypt
          st = st.pipe decrypt
        if dozip
          st = st.pipe gunzip
        resolve st
        st.on 'error', (e) ->
          reject e
        decrypt.on 'error', (e) ->
          reject e
        gunzip.on 'error', (e) ->
          reject e
      fs.exists path, (fileExists) ->
        if fileExists
          sendFileToRes()
        else
          if useAWS
            try
              st = S3.getObject
                Bucket: AWS.config.bucket
                Key: path
              .createReadStream()
              ws = fs.createWriteStream path
              st.pipe ws
              ws.on 'finish', ->
                sendFileToRes()
            catch e
              reject()
          else
            reject()
  fetchBase64 = (path) ->
    new Promise (resolve, reject) ->
      getReadStream path
      .then (st) ->
        b64 = st.pipe(base64.encode())
        output = ''
        b64.on 'data', (data) ->
          output += data.toString('utf-8')
        b64.on 'error', (err) ->
          reject err
        b64.on 'end', ->
          resolve output
  ndx.app.get '/api/download/:data', (req, res, next) ->
    ((user) ->
      document = JSON.parse atob req.params.data
      mimetype = mime.lookup document.path
      res.setHeader 'Content-disposition', 'attachment; filename=' + document.filename
      res.setHeader 'Content-type', mimetype
      getReadStream document.path
      .then (st) ->
        st.pipe res
        syncCallback 'download', 
          user: user
          obj: document
      , (err) ->
        res.end()
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
    fetchBase64: fetchBase64