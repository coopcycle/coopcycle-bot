var pm2 = require('pm2');
var _ = require('underscore');
var expressNunjucks = require('express-nunjucks');
var bodyParser = require('body-parser');
var fs = require('fs');
var express = require('express');

var multer = require('multer');
var storage = multer.memoryStorage();
var upload = multer({ storage: storage });

var Sequelize = require('sequelize');

var sequelize = new Sequelize('database', 'username', 'password', {
  host: 'localhost',
  dialect: 'sqlite',
  storage: './data/db.sqlite'
});

var Courier = sequelize.define('courier', {
  id: {
    type: Sequelize.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  username: Sequelize.STRING,
  password: Sequelize.STRING,
});

var Routine = sequelize.define('routine', {
  id: {
    type: Sequelize.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  name: Sequelize.STRING,
  description: Sequelize.TEXT,
});

Courier.belongsTo(Routine);

Courier.sync();
Routine.sync();

var app = express();

app.set('view engine', 'njk');
var njk = expressNunjucks(app, {
    watch: true,
    noCache: true
});

app.use(express.static('web'));
app.use('/gpx', express.static('gpx'));

app.use(bodyParser.json()); // support json encoded bodies
app.use(bodyParser.urlencoded({ extended: true })); // support encoded bodies

var server = require('http').Server(app);
var io = require('socket.io')(server);

var botsConfig = require('./bots.json');
var baseURL = process.env.NODE_ENV === 'production' ? "https://coopcycle.org" : "http://coopcycle.dev";

var bots = {};
botsConfig.forEach(function(botConfig) {
  bots[botConfig.username] = {
    username: botConfig.username,
    gpx: botConfig.gpx
  }
});

function startBot(courier, cb) {

  console.log('Starting bot ' + courier.username);

  var filename = 'gpx/' + courier.routine.id + '.gpx';

  var args = [
    courier.username,
    courier.password,
    filename,
    baseURL
  ];

  pm2.connect(function(err) {
    if (err) return cb(err);

    pm2.start({
      name: 'coopcycle-bot-' + courier.username,
      script: 'bot.js',
      watch: ['bot.js', './src/*.js'],
      args: args,
    }, function(err, apps) {
      pm2.disconnect();
      cb(err);
    });
  });
}

function stopBot(courier, cb) {
  console.log('Stopping bot ' + courier.username);
  pm2.connect(function(err) {
    if (err) return cb(err);
    pm2.stop('coopcycle-bot-' + courier.username, function(err) {
      pm2.disconnect();
      cb(err);
    });
  });
}

function refreshApps() {
  console.time("Listing apps");
  pm2.connect(function(err) {
    if (err) throw err;
    pm2.list(function(err, apps) {

      pm2.disconnect();


      apps = _.filter(apps, function(app) {
        return app.name.startsWith('coopcycle-bot-');
      });
      apps = _.map(apps, function(app) {
        var username = app.name.replace('coopcycle-bot-', '');
        return {
          username: username,
          status: app.pm2_env.status
        };
      });

      console.timeEnd("Listing apps");

      console.log(apps);

      io.sockets.emit('apps', apps);

      setTimeout(refreshApps, 2000);
    });
  });
}

app.get('/', (req, res) => {
  Courier.findAll({
    include: [Routine],
    attributes: ['id', 'username']
  }).then((couriers) => {
    res.render('index', {
      couriers: couriers
    });
  });
});

var atLeastOne = false;
io.on('connection', function (socket) {
  if (!atLeastOne) {
    refreshApps();
    atLeastOne = true;
  }
});

app.post('/bots/:id/start', (req, res) => {
  Courier.findById(req.params.id, {include: [Routine]}).then((courier) => {
    startBot(courier, (err) => {
      res.setHeader('Content-Type', 'application/json');
      res.send(JSON.stringify(err ? 'KO' : 'OK'));
    })
  });
});

app.post('/bots/:id/stop', (req, res) => {
  Courier.findById(req.params.id, {include: [Routine]}).then((courier) => {
    stopBot(courier, (err) => {
      res.setHeader('Content-Type', 'application/json');
      res.send(JSON.stringify(err ? 'KO' : 'OK'));
    })
  });
});

app.get('/couriers/new', (req, res) => {
  Routine.findAll().then((routines) => {
    res.render('courier-form', {
      routines: routines,
    });
  });
});

app.post('/couriers/new', (req, res) => {
  Courier.create({
    username: req.body.username,
    password: req.body.password,
    routineId: req.body.routine,
  })
  .then((courier) => res.redirect('/'))
  .catch((err) => {
    console.log(err);
  });
});

app.post('/couriers/:id/delete', (req, res) => {
  Courier.destroy({
    where: {
      id: req.params.id
    }
  }).then(() => res.redirect('/'));
});

app.get('/routines', (req, res) => {
  Routine.findAll().then((routines) => {
    res.render('routines', {
      routines: routines,
    });
  });
});

app.get('/routines/new', (req, res) => {
  res.render('routine-form');
});

app.post('/routines/new', upload.single('file'), (req, res) => {

  Routine.create({
    name: req.body.name,
    description: req.body.description,
  })
  .then((routine) => {

    var id = routine.get('id');
    var file = req.file.buffer.toString('utf8');

    fs.writeFile('./gpx/' + id + '.gpx', file, function(err) {
      if (err) {
        res.writeHead(500);
        return res.end('Could not write file');
      }
    });
  })
  .then(() => res.redirect('/routines'));
});

server.listen(3000);