var express = require('express');
var Facebook = require('facebook-node-sdk');
var util    = require('util');

var app = express.createServer(express.logger());

app.configure(function () {
	app.use(express.bodyParser());
	app.use(express.cookieParser());
	app.use(express.session({ secret: 'sdjdkssdm8sdf89fmdf8sdfmsd' }));
	app.use(Facebook.middleware({ appId: process.env.FACEBOOK_APP_ID, secret: process.env.FACEBOOK_SECRET }));
	app.set('title', 'Event Finder');
	app.set('views', __dirname + '/views');
	app.set('view engine', 'ejs');
});

var port = process.env.PORT || 5000;
app.listen(port, function() {
  console.log("Listening on " + port);
});


app.get('/', function (req, res) {
	res.render('index.ejs', {
        layout:    false,
        req:       req,
        app:       app,
	});
});


app.get('/doAnUpdate', Facebook.loginRequired({scope : "user_events, friends_events"}), function (req, res) {
	var query = "/fql?q=" + escape("SELECT eid, start_time FROM event WHERE privacy='OPEN' AND start_time > now() AND eid IN (SELECT eid FROM event_member WHERE start_time > now() AND (uid IN(SELECT uid2 FROM friend WHERE uid1=me()) OR uid=me())ORDER BY start_time ASC LIMIT 50) ORDER BY start_time ASC ");
	//https://graph.facebook.com/fql?q=select+uid+from+user+where+uid=me()&access_token=
	req.facebook.api('/me', function(err, result) {
		res.writeHead(200, {'Content-Type': 'text/plain'});
		console.log(result.data.length);
		res.end('Results: ' + result.data.length);
	}, function(err, result) {
		res.writeHead(200, {'Content-Type': 'text/plain'});
		console.log(err);
		res.end(err);
	});
});
/*
{
"theevent":"select eid, attending_count, unsure_count, location, venue.id, start_time, privacy, end_time from event where eid='373581432761001'",
"thevenue":"select location.latitude, location.longitude from page where page_id in (select venue.id from #theevent )",
"attendinggirls":"select uid, sex from user where sex = 'female' and uid in (select uid from event_member where eid in (select eid from #theevent) and rsvp_status = 'attending')"
}
*/