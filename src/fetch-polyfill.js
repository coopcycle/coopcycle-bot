// Fix error in isomorphic-fetch
// ReferenceError: self is not defined
require('isomorphic-fetch')
if (typeof self === 'undefined') {
  var FormData = require('form-data');
  global.self = {
    FormData: FormData,
  }
}

module.exports = {}