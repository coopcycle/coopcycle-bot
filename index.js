var pm2 = require('pm2');
var _ = require('underscore');
var expressNunjucks = require('express-nunjucks');
var app = require('express')();

app.set('view engine', 'njk');
var njk = expressNunjucks(app, {
    watch: true,
    noCache: true
});

var botsConfig = require('./bots.json');
var baseURL = "http://coopcycle.dev";

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

app.get('/', (req, res) => {
  pm2.connect(function(err) {
    if (err) {
      res.writeHead(500);
      return res.end('Could not connect to PM2');
    }
    pm2.list(function(err, apps) {
      pm2.disconnect();
      apps = _.filter(apps, function(app) {
        return app.name.startsWith('coopcycle-bot');
      })
      res.render('index', {
        apps: apps
      });
    });
  });
});

app.listen(3000);