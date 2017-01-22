var fetch = require('node-fetch');
var FormData = require('form-data');
var Request = require('node-fetch').Request;
var Headers = require('node-fetch').Headers;
var Promise = require('promise');

function Client(httpBaseURL, model) {
  this.httpBaseURL = httpBaseURL;
  this.model = model;
}

Client.prototype.createAuthorizedRequest = function(method, uri, data) {
  var headers = new Headers();
  headers.append("Authorization", "Bearer " + this.model.token);
  headers.append("Content-Type", "application/json");

  var options = {
    method: method,
    headers: headers,
  }
  if (data) {
    options.body = JSON.stringify(data)
  }

  return new Request(this.httpBaseURL + uri, options);
}

Client.prototype.request = function(method, uri, data) {
  console.log(method + ' ' + uri);
  var req = this.createAuthorizedRequest(method, uri, data);
  return this.fetch(req);
}

Client.prototype.fetch = function(req) {
  return new Promise((resolve, reject) => {
    fetch(req)
      .then((response) => {
        console.log(response.status);
        if (response.ok) {
          return response.json().then((data) => resolve(data));
        }
        if (response.status === 401) {
          console.log('Request is not authorized, refreshing token...');
          return refreshToken(this.httpBaseURL, this.model.refreshToken)
            .then((credentials) => {
              console.log('Storing new credentials in DB...')
              this.model.set('token', credentials.token);
              this.model.set('refreshToken', credentials.refresh_token);

              return this.model.save();
            })
            .then((model) => {
              console.log('Model saved, retrying request');
              req.headers.set('Authorization', 'Bearer ' + model.token);

              return this.fetch(req);
            })
            .catch((err) => {
              console.log('Refresh token is not valid ' + this.model.refreshToken);
              this.model.onRefreshTokenError();
            });
        }

        response.json().then((data) => reject(data.message));
      });
  });
}

var login = function(baseURL, username, password) {

  var formData  = new FormData();
  formData.append("_username", username);
  formData.append("_password", password);
  var request = new fetch.Request(baseURL + '/api/login_check', {
    method: 'POST',
    body: formData
  });

  return new Promise((resolve, reject) => {
    fetch(request)
      .then(function(res) {
        if (res.ok) {
          return res.json().then((json) => resolve(json));
        }
        return reject(res.statusText)
      });
  });
}

var refreshToken = function(baseURL, refreshToken) {
  var formData  = new FormData();
  formData.append("refresh_token", refreshToken);
  var request = new fetch.Request(baseURL + '/api/token/refresh', {
    method: 'POST',
    body: formData
  });

  return new Promise((resolve, reject) => {
    fetch(request)
      .then(function(response) {
        if (response.ok) {
          return response.json().then((credentials) => resolve(credentials));
        }
        return response.json().then((json) => reject(json.message));
      });
  });
}

module.exports = {
  login: login,
  createClient: function(httpBaseURL, model) {
    return new Client(httpBaseURL, model);
  }
}