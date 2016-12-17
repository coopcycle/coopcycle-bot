var fetch = require('node-fetch');
var FormData = require('form-data');
var Request = require('node-fetch').Request;
var Headers = require('node-fetch').Headers;
var Promise = require('promise');

function API(httpBaseURL) {
    this.httpBaseURL = httpBaseURL;
}

API.prototype.login = function(username, password) {

  var formData  = new FormData();
  formData.append("_username", username);
  formData.append("_password", password);
  var request = new fetch.Request(this.httpBaseURL + '/api/login_check', {
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

module.exports = function(httpBaseURL) {
  return new API(httpBaseURL);
};