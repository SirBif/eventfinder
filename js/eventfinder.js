var fbAppId=180798855409162;
window.fbAsyncInit = function() {		
	FB.init({
		appId      : fbAppId, // Facebook App ID
		channelUrl : '//enigmatic-cove-8808-735.herokuapp.com/misc/channel.html',
		cookie     : true, // enable cookies to allow Parse to access the session
		xfbml      : true  // parse XFBML
	});

	FB.Event.subscribe('auth.authResponseChange', function(response) {
		// Here we specify what we do with the response anytime this event occurs. 
		if (response.status === 'connected') {
			$('#fbButton').addClass('hide');
			$('#toggleButton').removeClass('hide');
			handleLogin();
		} else if (response.status === 'not_authorized') {
		    $('#fbButton').removeClass('hide');
			FB.login();
		} else {
		    $('#fbButton').removeClass('hide');
			FB.login();
		}
	});
};

// Load the SDK asynchronously
(function(d){
	var js, id = 'facebook-jssdk', ref = d.getElementsByTagName('script')[0];
	if (d.getElementById(id)) {return;}
	js = d.createElement('script'); js.id = id; js.async = true;
	js.src = "//connect.facebook.net/en_US/all.js";
	ref.parentNode.insertBefore(js, ref);
}(document));

var activeCount = 0;
function updateMarkers() {
    activeCount++;
    if(activeCount == 1) {
        var properties = $('#mapContainer').jHERE();
        var bottomRight = properties.bbox.bottomRight;
        var topLeft = properties.bbox.topLeft;
        $('#list').empty();
        var requestString = "/retrieve?";
        requestString += "bottomRightLat=" + bottomRight.latitude;
        requestString += "&bottomRightLon=" + bottomRight.longitude;
        requestString += "&topLeftLat=" + topLeft.latitude;
        requestString += "&topLeftLon=" + topLeft.longitude;
        requestString += "&time=" + moment().startOf('day').format();
        $.get(requestString, {}).then(function(resultsJson) {printResults(resultsJson);});
    }
    activeCount--;
}

var lastRefresh = moment();
function handleLogin() {
	FB.getLoginStatus(function(response) {
		if (response.status === 'connected') {
			var uid = response.authResponse.userID;
			var accessToken = response.authResponse.accessToken;
		    $('#mapContainer').jHERE({
                enable: ['behavior', 'positioning', 'zoombar', 'scalebar'],
                center: [44.843699,11.619072],
                zoom: 9,
                appId: '2555Yk0ixeYKXQe2OrXM',
                authToken: 'E5I47YZhcJA7W9P6eIebEA'
            });
            $('#toggleMenu').sidr({
              name: 'event-menu',
              source: function() { return $('#navigation').children();}
            });
            $('#mapContainer').jHERE('originalMap', function(map, here) {
                map.addListener("mapviewchangeend", function (obj, key, newValue, oldValue) {
                    updateMarkers();  
                }, false);
                //we load the markers for the 1st time
                updateMarkers();
            });
			$.get("/login", {uid: uid, token : accessToken});
		}
	});
}

function getContent(entry) {
    var result = '<table>';
    result += '<tr><td><a href="http://www.facebook.com/' + entry.eid +'" target="_blank">' + entry.name + '</a></td></tr>';
    result += "<tr><td>Start: " + moment(entry.start_time).format('LLL') + '</td></tr>';
    result += (entry.end_time) ? "<tr><td>End: " + moment(entry.end_time).format('LLL') + '</td></tr>' : "";
    result += "<tr><td>Location: " + entry.location + '</td></tr>';
    result += "<tr><td>Going: " + entry.people + '</td></tr>';
    result += '</table>';
    return result;
}

function printResults(results) {
	if(results == undefined) {			
        // stuff
	} else {
	  $('#mapContainer').jHERE('nomarkers');
      var i = 1;
		results.forEach(function(entry) {
		    var positionArray = [parseFloat(entry.latitude), parseFloat(entry.longitude)];			 	
			$('#mapContainer').jHERE('marker', positionArray, {
            	text: i,
            	mouseenter: function(event) {
            	    $('#mapContainer').jHERE(
            	        'bubble',
            	        positionArray,
            	        {closable: true, content: getContent(entry)}
            	    );
                },
                click: function(event) {
            	    $('#mapContainer').jHERE(
            	        'bubble',
            	        positionArray,
            	        {closable: true, content: getContent(entry)}
            	    );
                }
            });
            $('#list').append('<li id="item_' +i+ '"><a href="http://www.facebook.com/' + entry.eid +'" target="_blank">' + entry.name + '</a>\n(Going: ' + entry.people + ')</li>');
            i++;
        });
	}
}
