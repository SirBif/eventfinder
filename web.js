var express = require('express');
var util    = require('util');
var https = require('https');
var Parse = require('parse').Parse;
var moment = require('moment');
var async = require('async');
var Q = require('q');
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

function executeFbQuery(query, token) {
	var options = {
		host: 'graph.facebook.com',
		port: 443,
		path: "/fql?q=" + escape(query) + "&access_token=" + escape(token),
		method: 'GET'
	};
    var deferred = Q.defer();
    httsPromise(options).then(function(result) {
        var data = [];
        result.on('data', function (d) {
	        data.push(d)
        });
        result.on('error', function (err) {
            console.log('Error: ' + err);
	        deferred.reject(err);
        });
        result.on('end', function() {
            var theData = JSON.parse(data.join(''));
            if(theData.error == undefined) {
                console.log('Data Retrieved');
                deferred.resolve(theData);
	        } else {
	            console.log('FB query ended with error: '+theData);   
	            deferred.reject(theData);     
	        }
        });
    });
    return deferred.promise;
}

function httsPromise(options) {
    var deferred = Q.defer();
    var myReq = https.request(options, function (result) {
        deferred.resolve(result);
    });
	myReq.on('error', function(e) {
	  deferred.reject(e);
	});
	myReq.end();
    return deferred.promise;
}

app.get('/login', function (req, res) {
    var uid = req.query["uid"];
    var accessToken = req.query["token"];
    res.end('Token received');
    console.log('Login from uid ' + uid);
    fetchUserInfo(uid).then(function(userInfo) {updateIfNeeded(userInfo, uid, accessToken);});
});

function fetchUserInfo(uid) {
    var FacebookUser = Parse.Object.extend("FacebookUser");
	var query = new Parse.Query(FacebookUser);
	query.equalTo("uid", uid);
	return query.first();
}

function updateIfNeeded(user, uid, accessToken) {
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
		doAnUpdate(accessToken).then(function() {
		    userInfo.set("last_update", new Date());
		    userInfo.set("token", accessToken);
		    userInfo.save();
		});
	} else {
	    console.log('No need to update events from uid ' + uid);
	}
}

function doAnUpdate(token) {
	var query = "SELECT eid, start_time FROM event WHERE privacy='OPEN' AND start_time > now() AND eid IN (SELECT eid FROM event_member WHERE start_time > now() AND (uid IN(SELECT uid2 FROM friend WHERE uid1=me()) OR uid=me())ORDER BY start_time ASC LIMIT 50) ORDER BY start_time ASC";
	return executeFbQuery(query, token).then(function(results) {insertEvents(results);});
}

function insertEvents(input) {
    insertIntoDb("INSERT INTO events(eid, start_date) values($1, $2);", input);
}

function insertIntoDb(query, input) {
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
          var query = client.query(query, [element.eid, element.start_time]);
          query.on('error', function(error) {
            if(error.code == 23505) { //if it's already present
               console.log('Already present'); 
            } else {            
                console.log(error);
            }
          });
        }; 
        done();   
    });
};

function updateIntoDb(querySql, data) {
    pg.connect(process.env.DATABASE_URL, function(error, client, done) {
        if(error) {
            console.log(error);
            return;
        }
        var length = data.length;
        element = null;
        for (var i = 0; i < length; i++) {
          element = data[i];
          //console.log(element);
          var query = client.query(querySql, element);
          query.on('error', function(error) {      
            console.log(error);
          });
        };
        client.query('commit');
        done();   
    });
};

app.get('/retrieve', function (req, res) {
    retrieveEventsToDisplay().then(function(rows) {
        res.setHeader('Content-type', 'text/json');
        res.end(JSON.stringify(rows));
    });
});

function retrieveEventsToDisplay(){
    return extractFromDb("SELECT eid, start_date AS start_time FROM events LIMIT 5");
}

function extractFromDb(queryString) {
    var results = [];
    var deferred = Q.defer();
    pg.connect(process.env.DATABASE_URL, function(error, client, done) {
        if(error) {
            console.log(error);
            return;
        }
        var query = client.query(queryString);
        query.on('error', function(error) {
            console.log(error);
            deferred.reject(error);
        });
        query.on('row', function(row) {
            results.push(row);
        });
        query.on('end', function(result) {
            done();
            deferred.resolve(results); 
        });
    });
    return deferred.promise;
};


function retrieveEventInfo(eid, tok) {
    console.log('Contacting FB to retrieve info about event ' + eid);
    var token = 'CAACEdEose0cBAKUoUkeTTSF6LtWZCpGhFXEMFY2f9ZBYN1720iUKtZCrxxEGMt18OZBhQzC5aSHno7CozEWfGspzZAnAtZAuxQkiRLdEsqeXfxTjuItVWv9uB2UCcvbcqmQNa0ZCcm0pqJR9A3z0UiSJs3sYLH64wZANgncqDqLgawZDZD';
    var query = "{"+
                    "\"theevent\":\"select eid, attending_count, unsure_count, location, venue.id, start_time, privacy, end_time from event where eid='"+eid+"'\"," +
                    "\"thevenue\":\"select location.latitude, location.longitude from page where page_id in (select venue.id from #theevent )\"," + 
                    "\"attendinggirls\":\"select uid, sex from user where sex = 'female' and uid in (select uid from event_member where eid in (select eid from #theevent) and rsvp_status = 'attending')\"" +
                "}";
	return executeFbQuery(query, token);
}

app.get('/update', function (req, res) {
    res.end('mah');
    doTheBigUpdate();
});

function updateEventInfo(eventData) {
    console.log('Saving event data');
    var query = "UPDATE events SET end_date=$1, attending_total=$2, attending_f=$3, maybe_total=$4, latitude=$5, longitude=$6, location=$7 WHERE eid = $8;";
    updateIntoDb(query, eventData);
}

function asyncRetrieve(eventRows) {
    var deferred = Q.defer();
    var rowsForTheDb = [];
    async.eachLimit(eventRows, 5, function(eventRow, cb) {
        retrieveEventInfo(eventRow.eid, null).then(function(fbData) {
            console.log('Retrieved fields for event ' + eventRow.eid);
            try{
                var data = fbData.data;
                var eventData = [
                    data[0].fql_result_set[0].end_time,
                    data[0].fql_result_set[0].attending_count,
                    data[1].fql_result_set.length,
                    data[0].fql_result_set[0].unsure_count,                    
                    (data[2].fql_result_set[0]) ? data[2].fql_result_set[0].location.latitude : null,
                    (data[2].fql_result_set[0]) ? data[2].fql_result_set[0].location.longitude : null,
                    data[0].fql_result_set[0].location,
                    data[0].fql_result_set[0].eid                    
                 ];
                 rowsForTheDb.push(eventData);
                 cb();
             } catch(err) {
                cb(err);
             }
        });
    }, function(err) {
        if (err) {
            console.log('Retrieve problem:' +err);
            deferred.reject(err);
        }
        console.log('Processed '+rowsForTheDb.length+ ' events');
        updateEventInfo(rowsForTheDb);//shouldn't be here, but with then the other function never gets called
        deferred.resolve(rowsForTheDb);
    });
    
    return deferred.promise();
}

function doTheBigUpdate() {
    retrieveEventsToUpdate().then(function(eventRows) {
        console.log('Number of events to update: ' + eventRows.length);
        asyncRetrieve(eventRows);
    });
}

function retrieveEventsToUpdate() {
    console.log('Retrieving events to update');
    var query= "SELECT eid FROM events ORDER BY start_date ASC LIMIT 5";
    return extractFromDb(query);
};
