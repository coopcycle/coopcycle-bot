require('isomorphic-fetch')
const FormData = require('form-data')

var doLogin = function(baseURL, username, password) {

  var formData  = new FormData();
  formData.append('_username', username);
  formData.append('_password', password);
  var request = new Request(baseURL + '/api/login_check', {
    method: 'POST',
    body: formData
  });

  return new Promise((resolve, reject) => {
    fetch(request)
      .then(function(res) {
        if (res.ok) {
          return res.json().then((json) => resolve(json));
        }

        return res.json().then((json) => reject(json.message));
      })
      .catch((err) => {
        reject(err);
      });
  });
};

var doRefreshToken = function(baseURL, refreshToken) {

  var formData  = new FormData();
  formData.append('refresh_token', refreshToken);
  var request = new Request(baseURL + '/api/token/refresh', {
    method: 'POST',
    body: formData
  });

  return new Promise((resolve, reject) => {
    fetch(request)
      .then(function(response) {
        if (response.ok) {
          return response.json().then(credentials => resolve(credentials))
        }
        return response.json().then(json => reject(json.message))
      })
      // TODO Catch
  });
};

var doFetch = function(req, resolve, reject, autoLogin) {
  // Clone Request now in case it needs to be retried
  // Once fetched, Request.body can't be copied
  const clone = req.clone()
  return fetch(req)
    .then(res => {
      if (res.ok) {
        // Always clone response to make sure Body can be read again
        // @see https://stackoverflow.com/questions/40497859/reread-a-response-body-from-javascripts-fetch
        res.clone().json().then(data => resolve(data))
      } else {
        if (res.status === 401) {
          console.log('Request is not authorized, refreshing token…')
          this.refreshToken()
            .then(token => {
              clone.headers.set('Authorization', `Bearer ${token}`)
              doFetch.apply(this, [ clone, resolve, reject ])
            })
            .catch(e => {
              console.log('Could not refresh token')
              if (autoLogin) {
                console.log('Trying auto login…');
                autoLogin(this)
                  .then(credentials => {
                    clone.headers.set('Authorization', `Bearer ${credentials.token}`)
                    doFetch.apply(this, [ clone, resolve, reject ])
                  })
                  .catch(e => reject(e))
              } else {
                reject(e)
              }

            })
        } else {
          res.json().then(data => reject(data))
        }
      }
    })
    .catch(e => reject(e))
}

class Client {

  constructor(httpBaseURL, credentials, options) {
    this.httpBaseURL = httpBaseURL;
    this.credentials = credentials;
    this.options = options || {};
  }

  getBaseURL() {
    return this.httpBaseURL
  }

  getToken() {
    return this.credentials.token
  }

  createRequest(method, uri, data, headers) {

    headers = headers || new Headers();
    headers.set('Content-Type', 'application/json');

    var options = {
      method: method,
      headers: headers,
      // credentials: 'include'
    };

    if (data) {
      options.body = JSON.stringify(data);
    }

    // TO-DO : use URL-module to build URL
    return new Request(this.httpBaseURL + uri, options);
  }

  createAuthorizedRequest(method, uri, data) {

    const headers = new Headers();
    let token = this.credentials['token'];

    headers.append('Authorization', `Bearer ${token}`);

    return this.createRequest(method, uri, data, headers);
  }

  hasCredentials() {
    return this.credentials && this.credentials.hasOwnProperty('token');
  }

  request(method, uri, data) {
    console.log(method + ' ' + uri);
    const req = this.hasCredentials() ? this.createAuthorizedRequest(method, uri, data) : this.createRequest(method, uri, data);
    return new Promise((resolve, reject) => doFetch.apply(this, [ req, resolve, reject, this.options.autoLogin ]))
  };

  get(uri, data) {
    return this.request('GET', uri, data);
  }

  post(uri, data) {
    return this.request('POST', uri, data);
  }

  put(uri, data) {
    return this.request('PUT', uri, data);
  }

  checkToken() {
    const req = this.createAuthorizedRequest('GET', '/api/token/check')
    return new Promise((resolve, reject) => {
      fetch(req)
        .then(response => {
          if (response.status === 401) {
            reject()
            return
          }
          if (response.ok) {
            resolve()
          }
        })
    })
  }

  refreshToken() {
    return new Promise((resolve, reject) => {
      doRefreshToken(this.httpBaseURL, this.credentials.refresh_token)
        .then(credentials => {

          this.credentials = credentials

          // TODO Store credentials

          return credentials
        })
        .then(credentials => resolve(credentials.token))
        .catch(e => reject(e))
    })
  }

  login(username, password) {
    return doLogin(this.httpBaseURL, username, password)
      .then((credentials) => {

        this.credentials = credentials;

        // TODO Store credentials

        return credentials;
      })
  }

}

module.exports = Client
