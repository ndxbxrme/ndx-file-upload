# ndx-file-upload  
file upload/download functionality for ndx-framework apps  
all files are encrypted and zipped by default  
```bash
npm install --save ndx-file-upload
```  
### example
```bash
bower install --save ng-file-upload
```
`src/client/app.coffee`
```coffeescript
angular.module 'filedownload', [
  'ndx'
  'ui.router'
  'ngFileUpload'
]
```
`src/client/routes/dashboard/dashboard.ctrl.coffee`
```coffeescript
angular.module 'filedownload'
.controller 'DashboardCtrl', ($scope, Upload) ->
  $scope.documents = []
  $scope.uploadFiles = (files, errFiles) ->
    if files
      Upload.upload
        url: '/api/upload'
        data:
          file: files
      .then (response) ->
        if response.data
          for document in response.data
            $scope.documents.push document
      , (err) ->
        console.log err
      , (progress) ->
        $scope.uploadProgress = Math.min 100, parseInt(100.0 * progress.loaded / progress.total)
  $scope.makeDownloadUrl = (document) ->
    '/api/download/' + btoa JSON.stringify({path:document.path,filename:document.originalFilename})
```
`src/client/routes/dashboard/dashboard.jade`
```jade
.dashboard 
  .drop-box(ngf-drop='uploadFiles($files)', ngf-drag-over-class="'dragover'", ngf-multiple='true')
    h3 Drop files here to upload
    button.file-upload(type='file', ngf-select='uploadFiles($file, $invalidFiles)') Or click here to choose
  .document(ng-repeat='document in documents')
    a(href='{{makeDownloadUrl(document)}}', target='_self') {{document.filename}}
```

## methods and callbacks
#### `ndx.fileUpload.on(name, callback)`  
register a callback  
* upload
* download  

#### `ndx.fileUpload.off(name, callback)`  
deregister a callback  
#### `ndx.fileUpload.download(res, data, filename)` 
download arbitrary data to the user, eg
`src/server/app.coffee`
```coffeescript
require 'ndx-server'
.config
  database: 'db'
  tables: ['users']
  localStorage: './data'
.use (ndx) ->
  ndx.app.get '/api/download-csv', (req, res) ->
    ndx.fileUpload.download res, '1,2,3\n4,5,6\n7,8,9', 'mythings.csv'
.start()
```
`src/client/routes/dashboard/dashboard.jade`
```jade
a(href='/api/download-csv', target='_self') Download CSV
```
#### `ndx.fileUpload.downloadStream(stream, data, filename)` 