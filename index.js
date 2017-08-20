var pm2 = require('pm2');
var _ = require('underscore');
var expressNunjucks = require('express-nunjucks');
var bodyParser = require('body-parser');
var fs = require('fs');
var express = require('express');
var Promise = require('promise');
var schedule = require('node-schedule');

const CONFIG = require('./config.json');

require('./src/fetch-polyfill')
const CoopCycle = require('coopcycle-js')
const client = new CoopCycle.Client(CONFIG.COOPCYCLE_BASE_URL)

var assetsBaseURL = process.env.NODE_ENV === 'production' ? '/' : 'http://localhost:9091/';

var multer = require('multer');
var storage = multer.memoryStorage();
var upload = multer({ storage: storage });

var User = require('./src/User');
var Customer = require('./src/Customer');
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

Db.Courier.sync();
Db.Customer.sync();
Db.Routine.sync();

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

        Db.Customer.findOne({
          where: {username: user.username}
        })
        .then((customer) => {
          if (customer) {
            console.log('Updating credentials in DB...');
            customer.set('token', user.token);
            customer.set('refreshToken', user.refresh_token);

            return customer.save();
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
  return req.isAuthenticated() ? _.contains(req.user.roles, role) : false;
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

var FREQUENCIES = {
  '*/2 * * * *': 'Every 2 minutes',
  '*/5 * * * *': 'Every 5 minutes',
  '*/10 * * * *': 'Every 10 minutes',
  '*/30 * * * *': 'Every 30 minutes',
}

function runCustomerBots(frequency) {
  console.log('Cron job running ' + frequency);
  Db.Customer.findAll({
    where: {
      frequency: frequency,
    }
  }).then((customers) => {
    customers.forEach((model) => {
      var customer = new Customer(model);
      customer.createRandomOrder()
        .then((order) => {
          io.sockets.emit('order', order);
        })
        .catch((err) => {
          console.log('Could not create order', err);
        })
    });
  })
}

_.keys(FREQUENCIES).forEach((frequency) => {
  console.log('Scheduling function for frequency ' + frequency)
  schedule.scheduleJob(frequency, () => runCustomerBots(frequency));
})

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
    attributes: ['id', 'username']
  }));
  promises.push(Db.Customer.findAll({
    attributes: ['id', 'username', 'frequency']
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
  promises.push(new Promise((resolve, reject) => {
    if (!req.isAuthenticated()) {
      return resolve(null);
    }
    Db.Customer.findOne({
      where: {
        username: req.user.username
      }
    }).then((customer) => resolve(customer));
  }));

  Promise.all(promises).then((values) => {
    var couriers = values[0];
    var customers = values[1];
    var courier = values[2];
    var customer = values[3];

    res.render('index', {
      couriers: couriers,
      customers: customers,
      isConfigured: (courier && courier.routineId) || (customer && customer.frequency),
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
            routineId: courier ? courier.routineId : null
          },
          routines: routines,
          messages: req.flash()
        });
      });
    });
  }

  if (!hasRole(req, 'ROLE_COURIER')) {
    Db.Customer.findOne({
        where: {username: req.user.username}
      }).then((customer) => {
        res.render('settings', {
          settings: {
            frequency: customer ? customer.frequency : null
          },
          frequencies: FREQUENCIES,
          messages: req.flash()
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
          return courier.save();
        }

        return Db.Courier.create({
          username: req.user.username,
          token: req.user.token,
          refreshToken: req.user.refresh_token,
          routineId: req.body.routine,
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

  if (!hasRole(req, 'ROLE_COURIER')) {
    if (req.body.frequency) {
      Db.Customer.findOne({
        where: {username: req.user.username}
      })
      .then((customer) => {
        if (customer) {
          customer.set('frequency', req.body.frequency);
          return customer.save();
        }

        return Db.Customer.create({
          username: req.user.username,
          token: req.user.token,
          refreshToken: req.user.refresh_token,
          frequency: req.body.frequency,
        });

        })
        .then((customer) => {
          req.flash('info', 'Settings saved');
          res.redirect('/settings');
        })
        .catch((err) => {
          console.log(err);
        });
    } else {
      req.flash('error', 'No frequency selected');
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

app.post('/customers/:id/delete', ensureLoggedIn(), (req, res) => {
  if (hasRole(req, 'ROLE_ADMIN')) {
    Db.Customer.destroy({
      where: {
        id: req.params.id
      }
    }).then(() => res.redirect('/'));
  }
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

server.listen(3000);