/**
 * A Bot to simulate courier activity.
 * It uses a GPX file to determine its itinerary.
 */
var fs = require('fs');
var _ = require('lodash');
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

require('./src/fetch-polyfill')
const Client = require('./src/Client')
const WebSocketClient = require('./src/WebSocketClient')

var xml = fs.readFileSync(gpxFile);
var route = [];
var courier;

Db.Courier.findOne({
  where: {username: username}
}).then((model) => {

  console.log('Loading GPX file...');
  parseXML(xml, function (err, result) {

    _.each(result.gpx.wpt, function(point) {
      route.push({
        latitude: point['$'].lat,
        longitude: point['$'].lon
      })
    });

    const client = new Client(CONFIG.COOPCYCLE_BASE_URL, {
      token: model.token,
      refresh_token: model.refreshToken,
    }, {
      autoLogin: client => client.login(model.username, model.username)
    })

    const webSocketClient = new WebSocketClient(client, '/dispatch')

    courier = new Courier(
      model.username,
      client,
      webSocketClient,
      {
        lastPosition: model.get('lastPosition'),
        route: route
      }
    );

    try {
      courier.connect();
    } catch (e) {
      console.log('Stopping bot...', err);
      PM2Utils.stopBot(courier, () => {});
    }

  });

  process.on('SIGINT', function () {
    var currentPosition = courier.currentPosition;
    if (currentPosition) {
      model.set('lastPosition', JSON.stringify(currentPosition));
      model.save();
    }
  });

});
