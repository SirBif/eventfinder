var express = require('express');
var util    = require('util');
var Parse = require('parse').Parse;
var moment = require('moment');
var async = require('async');
var pg = require('pg');
var QUERY = require("./web-queries");
var fb = require("./fbQuery").getFbQuery();

express.static.mime.define({'text/cache-manifest': ['mf']});

var app = express.createServer();
Parse.initialize(process.env.parseAppId, process.env.parseJsKey);

var parallelAsyncHttpRequests = 7;

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

app.post('/login', function (req, res, next) {
    var uid = req.body.uid;
    var accessToken = req.body.token;
    var fbData = req.body.data;
    fb.setToken(accessToken);
    res.writeHead(200, {'Content-Type': 'text/html'});
    res.end();
    console.log('Login from uid ' + uid);
    fetchUserInfo(uid, function(userInfo) {
        if(userInfo == undefined) {
            var FacebookUser = Parse.Object.extend("FacebookUser");
            userInfo = new FacebookUser();
            userInfo.set("uid", uid);
        }
        userInfo.set("token", accessToken);
        updateIfNeeded(userInfo, fbData);
    });
});

function fetchUserInfo(uid, cb) {
    var FacebookUser = Parse.Object.extend("FacebookUser");
    var query = new Parse.Query(FacebookUser);
    query.equalTo("uid", uid);
    query.first().then(function(userInfo) {cb(userInfo);});
}

function updateIfNeeded(userInfo, data) {
    console.log('Updating user ' + userInfo.get("uid"));
    if(data != undefined && data.length > 0) {
        console.log("Received " + data.length + " events");
        insertEventsIntoDb(data, function() {
            userInfo.set("last_update", new Date());
            userInfo.save();
            console.log("Update complete");
        });
    }
}

function insertEventsIntoDb(data, cb) {
    asyncInsert(data, cb);
}

function asyncInsert(eventIds, cb) {
    async.eachLimit(eventIds, parallelAsyncHttpRequests, function(eventRow, cb) {
        pg.connect(process.env.DATABASE_URL, function(error, client, done) {
            if(error) {
                return;
            }
            if(eventRow.eid != undefined) {
                doQuery(client, QUERY.ADD_EVENT_QUERY(), eventRow.eid, null, done, cb);
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
        done();
        cb();
        if(error.code != 23505) { //ignore the error "it's already present"
            console.log(error);
        }        
    });
    query.on('end', function(result) {
        done();
        if(result != undefined) {
            fb.retrieveEventInfo(eid, function(fbData) {
                fb.retrieveEventGirls(eid, function(number) {
                    writeSingleUpdateToDb(fbData, number, eid, cb);
                });
            });
        }
    });
}

function writeSingleUpdateToDb(fbData, number, eid, cb) {
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
            data[0].fql_result_set[0].eid,
            number,
            data[0].fql_result_set[0].start_time,                    
         ];
         updateEventInfo(eventData, cb);
     } catch(err) {
        cb(err);
     }
}

function updateEventInfo(eventData, cb) {
    updateIntoDb(QUERY.UPDATE_EVENT_INFO(), eventData, cb);
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
        });
    });
}

app.get('/retrieve', function (req, res, next) {
    var bottomRightLat = req.query["bottomRightLat"];
    var bottomRightLon = req.query["bottomRightLon"];
    var topLeftLat = req.query["topLeftLat"];
    var topLeftLon = req.query["topLeftLon"];
    var start_time = req.query["start"];
    var end_time = req.query["end"];
    retrieveEventsInBox(
        {
            'latitude':bottomRightLat,
            'longitude':bottomRightLon
        } , {
            'latitude':topLeftLat,
            'longitude':topLeftLon
        },
        start_time,
        end_time,
        function(rows) {
            res.json(rows);
        }
    );
});

function retrieveEventsInBox(bottomRight, topLeft, start, end, cb) {
    executePS(
        'retrieveEventsPs',
        QUERY.RETRIEVE_EVENTS_QUERY(),
        [
            bottomRight.latitude,
            topLeft.latitude,
            bottomRight.longitude,
            topLeft.longitude,
            moment(start),
            moment(end)
        ],
        cb
    );
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

function retrieveEventsToUpdate(cb) {
    executeQuery(QUERY.EVENTS_TO_UPDATE(), cb);
};

function asyncRetrieve(eventRows) {
    async.eachLimit(eventRows, parallelAsyncHttpRequests, function(eventRow, cb) {
        var eid = eventRow.eid;
        fb.retrieveEventInfo(eid, function(fbData) {
            fb.retrieveEventGirls(eid, function(number) {
                writeSingleUpdateToDb(fbData, number, eid, cb);
            });
        });
    }, function(err) {
        if (err) {
            console.log('Retrieve problem:' +err);
        } else {
          //doTheBigUpdate(); 
          //what was I supposed to do here???
        }
    });
}

app.get('/update', function (req, res) {
    res.writeHead(200, {'Content-Type': 'text/html'});
    res.end();
    executeBatchUpdate();
});

function executeBatchUpdate() {
    executeQuery(QUERY.CLEAN_OLD_EVENTS_QUERY(), function(nvm) {
        retrieveEventsToUpdate(function(eventRows) {
            if(eventRows.length > 0) {
                console.log('Number of events to update: ' + eventRows.length);
                getAToken(function(token) {
                    fb.setToken(token);
                    asyncRetrieve(eventRows);
                    console.log("Update complete");
                });
            } else {
                console.log("No need to update the events data");
            }
        });
    });
}

function getAToken(cb) {
    var FacebookUser = Parse.Object.extend("FacebookUser");
    var query = new Parse.Query(FacebookUser);
    query.descending("updatedAt")
    query.first().then(function(user) {
        token = user.get("token");
        last_check = moment();
        cb(token);
    });
}
