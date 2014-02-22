module.exports = {
	getDb : function(dbUrl){ return new dbAdapter(dbUrl);} 
};

function dbAdapter(dbUrl) {
	this.pg = require('pg');
	this.dbUrl = dbUrl;
}

dbAdapter.prototype.addEvent = function(eventRow, cb) {
    this.insertQuery(
    	"INSERT INTO events(eid, start_date)values($1, $2);",
    	[eventRow.eid, null],
    	function(result) {
    		cb();
    	},
	    function(error) {
    		if(error.code != 23505) { //ignore the error "it's already present"
	        	cb(error);
                return;
	        }
	    }
	);
};

dbAdapter.prototype.insertQuery = function(querySql, parameters, endCb, errorCb) {
	var db = this;
	db.pg.connect(db.dbUrl, function(error, client, done) {
        if(error) {
            errorCb(error);
            return;
        }
        var query = client.query(querySql, parameters);
	    query.on('error', function(error) {
	        done();
	        errorCb(error);     
		});
	    query.on('end', function(result) {
	        done();
	        endCb(result);
		});
    });
}

dbAdapter.prototype.selectQuery = function(name, queryString, params, cb) {
    var results = [];
    var db = this;
    db.pg.connect(db.dbUrl, function(error, client, done) {
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

dbAdapter.prototype.retrieveEventsInBox = function(bottomRight, topLeft, start, end, cb) {
    var numberOfEventsToRetrieve = 20;
	var query = "SELECT name, start_date AS start_time, end_date AS end_time, attending_total AS people, location, latitude, longitude, eid, attending_f AS female_participants FROM events WHERE((start_date >= $5 AND start_date < $6)OR(start_date < $5 AND end_date > $5))AND last_update IS NOT NULL AND latitude > $1 AND latitude < $2 AND longitude < $3 AND longitude > $4 ORDER BY people DESC LIMIT "+numberOfEventsToRetrieve+";";

    this.selectQuery(
        'retrieveEventsPs',
        query,
        [
            bottomRight.latitude,
            topLeft.latitude,
            bottomRight.longitude,
            topLeft.longitude,
			start,
			end
        ],
        cb
    );
}

dbAdapter.prototype.retrieveEventsToUpdate = function(cb) {
    var maxEventsToUpdate = 200;
	var updateEventEveryXHours = 8;
	var query = "SELECT eid FROM events WHERE(last_update IS NULL OR last_update <(now()- INTERVAL '"+ updateEventEveryXHours +" hours'))AND (end_date >=(now()- INTERVAL '24 hours') or end_date IS NULL)ORDER BY last_update ASC LIMIT " + maxEventsToUpdate;
    this.selectQuery(
        'retrieveEventsToUpdate',
        query,
        [],
        cb
    );
};