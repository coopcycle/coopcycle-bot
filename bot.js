/**
 * A Bot to simulate courier activity.
 * It uses a GPX file to determine its itinerary.
 */
var fs = require('fs');
var _ = require('underscore');
var WebSocket = require('ws');
var fetch = require('node-fetch');
var FormData = require('form-data');
var parseXML = require('xml2js').parseString;

var ws;
var token;
var refreshToken;
var username;

var username = process.argv[2];
var password = process.argv[3];
var gpxFile = process.argv[4];
var httpBaseURL = process.argv[5];
var wsBaseURL = httpBaseURL.startsWith('http://') ? httpBaseURL.replace('http://', 'ws://') : httpBaseURL.replace('https://', 'wss://');

var formData  = new FormData();
formData.append("_username", username);
formData.append("_password", password);
var request = new fetch.Request(httpBaseURL + '/api/login_check', {
  method: 'POST',
  body: formData
});

var timeout;

var xml = fs.readFileSync(gpxFile);
var points = [];
var index = 0;

function next_position() {
  if (index > (points.length - 1)) {
    index = 0;
  }
  var position = points[index];
  ++index;

  return position;
}

function update_coords() {
  if (ws.readyState === WebSocket.OPEN) {
    var position = next_position();
    console.log('Sendind position', position);
    ws.send(JSON.stringify({
      type: "updateCoordinates",
      coordinates: position
    }));
  }
  timeout = setTimeout(update_coords, 4000);
}

function store_credentials(user, cb) {
  var filename = __dirname + "/data/" + username + ".json";
  fs.writeFile(filename, JSON.stringify(user), function(err) {
    if (err) throw err;

    username = user.username;
    token = user.token;
    refreshToken = user.refresh_token;
    cb();
  });
}

function refresh_token() {
  var formData  = new FormData();
  formData.append("refresh_token", refreshToken);
  var request = new fetch.Request(httpBaseURL + '/api/token/refresh', {
    method: 'POST',
    body: formData
  });
  fetch(request)
    .then(function(response) {
      if (response.ok) {
        return response.json().then(function(user) {
          console.log('Token refreshed!')
          store_credentials(user, function() {
            setTimeout(ws_connect, 5000);
          });
        });
      } else {
        return response.json().then(function(json) {
          console.log(json.message);
        });
      }
    });
}

function ws_connect() {

  console.log('Connecting to ws server')

  ws = new WebSocket(wsBaseURL + '/realtime', '', {
    headers: {
      Authorization: "Bearer " + token
    }
  });

  ws.onopen = function() {
    console.log('User '+username+' connected to server!');
    clearTimeout(timeout);
    update_coords();
  }

  ws.onmessage = function(e) {
    var message = JSON.parse(e.data);
    console.log(message);
    if (message.type === 'order') {
      setTimeout(function() {
        console.log('Declining order #' + message.order.id)
        ws.send(JSON.stringify({
          type: "declineOrder",
          // type: 'acceptOrder',
        }));
      }, 5000);
    }
  }

  ws.onclose = function(e) {
    // console.log('Connection closed!', e);
    clearTimeout(timeout);
    setTimeout(ws_connect, 1000);
  }

  ws.onerror = function(err) {
    clearTimeout(timeout);
    ws.onclose = function () {}; // Disable onclose handler
    if (err.message === 'unexpected server response (401)') {
      console.log('Token seems to be expired, refreshing...');
      refresh_token();
    } else {
      console.log('Connection error! Will retry in 5s');
      setTimeout(ws_connect, 5000);
    }
  }
}

console.log('Loading GPX file...');
parseXML(xml, function (err, result) {

  _.each(result.gpx.wpt, function(point) {
    points.push({
      latitude: point['$'].lat,
      longitude: point['$'].lon
    })
  });

  // Start at random position
  index = _.random(0, (points.length - 1));

  console.log('Loading...');

  var filename = __dirname + "/data/" + username + ".json";

  if (fs.existsSync(filename)) {
    console.log('User info already saved');
    var user = JSON.parse(fs.readFileSync(filename));
    username = user.username;
    token = user.token;
    refreshToken = user.refresh_token;
    ws_connect();
  } else {
    console.log('User info never saved, fetching token');
    fetch(request).then(function(response) {
      if (response.ok) {
        return response.json().then(function(user) {
          store_credentials(user, function() {
            setTimeout(ws_connect, 5000);
          });
        });
      } else {
        return response.json().then(function(json) {
          console.log(json.message);
        });
      }
    });
  }

});
