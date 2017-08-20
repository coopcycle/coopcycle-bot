/**
 * A Bot to simulate courier activity.
 * It uses a GPX file to determine its itinerary.
 */
var fs = require('fs');
var _ = require('underscore');
var parseXML = require('xml2js').parseString;
var Courier = require('./src/Courier');
var PM2Utils = require('./src/PM2Utils');

var Sequelize = require('sequelize');
var sequelize = new Sequelize('database', 'username', 'password', {
  host: 'localhost',
  dialect: 'sqlite',
  storage: './data/db.sqlite'
});

var Db = require('./src/Db')(sequelize);

const CONFIG = require('./config.json');

var username = process.argv[2];
var password = process.argv[3];
var gpxFile = process.argv[4];
var httpBaseURL = CONFIG.COOPCYCLE_BASE_URL;
var wsBaseURL = httpBaseURL.startsWith('http://') ? httpBaseURL.replace('http://', 'ws://') : httpBaseURL.replace('https://', 'wss://');

var xml = fs.readFileSync(gpxFile);
var points = [];
var courier;

Db.Courier.addRefreshTokenErrorListener((courier) => {
  PM2Utils.stopBot(courier, () => {});
});

Db.Courier.findOne({
  where: {username: username}
}).then((model) => {

  console.log('Loading GPX file...');
  parseXML(xml, function (err, result) {

    _.each(result.gpx.wpt, function(point) {
      points.push({
        latitude: point['$'].lat,
        longitude: point['$'].lon
      })
    });

    courier = new Courier(
      model,
      points,
      wsBaseURL
    );
    courier.connect();
  });
});

process.on('SIGINT', function () {
  var currentPosition = courier.currentPosition;
  if (currentPosition) {
    courier.model.set('lastPosition', JSON.stringify(currentPosition));
    courier.model.save();
  }
});
