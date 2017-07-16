(function() {
  'use strict';
  var AWS, async, atob, crypto, fs, mime, mkdirp, multiparty, path, zlib;

  fs = require('fs');

  path = require('path');

  mkdirp = require('mkdirp');

  multiparty = require('connect-multiparty');

  atob = require('atob');

  mime = require('mime');

  crypto = require('crypto');

  zlib = require('zlib');

  AWS = require('aws-sdk');

  async = require('async');

  module.exports = function(ndx) {
    var S3, algorithm, awsPrefix, callbacks, doencrypt, dozip, s3Stream, syncCallback, useAWS;
    algorithm = ndx.settings.ENCRYPTION_ALGORITHM || 'aes-256-ctr';
    useAWS = ndx.settings.FILEUPLOAD_AWS || process.env.FILEUPLOAD_AWS;
    AWS.config.bucket = ndx.settings.FILEUPLOAD_AWS_BUCKET || process.env.FILEUPLOAD_AWS_BUCKET || ndx.settings.AWS_BUCKET;
    AWS.config.region = ndx.settings.FILEUPLOAD_AWS_REGION || process.env.FILEUPLOAD_AWS_REGION || ndx.settings.AWS_REGION || 'us-east-1';
    AWS.config.accessKeyId = ndx.settings.FILEUPLOAD_AWS_ID || process.env.FILEUPLOAD_AWS_ID || ndx.settings.AWS_ID;
    AWS.config.secretAccessKey = ndx.settings.FILEUPLOAD_AWS_KEY || process.env.FILEUPLOAD_AWS_KEY || ndx.settings.AWS_KEY;
    awsPrefix = ndx.settings.FILEUPLOAD_AWS_PREFIX || process.env.FILEUPLOAD_AWS_PREFIX || ndx.settings.AWS_PREFIX || process.env.AWS_PREFIX || '';
    S3 = new AWS.S3();
    s3Stream = require('s3-upload-stream')(S3);
    doencrypt = !ndx.settings.DO_NOT_ENCRYPT;
    dozip = !ndx.settings.DO_NOT_ENCRYPT;
    callbacks = {
      upload: [],
      download: []
    };
    syncCallback = function(name, obj, cb) {
      var callback, i, len, ref;
      if (callbacks[name] && callbacks[name].length) {
        ref = callbacks[name];
        for (i = 0, len = ref.length; i < len; i++) {
          callback = ref[i];
          callback(obj);
        }
      }
      return typeof cb === "function" ? cb() : void 0;
    };
    ndx.app.post('/api/upload', ndx.authenticate(), multiparty(), function(req, res) {
      console.log('upload');
      return (function(user) {
        var folder, output;
        output = [];
        folder = 'uploads';
        if (req.body.folder) {
          folder = path.join(folder, req.body.folder);
        }
        return mkdirp(folder, function(err) {
          var files, saveFile;
          saveFile = function(file, callback) {
            var encrypt, filename, gzip, outpath, rs, st, ws;
            if (file) {
              filename = ndx.generateID(12) + path.extname(file.originalFilename);
              outpath = path.join(folder, filename);
              encrypt = crypto.createCipher(algorithm, ndx.settings.ENCRYPTION_KEY || ndx.settings.SESSION_SECRET || '5random7493nonsens!e');
              gzip = zlib.createGzip();
              rs = fs.createReadStream(file.path);
              st = null;
              if (dozip) {
                st = rs.pipe(gzip);
              }
              if (doencrypt) {
                if (st) {
                  st = st.pipe(encrypt);
                } else {
                  st = rs.pipe(encrypt);
                }
              }
              if (!st) {
                st = rs;
              }
              ws = null;
              if (useAWS) {
                ws = s3Stream.upload({
                  Bucket: AWS.config.bucket,
                  Key: awsPrefix + outpath.replace(/\\/g, '/')
                });
              } else {
                ws = fs.createWriteStream(outpath);
              }
              st.pipe(ws);
              rs.on('end', function() {
                var outobj;
                fs.unlinkSync(file.path);
                outobj = {
                  filename: filename,
                  path: awsPrefix + outpath.replace(/\\/g, '/'),
                  originalFilename: file.originalFilename,
                  type: file.type,
                  basetype: file.type.replace(/\/.*/, ''),
                  size: file.size,
                  date: new Date().valueOf(),
                  ext: path.extname(file.originalFilename).replace(/^\./, ''),
                  tags: req.body.tags
                };
                ndx.extend(outobj, req.body);
                callback(null, outobj);
                return syncCallback('upload', {
                  user: user,
                  obj: outobj
                });
              });
              rs.on('error', function(e) {
                return callback(e, null);
              });
              encrypt.on('error', function(e) {
                return console.log(e);
              });
              return gzip.on('error', function(e) {
                return console.log(e);
              });
            } else {
              return callback('no file', null);
            }
          };
          files = [];
          if (Object.prototype.toString.call(req.files.file) === '[object Array]') {
            files = req.files.file;
          } else {
            if (req.files.file) {
              files = [req.files.file];
            }
          }
          if (files.length) {
            return async.map(files, saveFile, function(err, output) {
              return res.json(output);
            });
          }
        });
      })(ndx.user);
    });
    ndx.app.get('/api/download/:data', ndx.authenticate(), function(req, res, next) {
      return (function(user) {
        var decrypt, document, e, error, gunzip, mimetype, st;
        try {
          document = JSON.parse(atob(req.params.data));
          mimetype = mime.lookup(document.path);
          res.setHeader('Content-disposition', 'attachment; filename=' + document.filename);
          res.setHeader('Content-type', mimetype);
          decrypt = crypto.createDecipher(algorithm, ndx.settings.ENCRYPTION_KEY || ndx.settings.SESSION_SECRET || '5random7493nonsens!e');
          gunzip = zlib.createGunzip();
          st = null;
          if (useAWS) {
            st = S3.getObject({
              Bucket: AWS.config.bucket,
              Key: document.path
            }).createReadStream();
          } else {
            st = fs.createReadStream(document.path);
          }
          if (doencrypt) {
            st = st.pipe(decrypt);
          }
          if (dozip) {
            st = st.pipe(gunzip);
          }
          st.pipe(res);
          st.on('error', function(e) {
            return console.log(e);
          });
          decrypt.on('error', function(e) {
            return console.log(e);
          });
          gunzip.on('error', function(e) {
            return console.log(e);
          });
          return st.on('end', function() {
            return syncCallback('download', {
              user: ndx.user,
              obj: document
            });
          });
        } catch (error) {
          e = error;
          console.log(e);
          return next(e);
        }
      })(ndx.user);
    });
    return ndx.fileUpload = {
      on: function(name, callback) {
        return callbacks[name].push(callback);
      },
      off: function(name, callback) {
        return callbacks[name].splice(callbacks[name].indexOf(callback), 1);
      },
      download: function(res, data, filename) {
        var mimetype;
        mimetype = mime.lookup(filename);
        res.setHeader('Content-disposition', 'attachment; filename=' + filename);
        res.setHeader('Content-type', mimetype);
        res.end(data);
        return syncCallback('download', {
          user: ndx.user,
          obj: {
            filename: filename,
            mimetype: mimetype
          }
        });
      },
      downloadStream: function(res, stream, filename) {
        var mimetype;
        mimetype = mime.lookup(filename);
        res.setHeader('Content-disposition', 'attachment; filename=' + filename);
        res.setHeader('Content-type', mimetype);
        stream.pipe(res);
        return syncCallback('download', {
          user: ndx.user,
          obj: {
            filename: filename,
            mimetype: mimetype
          }
        });
      }
    };
  };

}).call(this);

//# sourceMappingURL=index.js.map
