var express = require('express');
var Facebook = require('facebook-node-sdk');

var app = express.createServer();

app.configure(function () {
  app.use(express.bodyParser());
  app.use(express.cookieParser());
  app.use(express.session({ secret: 'sdjdkssdm8sdf89fmdf8sdfmsd' }));
  app.use(Facebook.middleware({ appId: '180798855409162', secret: '7d5b6a35d8c08d6aac512b6d85243a2f' }));
});

app.get('/', Facebook.loginRequired(), function (req, res) {
  req.facebook.api('/me', function(err, user) {
    res.writeHead(200, {'Content-Type': 'text/plain'});
    res.end('Hello, ' + user.name + '!');
  });
});