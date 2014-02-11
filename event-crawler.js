var token;
var last_check;
var mysql = require('mysql');
var locationDistanceRadius = 10000;

var pool = mysql.createPool(process.env.CLEARDB_DATABASE_URL);

//crawler version
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

app.get('/crawlFacebook', function (req, res) {
    res.writeHead(200, {'Content-Type': 'text/html'});
    res.end();
    babamUpdate();
});

function babamUpdate() {
    addLocations();
}

function addLocations() {
    pool.getConnection(function(err, connection) {
        if(err){ console.log(err); } else {
            connection.query("SELECT id, name, lat, lng FROM comuni WHERE ((last_update < '"+moment().subtract('hours', 48).format()+"') OR (last_update IS NULL)) LIMIT 10;", function(err, rows, fields) {
                connection.end();
                if (err) {
                    console.log(err);
                } else {                
                    async.eachLimit(rows, 5, function(myLocation, cb) {
                        var theToken = token;
                        if(myLocation['name']) {
                            console.log(myLocation['name']);
                            var thePath = "/search?type=place&center="+myLocation['lat']+","+myLocation['lng']+"&distance="+locationDistanceRadius+"&fields=id,location,name&access_token=" + theToken;
                            locationsQueue.push(thePath);
                            pool.getConnection(function(err, connection2) {
                                connection2.query("UPDATE comuni SET last_update = '"+moment().format()+"' WHERE id = ?", [myLocation['id']],function(err, rows, fields) {
                                    connection2.end();
                                    cb();
                                });
                                //console.log('inner mysql connection closed');
                            });
                         }
                    }, function(error) {
                        console.log(error);
                    });
                }
            });
            //console.log('outer mysql connection closed');
        }
    });
}

var locationsQueue = async.queue(function(thePath, callback) {
    getNext(thePath, callback);
}, 5);
locationsQueue.drain = function() {
};

var placesQueue = async.queue(function(venue, callback) {
    updatePlace(venue, callback);
}, 30);
placesQueue.drain = function() {
    addLocations();
};

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

function updatePlace(place, cb) {
    getEvents(place, function() {
        pool.getConnection(function(err, connection) {
            connection.query( 'UPDATE places SET last_update = ? where id = ?', [moment().format(), place.id],function(err, rows) {
                connection.end();
                cb();
            });
        });
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
    if(placesQueue.length()%100 == 0) {
        console.log("Places: "+ placesQueue.length());
    }
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
                    console.log(entry.id + " " + place.name);
                    babamInsert(entry, cb);
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
    pool.getConnection(function(err, connection) {
        connection.query( 'select last_update from places where id = ?', [place.id],function(err, rows) {
            if(rows.length > 0) {
                connection.end();
                var dbResult = rows[0];
                var beforeThisItsTooOld = moment().subtract('hours', checkPlaceEveryXHours);
                if(dbResult['last_update'] < beforeThisItsTooOld) {
                    placesQueue.push(place);
                }
            } else {
               connection.query( 'INSERT INTO places(id, name, last_update) values(?, ?, NULL)', [place.id, place.name],function(err, rows) {
                    connection.end();
               });
            }
        });
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
