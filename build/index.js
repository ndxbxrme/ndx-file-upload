(function() {
  'use strict';
  var fs, mkdirp, multiparty, path;

  fs = require('fs');

  path = require('path');

  mkdirp = require('mkdirp');

  multiparty = require('connect-multiparty');

  module.exports = function(ndx) {
    var callbacks, syncCallback;
    callbacks = {
      upload: []
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
          var filename, outobj, outpath, rs, ws;
          filename = ndx.generateID(12) + path.extname(file.originalFilename);
          outpath = path.join(folder, filename);
          rs = fs.createReadStream(file.path);
          ws = fs.createWriteStream(outpath);
          rs.pipe(ws);
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
          syncCallback('upload', outobj);
          return outobj;
        };
        if (Object.prototype.toString.call(req.files.file) === '[object Array]') {
          ref = req.files.file;
          for (i = 0, len = ref.length; i < len; i++) {
            file = ref[i];
            output.push(saveFile(file));
          }
        } else {
          output.push(saveFile(req.files.file));
        }
        return res.json(output);
      });
    });
    if (ndx.settings.SERVE_UPLOADS || process.env.SERVE_UPLOADS) {
      return ndx.app.use('/uploads', ndx["static"]('./uploads'));
    }
  };

}).call(this);

//# sourceMappingURL=index.js.map
