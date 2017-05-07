(function() {
  'use strict';
  var algorithm, atob, crypto, fs, mime, mkdirp, multiparty, path, zlib;

  fs = require('fs');

  path = require('path');

  mkdirp = require('mkdirp');

  multiparty = require('connect-multiparty');

  atob = require('atob');

  mime = require('mime');

  crypto = require('crypto');

  zlib = require('zlib');

  algorithm = 'aes-256-ctr';

  module.exports = function(ndx) {
    var callbacks, doencrypt, dozip, syncCallback;
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
      var folder, output;
      output = [];
      folder = './uploads';
      if (req.body.folder) {
        folder = path.join(folder, req.body.folder);
      }
      return mkdirp(folder, function(err) {
        var file, i, len, ref, saveFile;
        saveFile = function(file) {
          var encrypt, filename, gzip, outobj, outpath, rs, st, ws;
          filename = ndx.generateID(12) + path.extname(file.originalFilename);
          outpath = path.join(folder, filename);
          encrypt = crypto.createCipher(algorithm, ndx.settings.ENCRYPTION_KEY || ndx.settings.SESSION_SECRET || '5random7493nonsens!e');
          gzip = zlib.createGzip();
          rs = fs.createReadStream(file.path);
          ws = fs.createWriteStream(outpath);
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
          st.pipe(ws);
          rs.on('end', function() {
            return fs.unlinkSync(file.path);
          });
          outobj = {
            filename: filename,
            path: outpath.replace(/\\/g, '/'),
            originalFilename: file.originalFilename,
            type: file.type,
            basetype: file.type.replace(/\/.*/, ''),
            size: file.size,
            date: new Date().valueOf(),
            ext: path.extname(file.originalFilename).replace(/^\./, '')
          };
          ndx.extend(outobj, req.body);
          syncCallback('upload', {
            user: ndx.user,
            obj: outobj
          });
          return outobj;
        };
        if (Object.prototype.toString.call(req.files.file) === '[object Array]') {
          ref = req.files.file;
          for (i = 0, len = ref.length; i < len; i++) {
            file = ref[i];
            output.push(saveFile(file));
          }
        } else if (req.files.file) {
          output.push(saveFile(req.files.file));
        } else {
          console.log('no file');
        }
        return res.json(output);
      });
    });
    ndx.app.get('/api/download/:data', ndx.authenticate(), function(req, res, next) {
      var decrypt, document, e, error, filestream, gunzip, mimetype, st;
      try {
        document = JSON.parse(atob(req.params.data));
        mimetype = mime.lookup(document.path);
        res.setHeader('Content-disposition', 'attachment; filename=' + document.filename);
        res.setHeader('Content-type', mimetype);
        filestream = fs.createReadStream(document.path);
        decrypt = crypto.createDecipher(algorithm, ndx.settings.ENCRYPTION_KEY || ndx.settings.SESSION_SECRET || '5random7493nonsens!e');
        gunzip = zlib.createGunzip();
        st = filestream;
        if (doencrypt) {
          st = st.pipe(decrypt);
        }
        if (dozip) {
          st = st.pipe(gunzip);
        }
        st.pipe(res);
        return syncCallback('download', {
          user: ndx.user,
          obj: document
        });
      } catch (error) {
        e = error;
        console.log(e);
        return next(e);
      }
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
