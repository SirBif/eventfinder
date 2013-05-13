var express = require('express');
var Facebook = require('facebook-node-sdk');
var util    = require('util');
var https = require('https');
var pg = require('pg');
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

function executeFbQuery(query, token, res) {
	var options = {
		host: 'graph.facebook.com',
		port: 443,
		path: "/fql?q=" + escape(query) + "&access_token=" + escape(token),
		method: 'GET'
	};

	var myReq = https.request(options, function(result) {
		console.log("statusCode: ", myReq.statusCode);
		console.log("headers: ", myReq.headers);

		result.on('data', function(d) {
			//res.end("token: " + token);
			res.end(d);
		});
	});
	myReq.end();

	myReq.on('error', function(e) {
	  res.end(e);
	});
}

app.get('/doAnUpdate', Facebook.loginRequired({scope : "user_events, friends_events"}), function (req, res) {
	console.log(req);
	var token = req.query["token"]
	var query = "SELECT eid, start_time FROM event WHERE privacy='OPEN' AND start_time > now() AND eid IN (SELECT eid FROM event_member WHERE start_time > now() AND (uid IN(SELECT uid2 FROM friend WHERE uid1=me()) OR uid=me())ORDER BY start_time ASC LIMIT 50) ORDER BY start_time ASC";
	executeFbQuery(query, token, res);
});

app.get('/sql', function (req, res) {
	var pg = require('pg'); //native libpq bindings = `var pg = require('pg').native`
	var conString = process.env.DATABASE_URL;

	var client = new pg.Client(conString);
	client.connect();

	//queries are queued and executed one after another once the connection becomes available
	client.query("CREATE TEMP TABLE beatles(name varchar(10), height integer, birthday timestamptz)");
	client.query("INSERT INTO beatles(name, height, birthday) values($1, $2, $3)", ['John', 68, new Date(1944, 10, 13)]);
	var query = client.query("SELECT * FROM beatles WHERE name = $1", ['John']);

	//can stream row results back 1 at a time
	query.on('row', function(row) {
	  console.log(row);
	  console.log("Beatle name: %s", row.name); //Beatle name: John
	  console.log("Beatle birth year: %d", row.birthday.getYear()); //dates are returned as javascript dates
	  console.log("Beatle height: %d' %d\"", Math.floor(row.height/12), row.height%12); //integers are returned as javascript ints
	  res.end(row.name);
	});

	//fired after last row is emitted
	query.on('end', function() { 
	  client.end();
	});
	
	query.on('error', function(err) { 
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
