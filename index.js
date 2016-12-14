var pm2 = require('pm2');
var _ = require('underscore');
var expressNunjucks = require('express-nunjucks');
var express = require('express');
var app = express();

app.set('view engine', 'njk');
var njk = expressNunjucks(app, {
    watch: true,
    noCache: true
});

var botsConfig = require('./bots.json');
var baseURL = process.env.NODE_ENV === 'production' ? "https://coopcycle.org" : "http://coopcycle.dev";

var bots = {};
botsConfig.forEach(function(botConfig) {
  bots[botConfig.username] = {
    username: botConfig.username,
    gpx: botConfig.gpx
  }
})

pm2.connect(function(err) {
  if (err) {
    console.error(err);
    process.exit(2);
  }

  console.log('Connected to PM2');

  var promises = [];
  botsConfig.forEach(function(botConfig) {
    console.log('Spawning bot "' + botConfig.username + '"');
    var promise = new Promise(function(resolve, reject) {
      pm2.start({
        name: 'coopcycle-bot-' + botConfig.username,
        script: 'bot.js',
        watch: ['bot.js', './src/*.js'],
        args: [botConfig.username, botConfig.password, botConfig.gpx, baseURL],
      }, function(err, apps) {
        err ? reject() : resolve();
      });
    });
    promises.push(promise);
  });

  Promise.all(promises).then(function(values) {
    console.log('Done, disconnect from PM2');
    pm2.disconnect();
  });
});

app.use(express.static('web'));
app.use('/gpx', express.static('gpx'));

app.get('/', (req, res) => {
  pm2.connect(function(err) {
    if (err) {
      res.writeHead(500);
      return res.end('Could not connect to PM2');
    }

    pm2.list(function(err, apps) {

      pm2.disconnect();

      apps = _.filter(apps, function(app) {
        return app.name.startsWith('coopcycle-bot-');
      });
      apps = _.map(apps, function(app) {
        var username = app.name.replace('coopcycle-bot-', '');
        return _.extend(app, {
          gpx: bots[username].gpx
        });
      });

      res.render('index', {
        apps: apps
      });
    });
  });
});

app.listen(3000);