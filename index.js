var pm2 = require('pm2');
var _ = require('underscore');
var expressNunjucks = require('express-nunjucks');
var bodyParser = require('body-parser');
var fs = require('fs');
var express = require('express');
var Promise = require('promise');

var baseURL = process.env.NODE_ENV === 'production' ? "https://coopcycle.org" : "http://coopcycle.dev";

var multer = require('multer');
var storage = multer.memoryStorage();
var upload = multer({ storage: storage });

var API = require('./src/API')(baseURL);
var User = require('./src/User');

var Sequelize = require('sequelize');

var sequelize = new Sequelize('database', 'username', 'password', {
  host: 'localhost',
  dialect: 'sqlite',
  storage: './data/db.sqlite'
});

var Db = require('./src/Db')(sequelize);

Db.Courier.sync();
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
    API.login(username, password)
      .then((user) => {
        done(null, user);
      })
      .catch((err) => {
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

app.use(function(req, res, next) {
  res.locals.user = new User(req.isAuthenticated() ? req.user : null);
  res.locals.hasRole = function(role) {
    return req.isAuthenticated() ? _.contains(req.user.roles, role) : false;
  }
  next();
});

var server = require('http').Server(app);
var io = require('socket.io')(server);

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
    attributes: ['id', 'username']
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
});

app.post('/settings', ensureLoggedIn(), (req, res) => {

  if (req.body.routine) {
    Db.Courier.create({
      username: req.user.username,
      token: req.user.token,
      refreshToken: req.user.refresh_token,
      routineId: req.body.routine,
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
});

app.post('/bots/:id/start', (req, res) => {
  Db.Courier.findById(req.params.id, {include: [Db.Routine]}).then((courier) => {
    startBot(courier, (err) => {
      res.setHeader('Content-Type', 'application/json');
      res.send(JSON.stringify(err ? 'KO' : 'OK'));
    })
  });
});

app.post('/bots/:id/stop', (req, res) => {
  Db.Courier.findById(req.params.id, {include: [Db.Routine]}).then((courier) => {
    stopBot(courier, (err) => {
      res.setHeader('Content-Type', 'application/json');
      res.send(JSON.stringify(err ? 'KO' : 'OK'));
    })
  });
});

app.get('/couriers/new', (req, res) => {
  Db.Routine.findAll().then((routines) => {
    res.render('courier-form', {
      routines: routines,
    });
  });
});

app.post('/couriers/new', (req, res) => {
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

app.post('/couriers/:id/delete', (req, res) => {
  Db.Courier.destroy({
    where: {
      id: req.params.id
    }
  }).then(() => res.redirect('/'));
});

app.get('/routines', ensureLoggedIn(), (req, res) => {
  Db.Routine.findAll().then((routines) => {
    res.render('routines', {
      routines: routines,
    });
  });
});

app.get('/routines/new', (req, res) => {
  res.render('routine-form');
});

app.post('/routines/new', upload.single('file'), (req, res) => {

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