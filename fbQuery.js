module.exports = {
	getFbQuery : function(){ return new fbQuery();} 
};

function fbQuery() {
	this.fb = require("./fb-adapter").getFbAdapter();

	this.setToken=setToken;
	function setToken(token) {
		this.fb.setToken(token);
	}

	this.queryForEvents=queryForEvents;
	function queryForEvents(cb) {
		this.fb.executeFbQuery(query_FB_EVENTS_TO_INSERT, cb);
	}

	this.retrieveEventInfo=retrieveEventInfo;
	function retrieveEventInfo(eid, cb) {    
	    this.fb.executeFbQuery(retrieveEventInfo_Query(eid), cb);
	}

	this.retrieveEventGirls=retrieveEventGirls;
	function retrieveEventGirls(eid, cb) {
	    this.fb.executeFbQuery_HeadOnly(retrieveEventGirls_Query(eid), function(header) {
	        cb(getNumberOfElements(header['content-length']));
	    });
	}

	var eventLimitForFbQuery = 100;
	var maxFriends = 300;
	var query_FB_EVENTS_TO_INSERT ="SELECT eid, start_time FROM event WHERE privacy='OPEN' AND venue.id <> '' AND start_time > now()AND eid IN(SELECT eid FROM event_member WHERE start_time > now()AND(uid=me()OR uid IN(SELECT uid2 FROM friend WHERE uid1=me() LIMIT " + maxFriends+ "))ORDER BY start_time ASC LIMIT "+ eventLimitForFbQuery +")ORDER BY start_time ASC";

	function retrieveEventInfo_Query(eid) {
	    return "{"+
	        "\"theevent\":\"select eid, name, attending_count, unsure_count, location, venue.id, start_time, end_time from event where eid='"+eid+"'\"," +
	        "\"thevenue\":\"select location.latitude, location.longitude from page where page_id in (select venue.id from #theevent )\"" + 
	        "}";
	}

	function retrieveEventGirls_Query(eid) {
	    return "select '' from user where sex = 'female' and uid in (select uid from event_member where eid ='"+eid+"' and rsvp_status = 'attending')";
	}


	function getNumberOfElements(size) {
	   var number = (size - 10) / 12;
	   if(number === parseInt(number)) {
	     return number;
	   }
	   return null;//event has a hidden guest list
	}

}