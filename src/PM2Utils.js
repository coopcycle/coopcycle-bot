var pm2 = require('pm2');

var watchOptions = process.env.NODE_ENV === 'production' ? false : ['bot.js', './src/*.js'];

function startBot(courier, cb) {
  console.log('Starting bot ' + courier.username);

  var filename = 'gpx/' + courier.routine.id + '.gpx';

  var args = [
    courier.username,
    courier.password,
    filename
  ];

  pm2.connect(function(err) {
    if (err) return cb(err);

    pm2.start({
      name: 'coopcycle-bot-' + courier.username,
      script: 'bot.js',
      watch: watchOptions,
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

module.exports = {
  startBot: startBot,
  stopBot: stopBot
}

