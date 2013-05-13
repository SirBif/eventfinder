var express = require('express');
var util    = require('util');
var https = require('https');
var pg = require('pg'); //native libpq bindings = `var pg = require('pg').native`
var conString = process.env.DATABASE_URL;
var client = new pg.Client(conString);

var app = express.createServer();

app.configure(function () {
	app.use(express.bodyParser());
	app.use(express.cookieParser());
	app.use(express.session({ secret: 'sdjdkssdm8sdf89fmdf8sdfmsd' }));
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
			res.end(d.length);
			saveEventsOnDb(d);
		});
	});
	myReq.end();

	myReq.on('error', function(e) {
	  res.end(e);
	});
}
app.get('/doAnUpdate', function (req, res) {
	console.log(req);
	var token = req.query["token"];
	var query = "SELECT eid, start_time FROM event WHERE privacy='OPEN' AND start_time > now() AND eid IN (SELECT eid FROM event_member WHERE start_time > now() AND (uid IN(SELECT uid2 FROM friend WHERE uid1=me()) OR uid=me())ORDER BY start_time ASC LIMIT 50) ORDER BY start_time ASC";
	executeFbQuery(query, token, res);
});

function saveEventsOnDb(data) {
    client.connect();

    //queries are queued and executed one after another once the connection becomes available
    client.query("CREATE TABLE events(id integer, start_time timestamptz, stuff varchar(10))");
    var length = data.length;
    element = null;
    for (var i = 0; i < length; i++) {
      element = arr[i];
      client.query("INSERT INTO events(id, start_time) values($1, $2)", [element.eid, element.start_time]);
    }
    done();
    
    query.on('error', function(error) { 
      res.end(error);
    });
};
/*
{
"theevent":"select eid, attending_count, unsure_count, location, venue.id, start_time, privacy, end_time from event where eid='373581432761001'",
"thevenue":"select location.latitude, location.longitude from page where page_id in (select venue.id from #theevent )",
"attendinggirls":"select uid, sex from user where sex = 'female' and uid in (select uid from event_member where eid in (select eid from #theevent) and rsvp_status = 'attending')"
}
*/
