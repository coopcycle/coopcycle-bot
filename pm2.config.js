var argv = require('minimist')(process.argv.slice(2));

var env = argv.env || 'development';

module.exports = {
  apps: [{
    "name" : "coopcycle-bot",
    "script" : "./index.js",
    "watch": env === 'development' ? ["./index.js", "./src/*.js"] : false,
    "env_production" : {
      "NODE_ENV": "production"
    }
  }]
}