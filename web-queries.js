module.exports = {
  FB_EVENTS_TO_UPDATE : function() { return query_FB_EVENTS_TO_UPDATE;},
  UPDATE_EVENT_INFO : function() { return query_UPDATE_EVENT_INFO;},
  RETRIEVE_EVENTS_QUERY : function() { return query_RETRIEVE_EVENTS_QUERY;},
  CLEAN_OLD_EVENTS_QUERY : function() { return query_CLEAN_OLD_EVENTS_QUERY;},
  ADD_EVENT_QUERY : function() { return query_ADD_EVENT_QUERY;},
  EVENTS_TO_UPDATE : function() { return query_EVENTS_TO_UPDATE;}
};

var eventLimitForFbQuery = 100;
var query_FB_EVENTS_TO_UPDATE ="SELECT
        eid,
        start_time
    FROM
        event
    WHERE
        privacy='OPEN'
        AND venue.id <> ''
        AND start_time > now()
        AND eid IN (
            SELECT
                eid 
            FROM
                event_member
            WHERE
                start_time > now()
                AND (
                    uid=me()
                    OR uid IN(
                        SELECT
                            uid2
                        FROM
                            friend
                        WHERE
                            uid1=me()
                    ) 
                )
            ORDER BY start_time ASC LIMIT "+ eventLimitForFbQuery +"
        )
    ORDER BY start_time ASC";
var query_UPDATE_EVENT_INFO = "
    UPDATE events
    SET
        end_date=$1,
        attending_total=$2,
        maybe_total=$3,
        latitude=$4,
        longitude=$5,
        location=$6,
        name=left($7, 100),
        last_update = now()
        WHERE eid = $8;";
var query_RETRIEVE_EVENTS_QUERY = "    
    SELECT
        name,
        start_date AS start_time,
        end_date AS end_time,
        attending_total AS people,
        location,
        latitude,
        longitude,
        eid
    FROM
        events
    WHERE
    (
        (start_date >= $5 AND start_date < $6)
        OR (start_date < $5 AND end_date > $5)
    )
    AND last_update IS NOT NULL
    AND latitude > $1 AND latitude < $2
    AND longitude < $3 AND longitude > $4
    ORDER BY people DESC LIMIT $7;";

var query_CLEAN_OLD_EVENTS_QUERY = "
    DELETE FROM
        events
    WHERE
        (
            start_date < now() - interval '24 hours'
            AND end_date IS NULL
        ) OR (end_date < now());";

var query_ADD_EVENT_QUERY = "INSERT INTO events(eid, start_date) values($1, $2);";

var maxEventsToUpdate = 200;
var updateEventEveryXHours = 4;
var query_EVENTS_TO_UPDATE = "
    SELECT
        eid
    FROM
        events
    WHERE
        (
            last_update IS NULL OR
            last_update < (now() - INTERVAL '"+ updateEventEveryXHours +" hours')
        ) 
        AND start_date >= now() 
    ORDER BY last_update ASC LIMIT " + maxEventsToUpdate;