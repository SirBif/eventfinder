var express = require('express');
var Facebook = require('facebook-node-sdk');

var app = express.createServer(express.logger());

app.configure(function () {
  app.use(express.bodyParser());
  app.use(express.cookieParser());
  app.use(express.session({ secret: 'sdjdkssdm8sdf89fmdf8sdfmsd' }));
  app.use(Facebook.middleware({ appId: process.env.FACEBOOK_APP_ID, secret: process.env.FACEBOOK_SECRET }));
});

var port = process.env.PORT || 3000;

app.listen(port, function() {
  console.log("Listening on " + port);
});

app.engine('.html', require('jade'));

app.get('/', function (req, res) {
	res.render('index.html', {
        layout:    false,
        req:       req,
        app:       app,
	});
});

/*
{
"theevent":"select eid, attending_count, unsure_count, location, venue.id, start_time, privacy, end_time from event where eid='373581432761001'",
"thevenue":"select location.latitude, location.longitude from page where page_id in (select venue.id from #theevent )",
"attendinggirls":"select uid, sex from user where sex = 'female' and uid in (select uid from event_member where eid in (select eid from #theevent) and rsvp_status = 'attending')"
}
*/