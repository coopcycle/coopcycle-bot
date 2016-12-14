var Polyline = require('polyline');
var fetch = require('node-fetch');

function DirectionsAPI(apiKey) {
    this.apiKey = apiKey;
}

DirectionsAPI.prototype.getDirections = function(opts) {
  var origin = opts.origin;
  var destination = opts.destination;
  var url = 'https://maps.googleapis.com/maps/api/directions/json?mode=bicycling';
      url += '&origin=' + origin.latitude + ',' + origin.longitude;
      url += '&destination=' + destination.latitude + ',' + destination.longitude;
      url += '&key=' + this.apiKey;

  if (opts.waypoints) {
    url += '&waypoints=' + opts.waypoints.latitude + ',' + opts.waypoints.longitude;
  }

  return fetch(url)
    .then(function(response) {
      return response.json();
    });
}

DirectionsAPI.toPolylineCoordinates = function(data) {
  var points = data.routes[0].overview_polyline.points;
  var steps = Polyline.decode(points);
  var polylineCoords = [];

  for (var i = 0; i < steps.length; i++) {
    var tempLocation = {
      latitude : steps[i][0],
      longitude : steps[i][1]
    }
    polylineCoords.push(tempLocation);
  }

  return polylineCoords;
}

module.exports = DirectionsAPI;