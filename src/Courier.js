var fs = require('fs');
var WebSocket = require('ws');
var FormData = require('form-data');
var fetch = require('node-fetch');
var Request = require('node-fetch').Request;
var Headers = require('node-fetch').Headers;
var _ = require('underscore');
var DirectionsAPI = require('./DirectionsAPI');
var Promise = require('promise');

function Courier(model, route, httpBaseURL, wsBaseURL, directionsAPI, db) {

  this.model = model;

  this.route = route;
  this.httpBaseURL = httpBaseURL;
  this.wsBaseURL = wsBaseURL;
  this.directionsAPI = directionsAPI;
  this.db = db;

  this.timeout = undefined;
  this.ws = undefined;

  this.currentIndex = 0;
  this.currentPosition = undefined;

  var lastPosition = this.model.get('lastPosition');

  if (lastPosition) {
    var currentIndex = _.findIndex(route, (point) => {
      return point.latitude === lastPosition.latitude && point.longitude === lastPosition.longitude
    });
    if (currentIndex) {
      console.log('Starting at last position', lastPosition);
      this.currentIndex = currentIndex;
      this.currentPosition = lastPosition;
    }
  }
}

Courier.prototype.createAuthorizedRequest = function(method, uri, data) {
  var headers = new Headers();
  headers.append("Authorization", "Bearer " + this.model.get('token'));
  headers.append("Content-Type", "application/json");

  var options = {
    method: method,
    headers: headers,
  }
  if (data) {
    options.body = JSON.stringify(data)
  }

  return new Request(this.httpBaseURL + uri, options);
}

Courier.prototype.getToken = function(cb) {

  if (!this.model.get('token')) {
    return this.login().then((credentials) => {
      this.model.set('token', credentials.token);
      this.model.set('refreshToken', credentials.refresh_token);
      this.model.save().then(() => {
        cb(this.model.get('token'));
      });
    });
  }

  cb(this.model.get('token'));
}

Courier.prototype.refreshToken = function(cb) {
  var formData  = new FormData();
  formData.append("refresh_token", this.model.get('refreshToken'));
  var request = new fetch.Request(this.httpBaseURL + '/api/token/refresh', {
    method: 'POST',
    body: formData
  });

  var self = this;
  fetch(request)
    .then(function(response) {
      if (response.ok) {
        return response.json().then(function(credentials) {
          console.log('Token refreshed!');
          self.model.set('token', credentials.token);
          self.model.set('refreshToken', credentials.refresh_token);
          self.model.save().then(() => {
            cb(self.model.get('token'));
          });
        });
      } else {
        return response.json().then(function(json) {
          console.log(json.message);
        });
      }
    });
}

Courier.prototype.login = function() {
  console.log('Login ' + this.httpBaseURL + '/api/login_check');

  var formData  = new FormData();
  formData.append("_username", this.model.get('username'));
  formData.append("_password", this.model.get('password'));
  var request = new fetch.Request(this.httpBaseURL + '/api/login_check', {
    method: 'POST',
    body: formData
  });

  var self = this;
  return fetch(request)
    .then(function(response) {
      if (response.ok) {
        return response.json();
      } else {
        return response.json().then(function(json) {
          console.log(json.message);
        });
      }
    })
    .catch(function(err) {
      console.log(err);
    });
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
    console.log('Sendind position', this.currentPosition);
    this.ws.send(JSON.stringify({
      type: "updateCoordinates",
      coordinates: this.currentPosition
    }));
  }
  this.timeout = setTimeout(this.updateCoords.bind(this), 2000);
}

Courier.prototype.checkStatus = function(cb) {
  var request = this.createAuthorizedRequest('GET', '/api/me/status');
  fetch(request)
    .then(function(response) {
      return response.json().then(function(data) {
        cb(data);
      })
    });
}

Courier.prototype.connect = function() {
  var self = this;
  this.getToken(function(token) {

    console.log('Connecting to ws server');

    self.ws = new WebSocket(self.wsBaseURL + '/realtime', '', {
      headers: {
        Authorization: "Bearer " + token
      }
    });

    self.ws.onopen = function() {
      console.log('User ' + self.model.get('username') + ' connected to server!');
      clearTimeout(self.timeout);
      self.updateCoords();

      console.log('Checking status...');
      self.checkStatus(function(data) {
        if (data.status === 'DELIVERING') {

          console.log('Resuming delivery of order', data.order);
          clearTimeout(self.timeout);

          if (data.order.status === 'ACCEPTED') {
            console.log('Going to restaurant to pick order');
            self.getDirectionsAndGoto(data.order.restaurant, function() {
              console.log('Arrived at restaurant!');
              self.pickOrder(data.order);
            });
          }

          if (data.order.status === 'PICKED') {
            console.log('Going to delivery address to deliver order');
            self.getDirectionsAndGoto(data.order.deliveryAddress, function() {
              console.log('Arrived at delivery address!');
              self.deliverOrder(data.order);
            });
          }
        }
      });
    }

    self.ws.onmessage = self.onMessage.bind(self);

    self.ws.onclose = function(e) {
      console.log('Connection closed!');
      clearTimeout(self.timeout);
      setTimeout(self.connect.bind(self), 1000);
    }

    self.ws.onerror = function(err) {
      console.log('Connection error!');
      self.ws.onclose = function () {}; // Disable onclose handler
      clearTimeout(self.timeout);
      if (err.message === 'unexpected server response (401)') {
        console.log('Token seems to be expired, refreshing...');
        self.refreshToken(self.connect.bind(self));
      } else {
        console.log('Connection error! Will retry in 5s');
        setTimeout(self.connect.bind(self), 5000);
      }
    }
  });
}

Courier.prototype.getDirectionsAndGoto = function(destination, cb) {
  var self = this;
  this.directionsAPI.getDirections({
    origin: this.currentPosition,
    destination: destination
  })
  .then(function(data) {
    var route = DirectionsAPI.toPolylineCoordinates(data);
    console.log('Going to ' + JSON.stringify(destination));
    self.goto(route, function() {
      console.log('Arrived at ' + JSON.stringify(destination));
      cb();
    });
  });
}

Courier.prototype.goto = function(route, cb) {

  var position = route.shift();

  if (!position) {
    clearTimeout(this.timeout);
    return cb();
  }

  this.currentPosition = position;

  this.ws.send(JSON.stringify({
    type: "updateCoordinates",
    coordinates: this.currentPosition
  }));

  this.timeout = setTimeout(this.goto.bind(this, route, cb), 4000);
}

Courier.prototype.acceptOrder = function(order) {

  console.log('Accepting order #' + order.id);
  var request = this.createAuthorizedRequest('PUT', '/api/orders/' + order.id + '/accept', {});

  var self = this;
  fetch(request)
    .then(function(response) {
      if (!response.ok) {
        throw new Error('CANNOT ACCEPT ORDER #' + order.id);
      }
      console.log('Order #' + order.id + ' accepted!');
      return response.json();
    })
    .then(function() {
      console.log('Going to restaurant to pick order');
      self.getDirectionsAndGoto(order.restaurant, function() {
        console.log('Arrived to restaurant!');
        self.pickOrder(order);
      });
    });

}

Courier.prototype.pickOrder = function(order) {

  console.log('Picking order #' + order.id);
  var request = this.createAuthorizedRequest('PUT', '/api/orders/' + order.id + '/pick', {});

  var self = this;
  fetch(request)
    .then(function(response) {
      if (!response.ok) {
        throw new Error('CANNOT PICK ORDER #' + order.id);
      }
      console.log('Order #' + order.id + ' picked!');
      return response.json();
    })
    .then(function() {
      console.log('Going to delivery address to deliver order');
      self.getDirectionsAndGoto(order.deliveryAddress, function() {
        console.log('Arrived at delivery address!');
        self.deliverOrder(order);
      });
    });
}

Courier.prototype.deliverOrder = function(order) {

  console.log('Delivering order #' + order.id);
  var request = this.createAuthorizedRequest('PUT', '/api/orders/' + order.id + '/deliver', {});

  var self = this;
  fetch(request)
    .then(function(response) {
      if (!response.ok) {
        throw new Error('CANNOT DELIVER ORDER #' + order.id);
      }
      console.log('Order #' + order.id + ' delivered!');
      return response.json();
    })
    .then(function() {
      console.log('Order delivered, going back to routine');
      var randomPosition = self.randomPosition();
      self.getDirectionsAndGoto(randomPosition);
    });
}

Courier.prototype.onMessage = function(e) {

  var message = JSON.parse(e.data);
  console.log('Message received!', message);

  if (message.type === 'order') {
    clearTimeout(this.timeout);
    setTimeout(this.acceptOrder.bind(this, message.order), 5000);
  }
}

module.exports = Courier;