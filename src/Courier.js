var fs = require('fs');
var WebSocket = require('ws');
var FormData = require('form-data');
var _ = require('underscore');
var API = require('./API');
var Promise = require('promise');
var Polyline = require('polyline');

var winston = require('winston');
winston.level = process.env.NODE_ENV === 'production' ? 'info' : 'debug';

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

function Courier(model, route, httpBaseURL, wsBaseURL) {

  this.model = model;
  this.client = API.createClient(httpBaseURL, model);

  this.route = route;
  this.httpBaseURL = httpBaseURL;
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
  this.client.request('GET', '/api/me/status').then((data) => {

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
        this.info('Resuming delivery of order', data.order);
        this.resumeOrder(data.order);
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
  });
}

function _goto(route, cb) {
  var position = route.shift();

  if (!position) {
    clearTimeout(this.timeout);
    return cb();
  }

  this.currentPosition = position;
  this.sendCurrentPosition();
  this.timeout = setTimeout(_goto.bind(this, route, cb), 4000);
}

Courier.prototype.goto = function(destination, cb) {

  var originParam = [this.currentPosition.latitude, this.currentPosition.longitude].join(',');
  var destinationParam = [destination.latitude, destination.longitude].join(',');

  this.client
    .request('GET', '/api/routing/route?origin=' + originParam + '&destination=' + destinationParam)
    .then((data) => {
      var route = toPolylineCoordinates(data.routes[0].geometry);
      this.info('Going to ' + JSON.stringify(destination));
      _goto.call(this, route, () => {
        this.info('Arrived at ' + JSON.stringify(destination));
        cb();
      });
    });
}

Courier.prototype.resumeOrder = function(order) {
  if (order.status === 'ACCEPTED') {
    this.info('Going to restaurant to pick order');
    this.goto(order.restaurant, () => {
      this.info('Arrived at restaurant!');
      this.pickOrder(order);
    });
  }
  if (order.status === 'PICKED') {
    this.info('Going to delivery address to deliver order');
    this.goto(order.deliveryAddress, () => {
      this.info('Arrived at delivery address!');
      this.deliverOrder(order);
    });
  }
}

Courier.prototype.acceptOrder = function(order) {
  this.info('Accepting order #' + order.id);
  this.client.request('PUT', '/api/orders/' + order.id + '/accept', {})
    .then(() => {
      this.info('Order #' + order.id + ' accepted!');
      this.info('Going to restaurant to pick order');
      this.goto(order.restaurant, () => {
        this.info('Arrived to restaurant!');
        this.pickOrder(order);
      });
    })
    .catch((e) => {
      throw new Error('CANNOT ACCEPT ORDER #' + order.id, e);
    });
}

Courier.prototype.pickOrder = function(order) {
  this.info('Picking order #' + order.id);
  this.client.request('PUT', '/api/orders/' + order.id + '/pick', {})
    .then(() => {
      this.info('Order #' + order.id + ' picked!');
      this.info('Going to delivery address to deliver order');
      this.goto(order.deliveryAddress, () => {
        this.info('Arrived at delivery address!');
        this.deliverOrder(order);
      });
    })
    .catch((e) => {
      throw new Error('CANNOT PICK ORDER #' + order.id, e);
    });
}

Courier.prototype.deliverOrder = function(order) {
  this.info('Delivering order #' + order.id);
  this.client.request('PUT', '/api/orders/' + order.id + '/deliver', {})
    .then(() => {
      this.info('Order #' + order.id + ' delivered!');
      this.info('Order delivered, going back to routine');
      this.currentIndex = this.randomPosition();
      var randomPosition = this.route[this.currentIndex];
      this.goto(randomPosition, () => {
        this.info('Restarting routine');
        clearTimeout(this.timeout);
        this.updateCoords();
      });
    })
    .catch((e) => {
      throw new Error('CANNOT DELIVER ORDER #' + order.id, e);
    });
}

Courier.prototype.onMessage = function(e) {

  var message = JSON.parse(e.data);
  this.info('Message received!', message);

  if (message.type === 'order') {
    clearTimeout(this.timeout);
    setTimeout(this.acceptOrder.bind(this, message.order), 5000);
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