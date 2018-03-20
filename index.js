var pm2 = require('pm2');
var _ = require('lodash');
var expressNunjucks = require('express-nunjucks');
var bodyParser = require('body-parser');
var fs = require('fs');
var express = require('express');
var Promise = require('promise');

const CONFIG = require('./config.json');

require('./src/fetch-polyfill')
const Client = require('./src/Client')
const client = new Client(CONFIG.COOPCYCLE_BASE_URL)

var assetsBaseURL = process.env.NODE_ENV === 'production' ? '/' : 'http://localhost:9091/';

var multer = require('multer');
var storage = multer.memoryStorage();
var upload = multer({ storage: storage });

var User = require('./src/User');
var PM2Utils = require('./src/PM2Utils');

const stripe = require("stripe")(CONFIG.STRIPE_SECRET_KEY);

console.log('   _____                   _____           _      ')
console.log('  / ____|                 / ____|         | |     ')
console.log(' | |     ___   ___  _ __ | |    _   _  ___| | ___ ')
console.log(" | |    / _ \\ / _ \\| '_ \\| |   | | | |/ __| |/ _ \\")
console.log(' | |___| (_) | (_) | |_) | |___| |_| | (__| |  __/')
console.log('  \\_____\\___/ \\___/| .__/ \\_____\\__, |\\___|_|\\___|')
console.log('                   | |           __/ |            ')
console.log('                   |_|          |___/             ')
console.log('                                                  ')
console.log('Target: ' + CONFIG.COOPCYCLE_BASE_URL);
console.log('---')

/* Configure SQLite */

var Sequelize = require('sequelize');

var sequelize = new Sequelize('database', 'username', 'password', {
  host: 'localhost',
  dialect: 'sqlite',
  storage: './data/db.sqlite'
});

var Db = require('./src/Db')(sequelize);

Db.Routine.sync({ alter: true });
Db.Courier.sync({ alter: true });


/* Configure Passport */

var ensureLoggedIn = require('connect-ensure-login').ensureLoggedIn;

var passport = require('passport')
  , LocalStrategy = require('passport-local').Strategy;

passport.serializeUser(function(user, done) {
  done(null, JSON.stringify(user));
});

passport.deserializeUser(function(serialized, done) {
  done(null, JSON.parse(serialized));
});

passport.use(new LocalStrategy(
  function(username, password, done) {
    client.login(username, password)
      .then((user) => {
        Db.Courier.findOne({
          where: {username: user.username}
        })
        .then((courier) => {
          if (courier) {
            console.log('Updating credentials in DB...');
            courier.set('token', user.token);
            courier.set('refreshToken', user.refresh_token);

            return courier.save();
          }
        })
        .then(() => {
          done(null, user);
        });
      })
      .catch((err) => {
        console.log(err);
        done(null, false, { message: 'Invalid credentials.' });
      });
  }
));

/* Configure Express */

var app = express();

app.set('view engine', 'njk');
var njk = expressNunjucks(app, {
    watch: true,
    noCache: true
});

app.use(express.static('web'));
app.use(require('cookie-parser')());
app.use(bodyParser.json()); // support json encoded bodies
app.use(bodyParser.urlencoded({ extended: true })); // support encoded bodies

var session = require('express-session');
var FileStore = require('session-file-store')(session);
app.use(session({
  store: new FileStore({
    path: './data',
  }),
  secret: 'coopcycle-bot',
  resave: true,
  saveUninitialized: true
}));

app.use(require('connect-flash')());

app.use(passport.initialize());
app.use(passport.session());

function hasRole(req, role) {
  return req.isAuthenticated() ? _.includes(req.user.roles, role) : false;
}

app.use(function(req, res, next) {
  res.locals.user = new User(req.isAuthenticated() ? req.user : null);
  res.locals.hasRole = function(role) {
    return hasRole(req, role);
  }
  res.locals.assetURL = function(uri) {
    return assetsBaseURL + uri;
  }
  res.locals.isProduction = function() {
    return process.env.NODE_ENV === 'production';
  }
  next();
});

var server = require('http').Server(app);
var io = require('socket.io')(server);

function refreshApps() {
  pm2.connect(function(err) {
    if (err) throw err;
    pm2.list(function(err, apps) {
      if (err) throw err;

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

      io.sockets.emit('apps', apps);

      setTimeout(refreshApps, 2000);
    });
  });
}

var atLeastOne = false;
io.on('connection', function (socket) {
  if (!atLeastOne) {
    refreshApps();
    atLeastOne = true;
  }
});

app.get('/', (req, res) => {

  var promises = [];
  promises.push(Db.Courier.findAll({
    include: [Db.Routine],
    attributes: ['id', 'username', 'speedFactor']
  }));
  promises.push(new Promise((resolve, reject) => {
    if (!req.isAuthenticated()) {
      return resolve(null);
    }
    Db.Courier.findOne({
      where: {
        username: req.user.username
      }
    }).then((courier) => resolve(courier));
  }));

  Promise.all(promises).then((values) => {
    var couriers = values[0];
    var courier = values[1];

    res.render('index', {
      couriers: couriers,
      isConfigured: (courier && courier.routineId),
    });
  });

});

app.get('/login', (req, res) => {
  var errors = req.flash('error');
  var errorMessage;
  if (errors) {
    errorMessage = errors[0];
  }
  res.render('login', {
    errorMessage: errorMessage
  });
});

app.post('/login', passport.authenticate('local', { successRedirect: '/', failureRedirect: '/login', failureFlash: true }));

app.get('/logout', function(req, res){
  req.logout();
  res.redirect('/');
});

app.get('/settings', ensureLoggedIn(), (req, res) => {

  if (hasRole(req, 'ROLE_COURIER')) {
    Db.Routine.findAll().then((routines) => {
      Db.Courier.findOne({
        where: {username: req.user.username}
      }).then((courier) => {
        res.render('settings', {
          settings: {
            routineId: courier ? courier.routineId : null,
            speedFactor: courier ? courier.speedFactor : 1
          },
          routines: routines,
          messages: req.flash(),
          speedFactors: [ 0.5, 1, 2 ]
        });
      });
    });
  }

});

app.post('/settings', ensureLoggedIn(), (req, res) => {
  if (hasRole(req, 'ROLE_COURIER')) {
    if (req.body.routine) {
      Db.Courier.findOne({
        where: {username: req.user.username}
      })
      .then((courier) => {
        if (courier) {
          courier.set('routineId', req.body.routine);
          courier.set('speedFactor', req.body.speed_factor);
          return courier.save();
        }

        return Db.Courier.create({
          username: req.user.username,
          token: req.user.token,
          refreshToken: req.user.refresh_token,
          routineId: req.body.routine,
          speedFactor: req.body.speed_factor
        });

        })
        .then((courier) => {
          req.flash('info', 'Settings saved');
          res.redirect('/settings');
        })
        .catch((err) => {
          console.log(err);
        });
    } else {
      req.flash('error', 'No routine selected');
      res.redirect('/settings');
    }
  }
});

app.post('/bots/:id/start', ensureLoggedIn(), (req, res) => {
  Db.Courier.findById(req.params.id, {include: [Db.Routine]}).then((courier) => {
    PM2Utils.startBot(courier, (err) => {
      res.setHeader('Content-Type', 'application/json');
      res.send(JSON.stringify(err ? 'KO' : 'OK'));
    })
  });
});

app.post('/bots/:id/stop', ensureLoggedIn(), (req, res) => {
  Db.Courier.findById(req.params.id, {include: [Db.Routine]}).then((courier) => {
    PM2Utils.stopBot(courier, (err) => {
      res.setHeader('Content-Type', 'application/json');
      res.send(JSON.stringify(err ? 'KO' : 'OK'));
    })
  });
});

app.get('/couriers/new', ensureLoggedIn(), (req, res) => {
  Db.Routine.findAll().then((routines) => {
    res.render('courier-form', {
      routines: routines,
    });
  });
});

app.post('/couriers/new', ensureLoggedIn(), (req, res) => {
  Db.Courier.create({
    username: req.body.username,
    password: req.body.password,
    routineId: req.body.routine,
  })
  .then((courier) => res.redirect('/'))
  .catch((err) => {
    console.log(err);
  });
});

app.post('/couriers/:id/delete', ensureLoggedIn(), (req, res) => {
  Db.Courier.destroy({
    where: {
      id: req.params.id
    }
  }).then(() => res.redirect('/'));
});

app.get('/routines', (req, res) => {
  Db.Routine.findAll().then((routines) => {
    res.render('routines', {
      routines: routines,
    });
  });
});

app.get('/routines/new', ensureLoggedIn(), (req, res) => {
  res.render('routine-form');
});

app.post('/routines/new', [ensureLoggedIn(), upload.single('file')], (req, res) => {

  Db.Routine.create({
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

server.listen(3001);