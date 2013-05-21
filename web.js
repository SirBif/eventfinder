var express = require('express');
var util    = require('util');
var https = require('https');
https.globalAgent.maxSockets = 20;
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
    httpRequest(options).then(function(result) {
        var data = [];
        result.on('data', function (d) {
	        data.push(d);
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

function getNumberOfElements(size) {
   return (size - 10) / 12;
}

function executeFbQuery_HeadOnly(query, token) {
	var options = {
		host: 'graph.facebook.com',
		port: 443,
		path: "/fql?q=" + escape(query) + "&access_token=" + escape(token),
		method: 'GET',
		headers: {
		    'Accept-Encoding': 'identity'
		}
	};
    var deferred = Q.defer();
    httpHead(options).then(function(header) {
        var elements = getNumberOfElements(header['content-length']);
        console.log(elements);
        deferred.resolve(elements);
    });
    return deferred.promise;
}

function httpHead(options) {
    var deferred = Q.defer();
    var myReq = https.request(options, function (response) {
        var header = response.headers;
        response.destroy();
        deferred.resolve(header);
    });
	myReq.on('error', function(e) {
	  deferred.reject(e);
	});
	myReq.end();
    return deferred.promise;
}

function httpRequest(options) {
    var deferred = Q.defer();
    var myReq = https.request(options, function (response) {
        deferred.resolve(response);
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
	var beforeThisItsTooOld = moment().add('minutes', -30);
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
	var query = "SELECT eid, start_time FROM event WHERE privacy='OPEN' AND venue.id <> '' AND start_time > now() AND eid IN (SELECT eid FROM event_member WHERE start_time > now() AND (uid IN(SELECT uid2 FROM friend WHERE uid1=me()) OR uid=me())ORDER BY start_time ASC LIMIT 50) ORDER BY start_time ASC";
	return executeFbQuery(query, token).then(function(results) {return insertEvents(results);});
}

function insertEvents(input) {
    return insertIntoDb("INSERT INTO events(eid, start_date) values($1, $2);", input.data);
}

function insertIntoDb(querySql, data) {
    var length = data.length;
    var deferred = Q.defer();
    pg.connect(process.env.DATABASE_URL, function(error, client, done) {
        if(error) {
            deferred.reject(error);
        }
        for (var i = 0; i < length; i++) {
            var query = client.query(querySql, [data[i].eid, data[i].start_time]);
            query.on('error', function(error) {
                if(error.code == 23505) { //if it's already present
                    error = 'Already present';
                }
                done();
                console.log(error);   
                deferred.reject(error);
            });
            query.on('end', function(result) {
                done();
            });
        }
        deferred.resolve(); 
    });
    return deferred.promise;
};

function updateIntoDb(querySql, data) {
    var deferred = Q.defer();
    pg.connect(process.env.DATABASE_URL, function(error, client, done) {
        if(error) {
            console.log(error);
            return;
        }
        var query = client.query(querySql, data);
        query.on('error', function(error) {  
            done();    
            console.log(error);
            deferred.reject(error);
        });
        query.on('end', function(result) {
            done();
            console.log('Saved');
            deferred.resolve(result);  
        });
    });
    return deferred.promise;
};

app.get('/retrieve', function (req, res) {
    retrieveEventsToDisplay().then(function(rows) {
        res.setHeader('Content-type', 'text/json');
        res.end(JSON.stringify(rows));
    });
});

function retrieveEventsToDisplay(){
    var limit = 10;
    return extractFromDb("SELECT name, start_date AS start_time, attending_total, maybe_total, location FROM events WHERE start_date > 'yesterday' AND last_update IS NOT NULL ORDER BY start_date ASC LIMIT " + limit);
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
    console.log('Retrieving info about event ' + eid);
    var query = "{"+
                    "\"theevent\":\"select eid, name, attending_count, unsure_count, location, venue.id, start_time, end_time from event where eid='"+eid+"'\"," +
                    "\"thevenue\":\"select location.latitude, location.longitude from page where page_id in (select venue.id from #theevent )\"" + 
                "}";    
	return executeFbQuery(query, tok);
}

function retrieveEventGirls(eid, tok) {
    console.log('Contacting FB to retrieve info about event ' + eid);
    query = "select '' from user where sex = 'female' and uid in (select uid from event_member where eid ='"+eid+"' and rsvp_status = 'attending')";
	return executeFbQuery_HeadOnly(query, tok);
}

app.get('/update', function (req, res) {
    res.end('mah');
    doTheBigUpdate();
});

function updateEventInfo(eventData) {
    var query = "UPDATE events SET end_date=$1, attending_total=$2, maybe_total=$3, latitude=$4, longitude=$5, location=$6, name=left($7, 100), last_update = now() WHERE eid = $8;";
    updateIntoDb(query, eventData);
}

function asyncRetrieve(eventRows, token) {
    var deferred = Q.defer();
    async.eachLimit(eventRows, 3, function(eventRow, cb) {
        retrieveEventInfo(eventRow.eid, token).then(function(fbData) {
            console.log('Retrieved fields for event ' + eventRow.eid);
            try{
                var data = fbData.data;
                var eventData = [
                    data[0].fql_result_set[0].end_time,
                    data[0].fql_result_set[0].attending_count,
                    data[0].fql_result_set[0].unsure_count,                    
                    (data[1].fql_result_set[0]) ? data[1].fql_result_set[0].location.latitude : null,
                    (data[1].fql_result_set[0]) ? data[1].fql_result_set[0].location.longitude : null,
                    data[0].fql_result_set[0].location,
                    data[0].fql_result_set[0].name,
                    data[0].fql_result_set[0].eid                    
                 ];
                 updateEventInfo(eventData);
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
        deferred.resolve();
    });
    return deferred.promise;
}

function getAToken() {
    var FacebookUser = Parse.Object.extend("FacebookUser");
	var query = new Parse.Query(FacebookUser);
	query.descending("updatedAt")
	return query.first();
}

function doTheBigUpdate() {
    extractFromDb("delete from events where start_date < now() - interval '24 hours'");
    retrieveEventsToUpdate().then(function(eventRows) {
        console.log('Number of events to update: ' + eventRows.length);
        getAToken().then(function(user) {asyncRetrieve(eventRows, user.get("token"));});
    });
}

function retrieveEventsToUpdate() {
    var limit = 5;
    console.log('Retrieving events to update');
    var query= "SELECT eid FROM events where ((last_update < (now() - INTERVAL '1 hours')) or last_update IS NULL) and start_date > now() ORDER BY last_update ASC LIMIT " + limit;
    return extractFromDb(query);
};
