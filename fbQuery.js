module.exports = {
	getFbQuery : function(){ return new fbQuery();} 
};

function fbQuery() {
	this.fb = require("./fb-adapter").getFbAdapter();

	this.setToken=setToken;
	function setToken(token) {
		this.fb.setToken(token);
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