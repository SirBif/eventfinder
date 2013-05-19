var express = require('express');
var util    = require('util');
var https = require('https');
var Parse = require('parse').Parse;
var moment = require('moment');
var pg = require('pg'); //native libpq bindings = `var pg = require('pg').native`
var app = express.createServer();
Parse.initialize(process.env.parseAppId, process.env.parseJsKey);

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
		result.on('data', function(d) {
		    try{
		        var theData = JSON.parse(d);
		        if(theData.error == undefined) {
		            console.log('Data Retrieved');
			        res.end('Data Retrieved');
			        saveEventsOnDb(theData);
			    } else {
			        console.log(theData);
			        res.end('Data Error');
			    }
			} catch(err) {
			   console.log('Data Error');
			   res.end('Data Error'); 
			}
		});
	});
	myReq.end();

	myReq.on('error', function(e) {
	  res.end('myreq Error');
	});
}

app.get('/login', function (req, res) {
    var uid = req.query["uid"];
    var accessToken = req.query["token"];
    console.log('Login from uid ' + uid);
    fetchUserInfo(uid).then(function(userInfo) {updateIfNeeded(userInfo, uid, accessToken, res);});
});

function fetchUserInfo(uid) {
    var FacebookUser = Parse.Object.extend("FacebookUser");
	var query = new Parse.Query(FacebookUser);
	query.equalTo("uid", uid);
	return query.first();
}

function updateIfNeeded(user, uid, accessToken, res) {
	var beforeThisItsTooOld = moment().add('days', -1);
	var userInfo = user;
	if(userInfo == undefined) {
		var FacebookUser = Parse.Object.extend("FacebookUser");
		userInfo = new FacebookUser();
		userInfo.set("uid", uid);
	}
	var last_update = userInfo.get("last_update");
	if((last_update == undefined) || (last_update < beforeThisItsTooOld)) {
		console.log('Updating user ' + uid);
		doAnUpdate(accessToken, res);
		userInfo.set("last_update", new Date());
		userInfo.set("token", accessToken);
		userInfo.save();
	} else {
	    console.log('No need to update events from uid ' + uid);
	}
}

function doAnUpdate(token, res) {
	var query = "SELECT eid, start_time FROM event WHERE privacy='OPEN' AND start_time > now() AND eid IN (SELECT eid FROM event_member WHERE start_time > now() AND (uid IN(SELECT uid2 FROM friend WHERE uid1=me()) OR uid=me())ORDER BY start_time ASC LIMIT 50) ORDER BY start_time ASC";
	executeFbQuery(query, token, res);
}

function saveEventsOnDb(input) {
    pg.connect(process.env.DATABASE_URL, function(error, client, done) {
        if(error) {
            console.log(error);
            return;
        }
        data = input.data;
        var length = data.length;
        element = null;
        for (var i = 0; i < length; i++) {
          element = data[i];
          var query = client.query("INSERT INTO events(eid, start_date) values($1, $2)", [element.eid, element.start_time]);
          query.on('error', function(error) {
            if(error.code == 23505) {
               console.log('Event already present'); 
            } else {            
                console.log(error);
            }
          });
        }; 
        done();   
    });
};
/*
{
"theevent":"select eid, attending_count, unsure_count, location, venue.id, start_time, privacy, end_time from event where eid='373581432761001'",
"thevenue":"select location.latitude, location.longitude from page where page_id in (select venue.id from #theevent )",
"attendinggirls":"select uid, sex from user where sex = 'female' and uid in (select uid from event_member where eid in (select eid from #theevent) and rsvp_status = 'attending')"
}
*/
