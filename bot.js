/**
 * A Bot to simulate courier activity.
 * It uses a GPX file to determine its itinerary.
 */
var fs = require('fs');
var _ = require('underscore');
var parseXML = require('xml2js').parseString;
var DirectionsAPI = require('./src/DirectionsAPI');
var Courier = require('./src/Courier');
var CONFIG = require('./config.json');

var GOOGLE_API_KEY = CONFIG.GOOGLE_API_KEY;
var directionsAPI = new DirectionsAPI(GOOGLE_API_KEY);

var username = process.argv[2];
var password = process.argv[3];
var gpxFile = process.argv[4];
var httpBaseURL = process.argv[5];
var wsBaseURL = httpBaseURL.startsWith('http://') ? httpBaseURL.replace('http://', 'ws://') : httpBaseURL.replace('https://', 'wss://');

var xml = fs.readFileSync(gpxFile);
var points = [];

console.log('Loading GPX file...');
parseXML(xml, function (err, result) {

  _.each(result.gpx.wpt, function(point) {
    points.push({
      latitude: point['$'].lat,
      longitude: point['$'].lon
    })
  });

  var courier = new Courier(
    username,
    password,
    points,
    httpBaseURL,
    wsBaseURL,
    directionsAPI
  );
  courier.connect();
});
