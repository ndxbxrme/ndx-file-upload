(function() {
  'use strict';
  var AWS, async, atob, base64, crypto, fs, mime, mkdirp, multiparty, path, zlib;

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

  base64 = require('base64-stream');

  module.exports = function(ndx) {
    var S3, algorithm, awsPrefix, callbacks, doencrypt, dozip, fetchBase64, getReadStream, s3Stream, syncCallback, useAWS;
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
            var done, encrypt, filename, gzip, outpath, rs, st, ws;
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
              ws = fs.createWriteStream(outpath);
              st.pipe(ws);
              ws.on('error', function(err) {
                console.log('write error', err);
                return callback(err, null);
              });
              done = function() {
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
              };
              return ws.on('finish', function() {
                done();
                if (useAWS) {
                  ws = s3Stream.upload({
                    Bucket: AWS.config.bucket,
                    Key: awsPrefix + outpath.replace(/\\/g, '/')
                  });
                  rs = fs.createReadStream(outpath);
                  return rs.pipe(ws);
                }
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
    getReadStream = function(path) {
      return new Promise(function(resolve, reject) {
        var decrypt, gunzip, sendFileToRes;
        decrypt = crypto.createDecipher(algorithm, ndx.settings.ENCRYPTION_KEY || ndx.settings.SESSION_SECRET || '5random7493nonsens!e');
        gunzip = zlib.createGunzip();
        sendFileToRes = function() {
          var st;
          st = fs.createReadStream(path);
          if (doencrypt) {
            st = st.pipe(decrypt);
          }
          if (dozip) {
            st = st.pipe(gunzip);
          }
          resolve(st);
          st.on('error', function(e) {
            return reject(e);
          });
          decrypt.on('error', function(e) {
            return reject(e);
          });
          return gunzip.on('error', function(e) {
            return reject(e);
          });
        };
        return fs.exists(path, function(fileExists) {
          var st, ws;
          if (fileExists) {
            return sendFileToRes();
          } else {
            if (useAWS) {
              st = S3.getObject({
                Bucket: AWS.config.bucket,
                Key: path
              }).createReadStream();
              ws = fs.createWriteStream(path);
              st.pipe(ws);
              return ws.on('finish', function() {
                return sendFileToRes();
              });
            } else {
              return reject();
            }
          }
        });
      });
    };
    fetchBase64 = function(path) {
      return new Promise(function(resolve, reject) {
        return getReadStream(path).then(function(st) {
          var b64, output;
          b64 = st.pipe(base64.encode());
          output = '';
          b64.on('data', function(data) {
            return output += data.toString('utf-8');
          });
          b64.on('error', function(err) {
            return reject(err);
          });
          return b64.on('end', function() {
            return resolve(output);
          });
        });
      });
    };
    ndx.app.get('/api/download/:data', function(req, res, next) {
      return (function(user) {
        var document, mimetype;
        document = JSON.parse(atob(req.params.data));
        mimetype = mime.lookup(document.path);
        res.setHeader('Content-disposition', 'attachment; filename=' + document.filename);
        res.setHeader('Content-type', mimetype);
        return getReadStream(document.path).then(function(st) {
          st.pipe(res);
          return syncCallback('download', {
            user: user,
            obj: document
          });
        }, function(err) {
          return res.end();
        });
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
      },
      fetchBase64: fetchBase64
    };
  };

}).call(this);

//# sourceMappingURL=index.js.map
