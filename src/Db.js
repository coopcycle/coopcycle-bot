var Sequelize = require('sequelize');

var listeners = [];

module.exports = function(sequelize) {

  var Courier = sequelize.define('courier', {
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

  var Customer = sequelize.define('customer', {
    id: {
      type: Sequelize.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    username: Sequelize.STRING,
    token: Sequelize.STRING,
    refreshToken: Sequelize.STRING,
    frequency: Sequelize.STRING,
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

  return {
    Courier: Courier,
    Customer: Customer,
    Routine: Routine
  };
}