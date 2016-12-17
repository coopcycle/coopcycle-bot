var Sequelize = require('sequelize');

module.exports = function(sequelize) {

  var Db = {}

  Db.Courier = sequelize.define('courier', {
    id: {
      type: Sequelize.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    username: Sequelize.STRING,
    password: Sequelize.STRING,
    token: Sequelize.STRING,
    refreshToken: Sequelize.STRING,
    lastPosition: Sequelize.STRING,
  }, {
    getterMethods: {
      lastPosition : function() {
        var lastPosition = this.getDataValue('lastPosition');
        if (lastPosition) {
          return JSON.parse(lastPosition);
        }
      }
    },
  });

  Db.Routine = sequelize.define('routine', {
    id: {
      type: Sequelize.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    name: Sequelize.STRING,
    description: Sequelize.TEXT,
  });

  Db.Courier.belongsTo(Db.Routine);

  return Db;
}