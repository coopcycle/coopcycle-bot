var fs = require('fs');
var WebSocket = require('ws');
var FormData = require('form-data');
var _ = require('underscore');
var Promise = require('promise');
var Polyline = require('polyline');

var winston = require('winston');
winston.level = process.env.NODE_ENV === 'production' ? 'info' : 'debug';

const CONFIG = require('../config.json')

require('./fetch-polyfill')
const CoopCycle = require('coopcycle-js')

var toPolylineCoordinates = function(polyline) {
  var steps = Polyline.decode(polyline);
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

function Courier(model, route, wsBaseURL) {

  this.model = model;
  const clientOptions = {
    autoLogin: client => {
      return new Promise((resolve, reject) => {
        return client.login(model.username, model.username)
          .then(credentials => {
            console.log('Updating credentials in DB...');
            this.model.set('token', credentials.token);
            this.model.set('refreshToken', credentials.refresh_token);

            return resolve(credentials)
          })
          .catch(err => reject(err))
      })
    }
  }
  this.client = new CoopCycle.Client(CONFIG.COOPCYCLE_BASE_URL, {
    token: model.token,
    refresh_token: model.refreshToken,
  }, clientOptions)

  this.route = route;
  this.wsBaseURL = wsBaseURL;

  this.timeout = undefined;
  this.ws = undefined;

  this.currentIndex = 0;
  this.currentPosition = undefined;

  var lastPosition = this.model.get('lastPosition');

  if (lastPosition) {
    this.info('Starting at last position', lastPosition);
    this.currentPosition = lastPosition;

    var currentIndex = _.findIndex(route, (point) => {
      return point.latitude === lastPosition.latitude && point.longitude === lastPosition.longitude
    });
    if (currentIndex) {
      this.currentIndex = currentIndex;
    }
  } else {
    this.currentPosition = this.route[this.currentIndex];
  }
}

Courier.prototype.debug = function(msg, data) {
  winston.debug('[' + this.model.username + '] ' + msg, data);
}

Courier.prototype.info = function(msg, data) {
  winston.info('[' + this.model.username + '] ' + msg, data);
}

Courier.prototype.randomPosition = function() {
  return _.random(0, (this.route.length - 1));
}

Courier.prototype.nextPosition = function() {

  // Start at random position
  if (!this.currentIndex) {
    this.currentIndex = this.randomPosition();
  }

  if (this.currentIndex > (this.route.length - 1)) {
    this.currentIndex = 0;
  }

  this.currentPosition = this.route[this.currentIndex];
  ++this.currentIndex;
}

Courier.prototype.updateCoords = function() {
  if (this.ws.readyState === WebSocket.OPEN) {
    this.nextPosition();
    this.sendCurrentPosition();
  }
  this.timeout = setTimeout(this.updateCoords.bind(this), 2000);
}

Courier.prototype.connect = function() {
  this.info('Checking status...');
  this.client.request('GET', '/api/me/status')
    .then(data => {

      console.log(data);

      this.info('Status = ' + data.status);

      this.info('Connecting to WS server');
      this.ws = new WebSocket(this.wsBaseURL + '/realtime', '', {
        headers: {
          Authorization: "Bearer " + this.model.get('token')
        }
      });

      this.ws.onopen = () => {

        this.info('Connected to WS server!');

        clearTimeout(this.timeout);

        if (data.status === 'DELIVERING') {
          this.info('Resuming delivery of delivery', data.delivery);
          this.resumeDelivery(data.delivery);
        } else {
          this.info('Resuming routine');
          this.updateCoords();
        }
      }

      this.ws.onmessage = this.onMessage.bind(this);

      this.ws.onclose = (e) => {
        this.info('Connection closed!');
        clearTimeout(this.timeout);
        setTimeout(this.connect.bind(this), 1000);
      }

      this.ws.onerror = (e) => {
        this.info('Connection error!', e.message);
        this.ws.onclose = function () {}; // Disable onclose handler
        clearTimeout(this.timeout);
        this.info('Will retry connecting in 5s');
        setTimeout(this.connect.bind(this), 5000);
      }
    })
    .catch(err => {
      throw new Error('Fatal error', e);
    });
}

function _goto(route, milliseconds, cb) {
  var position = route.shift();

  if (!position) {
    clearTimeout(this.timeout);
    return cb();
  }

  this.currentPosition = position;
  this.sendCurrentPosition();
  this.timeout = setTimeout(_goto.bind(this, route, milliseconds, cb), milliseconds);
}

Courier.prototype.goto = function(destination, cb) {

  var originParam = [this.currentPosition.latitude, this.currentPosition.longitude].join(',');
  var destinationParam = [destination.latitude, destination.longitude].join(',');

  this.client
    .request('GET', '/api/routing/route?origin=' + originParam + '&destination=' + destinationParam)
    .then((data) => {

      var duration = data.routes[0].duration;
      var route = toPolylineCoordinates(data.routes[0].geometry);
      var milliseconds = Math.ceil((duration / route.length) * 1000);

      this.info('Going to ' + JSON.stringify(destination) + ' in ' + Math.ceil((duration / 60).toFixed(2)) + 'min'
          + ' (' + route.length + ' steps, ' + (milliseconds / 1000) + 's per step)');
      _goto.call(this, route, milliseconds, () => {
        this.info('Arrived at ' + JSON.stringify(destination));
        cb();
      });
    })
    .catch(err => console.log(err));
}

Courier.prototype.resumeDelivery = function(delivery) {
  if (delivery.status === 'DISPATCHED') {
    this.info('Going to restaurant to pick delivery');
    this.goto(delivery.restaurant, () => {
      this.info('Arrived at restaurant!');
      this.pickDelivery(delivery);
    });
  }
  if (delivery.status === 'PICKED') {
    this.info('Going to delivery address to deliver delivery');
    this.goto(delivery.deliveryAddress, () => {
      this.info('Arrived at delivery address!');
      this.deliverDelivery(delivery);
    });
  }
}

Courier.prototype.acceptDelivery = function(delivery) {
  this.info('Accepting delivery #' + delivery.id);
  this.client.request('PUT', '/api/deliveries/' + delivery.id + '/accept', {})
    .then(() => {
      this.info('Delivery #' + delivery.id + ' accepted!');
      this.info('Going to restaurant to pick delivery');
      this.goto(delivery.restaurant, () => {
        this.info('Arrived to restaurant!');
        this.pickDelivery(delivery);
      });
    })
    .catch((e) => {
      throw new Error('CANNOT ACCEPT #' + delivery.id, e);
    });
}

Courier.prototype.pickDelivery = function(delivery) {
  this.info('Picking delivery #' + delivery.id);
  this.client.request('PUT', '/api/deliveries/' + delivery.id + '/pick', {})
    .then(() => {
      this.info('Delivery #' + delivery.id + ' picked!');
      this.info('Going to delivery address to deliver delivery');
      this.goto(delivery.deliveryAddress, () => {
        this.info('Arrived at delivery address!');
        this.deliverDelivery(delivery);
      });
    })
    .catch((e) => {
      throw new Error('CANNOT PICK #' + delivery.id, e);
    });
}

Courier.prototype.deliverDelivery = function(delivery) {
  this.info('Delivering delivery #' + delivery.id);
  this.client.request('PUT', '/api/deliveries/' + delivery.id + '/deliver', {})
    .then(() => {
      this.info('Delivery #' + delivery.id + ' delivered!');
      this.info('Delivery delivered, going back to routine');
      this.currentIndex = this.randomPosition();
      var randomPosition = this.route[this.currentIndex];
      this.goto(randomPosition, () => {
        this.info('Restarting routine');
        clearTimeout(this.timeout);
        this.updateCoords();
      });
    })
    .catch((e) => {
      throw new Error('CANNOT DELIVER #' + delivery.id, e);
    });
}

Courier.prototype.onMessage = function(e) {

  var message = JSON.parse(e.data);
  this.info('Message received!', message);

  if (message.type === 'delivery') {
    clearTimeout(this.timeout);
    setTimeout(this.acceptDelivery.bind(this, message.delivery), 5000);
  }
}

Courier.prototype.sendCurrentPosition = function() {
  if (this.ws.readyState === WebSocket.OPEN) {
    this.debug('Sendind position', this.currentPosition);
    this.ws.send(JSON.stringify({
      type: "updateCoordinates",
      coordinates: this.currentPosition
    }));
  }
}

module.exports = Courier;