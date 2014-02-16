module.exports = {
	getFbAdapter : function(){ return new fbAdapter();} 
};

var https = require('https');
https.globalAgent.maxSockets = 80;

function fbAdapter() {

	this.setToken=setToken;
	function setToken(token) {
		this.token = token;
	}

	this.executeFbQuery=executeFbQuery;
	function executeFbQuery(query, cb) {
	    var options = {
	        hostname: 'graph.facebook.com',
	        port: 443,
	        path: "/fql?q=" + escape(query) + "&access_token=" + escape(this.token),
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
	            if(theData == undefined) {
	                console.log('Data undefined');
	            } else if(theData.error == undefined && theData.error_code == undefined) {
	                console.log('Data Retrieved');
	                cb(theData);
	            } else {
	                console.log('FB query ended with error: '+ JSON.stringify(theData));   
	            }
	        });
	    });
	    req.end();
	}

	this.executeFbQuery_HeadOnly=executeFbQuery_HeadOnly;
	function executeFbQuery_HeadOnly(query, cb) {
	    var options = {
	        host: 'graph.facebook.com',
	        port: 443,
	        path: "/fql?q=" + escape(query) + "&access_token=" + escape(this.token),
	        method: 'GET',
	        headers: {
	            'Accept-Encoding': 'identity',
	            'agent': false
	        }
	    };
	    var myReq = https.request(options, function (response) {
	        var header = response.headers;
	        response.destroy();        
	        cb(header);
	    });
	    myReq.end();
	}

}
