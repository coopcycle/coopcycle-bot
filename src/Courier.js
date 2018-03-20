var _ = require('lodash');
var Promise = require('promise');
var Polyline = require('polyline');
const moment = require('moment')

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

function Courier(username, client, webSocketClient, options) {

  this.username = username
  this.client = client
  this.webSocketClient = webSocketClient

  const { lastPosition, route, speedFactor } = options

  this.timeout = undefined;
  this.currentIndex = 0;
  this.currentPosition = undefined;

  this.route = route
  this.speedFactor = speedFactor

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
  winston.debug(`[${this.username}] ${msg}`, data);
}

Courier.prototype.info = function(msg, data) {
  winston.info(`[${this.username}] ${msg}`, data);
}

Courier.prototype.error = function(msg, data) {
  winston.error(`[${this.username}] ${msg}`, data);
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

  this.nextPosition()
  this.timeout = setTimeout(this.updateCoords.bind(this), 2000)

  this.sendCurrentPosition()

}

Courier.prototype.connect = function() {
  this.client.get('/api/me/tasks/' + moment().format('YYYY-MM-DD'))
    .then(tasks => {

      const task = _.find(tasks['hydra:member'], task => task.status === 'TODO')

      this.webSocketClient
        .connect()
        .then(() => {
          this.info('Connected to WebSocket!');
          if (task) {
            this.executeTask(task)
          } else {
            this.updateCoords();
          }
        })

    })
    .catch(e => {
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

  var originParam = [
    this.currentPosition.latitude,
    this.currentPosition.longitude
  ].join(',')

  var destinationParam = [
    destination.latitude,
    destination.longitude
  ].join(',');

  return new Promise((resolve, reject) => {
    this.client
      .get(`/api/routing/route/${originParam};${destinationParam}`)
      .then((data) => {

        var duration = data.routes[0].duration * this.speedFactor;
        var route = toPolylineCoordinates(data.routes[0].geometry);
        var milliseconds = Math.ceil((duration / route.length) * 1000);

        this.info('Going to ' + JSON.stringify(destination) + ' in ' + Math.ceil((duration / 60).toFixed(2)) + 'min'
            + ' (' + route.length + ' steps, ' + (milliseconds / 1000) + 's per step)');

        _goto.call(this, route, milliseconds, () => {
          this.info('Arrived at ' + JSON.stringify(destination));
          resolve()
        });
      })
      .catch(err => console.log(err));
  })
}

Courier.prototype.executeTask = function(task) {
  this.info(`Executing task #${task.id}`)
  this.goto(task.address.geo)
    .then(() => {
      this.client
        .put(task['@id'] + '/done', { notes: 'DONE' })
        .then(task => {
          this.info(`Task #${task.id} executed!`)
          return this.client.get('/api/me/tasks/' + moment().format('YYYY-MM-DD'))
        })
        .then(tasks => _.find(tasks['hydra:member'], task => task.status === 'TODO'))
        .then(task => {
          if (task) {
            this.executeTask(task)
          } else {
            this.info(`Nothing to do, resuming routine`)
            this.currentIndex = this.randomPosition();
            var randomPosition = this.route[this.currentIndex];
            this.goto(randomPosition)
              .then(() => {
                clearTimeout(this.timeout)
                this.updateCoords()
              })
          }
        })
    })
}

Courier.prototype.onMessage = function(e) {
  var message = JSON.parse(e.data);
  this.info('Message received!', message);
}

Courier.prototype.sendCurrentPosition = function() {
  this.debug('Sendind position', this.currentPosition);
  this.webSocketClient.send({
    type: "position",
    data: this.currentPosition
  })
}

module.exports = Courier;