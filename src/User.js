var _ = require('lodash');

function User(user) {
  this.isAuthenticated = false;
  if (user) {
    this.isAuthenticated = true;
    this.username = user.username;
    this.token = user.token;
    this.refreshToken = user.refresh_token;
    this.roles = user.roles;
  }
}

User.prototype.isAuthenticated = function() {
  return this.isAuthenticated;
}

User.prototype.hasRole = function(role) {
  return _.includes(this.roles, role);
}

module.exports = User;