var express = require('express');
var util    = require('util');
var https = require('https');
var Parse = require('parse').Parse;
var moment = require('moment');
var async = require('async');
var pg = require('pg');
https.globalAgent.maxSockets = 80;
/*
//var fs = require('fs');
var serverOptions = {
  key: fs.readFileSync('key.pem'),
  cert: fs.readFileSync('cert.pem')
};
var app = express.createServer(serverOptions);
*/
var app = express.createServer();
Parse.initialize(process.env.parseAppId, process.env.parseJsKey);

var fetchListOfEventsEveryXHours = 6;
var numberOfEventsToRetrieve = 50;
var parallelAsyncHttpRequests = 5;
var maxEventsToUpdate = 200;
var updateEventEveryXHours = 4;
var eventLimitForFbQuery = 100;
var askParseANewTokenAfterXMinutes = 30;

app.configure(function () {
    app.use(express.favicon(__dirname + '/misc/favicon.ico')); 
    app.use(express.compress());
	app.use(express.bodyParser());
	app.use(express.cookieParser());
	app.set('title', 'Event Finder');
	app.use("/js", express.static(__dirname + '/js'));
	app.use("/css", express.static(__dirname + '/css'));
	app.use("/misc", express.static(__dirname + '/misc'));
	app.register('.html', require('ejs'));
    app.set('views',__dirname+'/views');
});

var port = process.env.PORT || 5000;
app.listen(port, function() {
    console.log("Listening on " + port);
});

app.all('/', function (req, res, next) {
	res.render('index.html', {layout: false});
});
/*
app.all('/login.html', function (req, res, next) {
	res.render('login.html', {layout: false});
});*/

var token;
var last_check;

app.get('/login', function (req, res, next) {
    var uid = req.query["uid"];
    var accessToken = req.query["token"];
    res.writeHead(200, {'Content-Type': 'text/html'});
    res.end();
    if(accessToken != token) {
        console.log('NEW TOKEN!!');
        token = accessToken;
        last_check = moment();
    }
    console.log('Login from uid ' + uid);
    fetchUserInfo(uid, function(userInfo) {updateIfNeeded(userInfo, uid, accessToken);});
});

function fetchUserInfo(uid, cb) {
    var FacebookUser = Parse.Object.extend("FacebookUser");
	var query = new Parse.Query(FacebookUser);
	query.equalTo("uid", uid);
	query.first().then(function(userInfo) {cb(userInfo);});
}

function updateIfNeeded(user, uid, accessToken) {
	var beforeThisItsTooOld = moment().subtract('hours', fetchListOfEventsEveryXHours);
	var userInfo = user;
	if(userInfo == undefined) {
		var FacebookUser = Parse.Object.extend("FacebookUser");
		userInfo = new FacebookUser();
		userInfo.set("uid", uid);
	}
	var last_update = userInfo.get("last_update");
	if((last_update == undefined) || (last_update < beforeThisItsTooOld)) {
		console.log('Updating user ' + uid);
		doAnUpdate(accessToken, function() {
		    userInfo.set("last_update", new Date());
	        userInfo.set("token", accessToken);
	        userInfo.save();
	     });
	} else {
	    console.log('No need to update events from uid ' + uid);
        userInfo.set("token", accessToken);
	    userInfo.save();
	}
}

function doAnUpdate(token, cb) {
	var query = "SELECT eid, start_time FROM event WHERE privacy='OPEN' AND venue.id <> '' AND start_time > now() AND eid IN (SELECT eid FROM event_member WHERE start_time > now() AND (uid IN(SELECT uid2 FROM friend WHERE uid1=me()) OR uid=me())ORDER BY start_time ASC LIMIT "+ eventLimitForFbQuery +") ORDER BY start_time ASC";
	executeFbQuery(query, token, function(results) {insertEventsIntoDb(results.data, cb);});
}

function executeFbQuery(query, token, cb) {
	var options = {
		hostname: 'graph.facebook.com',
		port: 443,
		path: "/fql?q=" + escape(query) + "&access_token=" + escape(token),
		method: 'GET',
		agent: false
	};
	
    var req = https.request(options, function (result) {
        var data = [];
        result.on('data', function (d) {
	        data.push(d);
        });
        result.on('error', function (err) {
            console.log('Error: ' + err);
        });
        result.on('end', function() {
            var theData = JSON.parse(data.join(''));
            if(theData.error == undefined) {
                console.log('Data Retrieved');
                cb(theData);
	        } else {
	            console.log('FB query ended with error: '+ JSON.stringify(theData));   
	        }
        });
    });
    req.end();
}

function insertEventsIntoDb(data, cb) {
    getAToken(function(theToken) {
        asyncInsert(data, theToken, cb);
    });
}

function getAToken(cb) {
    var threshold = moment().subtract('minutes', askParseANewTokenAfterXMinutes);
    if(last_check == undefined || threshold > last_check) {
        console.log('Retrieving new token from Parse');
        var FacebookUser = Parse.Object.extend("FacebookUser");
	    var query = new Parse.Query(FacebookUser);
	    query.descending("updatedAt")
	    query.first().then(function(user) {
	        token = user.get("token");
	        last_check = moment();
	        cb(token);
	    });
    } else {
        cb(token);
    }
}

function asyncInsert(eventIds, token, cb) {
    var querySql = "INSERT INTO events(eid, start_date) values($1, $2);";
    async.eachLimit(eventIds, parallelAsyncHttpRequests, function(eventRow, cb) {
        pg.connect(process.env.DATABASE_URL, function(error, client, done) {
            if(error) {
                return;
            }
            if(eventRow.eid != undefined) {
                doQuery(client, querySql, eventRow.eid, eventRow.start_time, done, cb);
            } else {
                done();
                cb();
            }
        });
    }, function(err) {
        if (err) {
            console.log('Insert problem:' +err);
        }
        cb();
    });
}

function doQuery(client, querySql, eid, start_time, done, cb) {
    var query = client.query(querySql, [eid, start_time]);
    query.on('error', function(error) {
        if(error.code == 23505) { //if it's already present
            error = 'Already present: ' + eid;
        }
        done();
        cb();
        console.log(error);
    });
    query.on('end', function(result) {
        done();
        if(result != undefined) {
            console.log('Adding event ' + eid);
            getAToken(function(token) {
                retrieveEventInfo(eid, token, function(fbData) {
                    writeSingleUpdateToDb(fbData, eid, cb);
                });
            });
        }
    });
}

function retrieveEventInfo(eid, tok, cb) {
    console.log('Retrieving info about event ' + eid);
    var query = "{"+
                    "\"theevent\":\"select eid, name, attending_count, unsure_count, location, venue.id, start_time, end_time from event where eid='"+eid+"'\"," +
                    "\"thevenue\":\"select location.latitude, location.longitude from page where page_id in (select venue.id from #theevent )\"" + 
                "}";    
	executeFbQuery(query, tok, cb);
}

function writeSingleUpdateToDb(fbData, eid, cb) {
    console.log('Retrieved fields for event ' + eid);
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
         updateEventInfo(eventData, cb);
     } catch(err) {
        cb(err);
     }
}

function updateEventInfo(eventData, cb) {
    var query = "UPDATE events SET end_date=$1, attending_total=$2, maybe_total=$3, latitude=$4, longitude=$5, location=$6, name=left($7, 100), last_update = now() WHERE eid = $8;";
    updateIntoDb(query, eventData, cb);
}

function updateIntoDb(querySql, data, cb) {
    pg.connect(process.env.DATABASE_URL, function(error, client, done) {
        if(error) {
            console.log(error);
            cb();
            return;
        }
        var query = client.query(querySql, data);
        query.on('error', function(error) {  
            done();
            cb();    
            console.log(error);
        });
        query.on('end', function(result) {
            done();
            cb();
            console.log('Saved');
        });
    });
}

app.get('/retrieve', function (req, res, next) {
    console.log('Retrieve');
    var bottomRightLat = req.query["bottomRightLat"];
    var bottomRightLon = req.query["bottomRightLon"];
    var topLeftLat = req.query["topLeftLat"];
    var topLeftLon = req.query["topLeftLon"];
    var start_time = req.query["start"];
    var end_time = req.query["end"];
    retrieveEventsInBox({'latitude':bottomRightLat, 'longitude':bottomRightLon} , {'latitude':topLeftLat,'longitude':topLeftLon}, start_time, end_time, function(rows) {
        res.json(rows);
    });
});

function retrieveEventsInBox(bottomRight, topLeft, start, end, cb) {
    var query = "";
    
    query += "SELECT name, start_date AS start_time, end_date AS end_time, attending_total AS people, location, latitude, longitude, eid ";
    query += "FROM events WHERE";
    query += " ( (start_date >= $5 AND start_date < $6)";
    query += " OR (start_date < $5 AND end_date > $5) )";
    query += " AND last_update IS NOT NULL";
    //query += " AND earth_box(ll_to_earth("+lat+", "+lon+"), 60000) @> ll_to_earth(events.latitude, events.longitude)";
    //query += " AND latitude > " + bottomRight.latitude + " AND latitude < " + topLeft.latitude;
    query += " AND latitude > $1 AND latitude < $2";
    //query += " AND longitude < " + bottomRight.longitude + " AND longitude > " + topLeft.longitude;
    query += " AND longitude < $3 AND longitude > $4";
    query += " ORDER BY people DESC LIMIT $7"// + numberOfEventsToRetrieve;*/
    executePS('retrieveEventsPs', query, [bottomRight.latitude, topLeft.latitude, bottomRight.longitude, topLeft.longitude, moment(start), moment(end), numberOfEventsToRetrieve], cb);
}

function executePS(name, queryString, params, cb) {
    var results = [];
    pg.connect(process.env.DATABASE_URL, function(error, client, done) {
        if(error) {
            console.log(error);
            return;
        }
        var query = client.query({ name: name, text: queryString, values: params });
        query.on('error', function(error) {
            console.log(error);
        });
        query.on('row', function(row) {
            results.push(row);
        });
        query.on('end', function(result) {
            done();
            cb(results); 
        });
    });
}

function executeQuery(queryString, cb) {
    var results = [];
    pg.connect(process.env.DATABASE_URL, function(error, client, done) {
        if(error) {
            console.log(error);
            return;
        }
        var query = client.query(queryString);
        query.on('error', function(error) {
            console.log(error);
        });
        query.on('row', function(row) {
            results.push(row);
        });
        query.on('end', function(result) {
            done();
            cb(results); 
        });
    });
};

app.get('/update', function (req, res) {
    res.writeHead(200, {'Content-Type': 'text/html'});
    res.end();
    doTheBigUpdate();
});

function doTheBigUpdate() {
    executeQuery("delete from events where (start_date < now() - interval '24 hours' AND end_date IS NULL) OR (end_date < now())", function(nvm) {
        retrieveEventsToUpdate(function(eventRows) {
            if(eventRows.length > 0) {
                console.log('Number of events to update: ' + eventRows.length);
                getAToken(function(token) {asyncRetrieve(eventRows, token);});
            } else {
                console.log("No need to update the events data");
            }
        });
    });
}

function retrieveEventsToUpdate(cb) {
    var limit = maxEventsToUpdate;
    console.log('Retrieving events to update');
    var query= "SELECT eid FROM events where ((last_update < (now() - INTERVAL '"+ updateEventEveryXHours +" hours')) or last_update IS NULL) and start_date >= now() ORDER BY last_update ASC LIMIT " + limit;
    executeQuery(query, cb);
};

function asyncRetrieve(eventRows, token) {
    async.eachLimit(eventRows, parallelAsyncHttpRequests, function(eventRow, cb) {
        retrieveEventInfo(eventRow.eid, token, function(fbData) {
            writeSingleUpdateToDb(fbData, eventRow.eid, cb);
        });
    }, function(err) {
        if (err) {
            console.log('Retrieve problem:' +err);
        } else {
          doTheBigUpdate(); 
        }
    });
}

function retrieveEventGirls(eid, tok, cb) {
    console.log('Contacting FB to retrieve info about event ' + eid);
    query = "select '' from user where sex = 'female' and uid in (select uid from event_member where eid ='"+eid+"' and rsvp_status = 'attending')";
	executeFbQuery_HeadOnly(query, tok, cb);
}

function executeFbQuery_HeadOnly(query, token, cb) {
	var options = {
		host: 'graph.facebook.com',
		port: 443,
		path: "/fql?q=" + escape(query) + "&access_token=" + escape(token),
		method: 'GET',
		headers: {
		    'Accept-Encoding': 'identity',
		    'agent': false
		}
	};
    var myReq = https.request(options, function (response) {
        var header = response.headers;
        response.destroy();        
        var elements = getNumberOfElements(header['content-length']);
        console.log(elements);
        cb(elements);
    });
    myReq.end();
}

function getNumberOfElements(size) {
   return (size - 10) / 12;
}

app.get('/babam', function (req, res) {
    res.writeHead(200, {'Content-Type': 'text/html'});
    res.end();
    babamUpdate();
});

app.get('/updateToken', function (req, res) {
    res.writeHead(200, {'Content-Type': 'text/html'});
    res.end();
    var newToken = req.query["token"];
    if(newToken != token) {
        console.log('NEW TOKEN!!');
        token = newToken;
        last_check = moment();
    }
});

function babamInsert(event, cb) {
    var querySql = "INSERT INTO events(eid, start_date) values($1, $2);";
    pg.connect(process.env.DATABASE_URL, function(error, client, done) {
        if(error) {
            return;
        }
        if(event.id != undefined) {
            doQuery(client, querySql, event.id, event.start_time, done, cb);
        } else {
            done();
            cb();
        }
    });
}

function getEvents(place, getEventsCb) {
    var theToken = token;
    var path = "/"+place.id+"/events?fields=id,start_time&access_token="+theToken;
    var options = {
		hostname: 'graph.facebook.com',
		port: 443,
		agent: false,
		path: path
	};
	console.log("Places: "+ placesQueue.length());
    var myreq = https.request(options, function (result) {
        var data = "";
        result.on('data', function (d) {
	        data+=d;
        });
        result.on('error', function (err) {
            console.log('Error: ' + err);
            placesQueue.push(path);  
            getEventsCb();
            return;
        });
        result.on('end', function() {
            var json = JSON.parse(data);
            if(json.data) {
                async.forEach(json.data, function(entry, cb) {
                    babamInsert(entry, cb);
                    console.log(entry.id + " " + place.name);
                }, function(err) {
                    getEventsCb();
                });
            } else {
                getEventsCb();
            }
        });
    })
    myreq.on('error', function(e) {
        console.log(e);
        getEventsCb();
    });
    myreq.end();
}

function checkPlace(place) {
    executePS("checkPlace", "select last_update from places where id = $1;", [place.id], function(results) {
        if(results.length > 0) {
            // TODO check if it has been updated recently enough
        } else {
           placesQueue.push(place);  
           executePS("addPlace", "INSERT INTO places(id, name, last_update) values($1, $2, $3);", [place.id, place.name, moment()], function() {});
        }
    });
}

function getNext(path, completeCb) {
    var options = {
		hostname: 'graph.facebook.com',
		port: 443,
		agent: false,
		path: path
	};
	console.log("Locations: "+ locationsQueue.length());
    var myreq = https.request(options, function (result) {
        var data = "";
        result.on('data', function (d) {
            data+=d;
        });
        result.on('error', function (err) {
            console.log('Error: ' + err);
            locationsQueue.push(path);
            completeCb();
            return;
        });
        result.on('end', function() {
            var json = JSON.parse(data);
            var last = false;
            if(json.error == undefined) {
                if(json.paging && json.paging.next) {
                    var array = json.paging.next.split("/");
	                locationsQueue.push("/"+array[3]);
                }
                if(json.data) {
                    var theArray = json.data;
                    var l = theArray.length;
                    var place;
                    for(var i=0;i<l;i++){
                        place = theArray[i];
                        if(place.id != undefined) {
                            checkPlace(place);
                        }  
                    }
                }
                completeCb();
	        } else {
	            console.log('Request ended with error: '+ JSON.stringify(json));
	            completeCb();   
	        }
        });
    });
    myreq.on('error', function(e) {
        console.log(e);
        completeCb();
    });
    myreq.end();
}

var placesQueue = async.queue(function(venue, callback) {
    getEvents(venue, callback);
}, 30);
placesQueue.drain = function() {
    console.log('places drain');
};

var locationsQueue = async.queue(function(thePath, callback) {
    getNext(thePath, callback);
}, 5);
locationsQueue.drain = function() {
    //var newConcurrency = 30;
    //console.log('Location drain. Setting placeQueue concurrency to ' + newConcurrency);
    //placesQueue.concurrency = newConcurrency;
};

function babamUpdate() {
    var locations = [
        ["Bologna", 44.496995,11.341957],
        ["Ferrara", 44.843699,11.619072],
        ["Milano", 45.468799,9.16867],
        ["Roma", 41.899211,12.509093],
        ["Padova", 45.407128,11.887153],
        ["Venezia", 45.44002,12.317707],
        ["Rimini", 44.061193,12.555946]
    ];
    async.eachLimit(locations, 5, function(myLocation, cb) {
        var theToken = token;
        console.log(myLocation[0]);
        var thePath = "/search?type=place&center="+myLocation[1]+","+myLocation[2]+"&distance=50000&fields=id,location,name&access_token=" + theToken;
        locationsQueue.push(thePath);
        cb();
    }, function(err) {
        
    });
}
