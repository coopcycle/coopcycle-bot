var baseURL = process.env.NODE_ENV === 'production' ? "https://coopcycle.org" : "http://coopcycle.dev";
var CONFIG = require('../config.json');

var stripe = require("stripe")(CONFIG.STRIPE_SECRET_KEY);
var API = require('./API');
var _ = require('underscore');

function Customer(model) {
  this.model = model;
}

Customer.prototype.createRandomOrder = function(cb) {

  var credentials = {
    token: this.model.token,
    refreshToken: this.model.refreshToken
  }
  var client = API.createClient(baseURL, this.model);

  client.request('GET', '/api/me')
    .then((data) => {

      var deliveryAddress = _.first(_.shuffle(data.deliveryAddresses));
      var uri = '/api/restaurants?coordinate=' + deliveryAddress.geo.latitude
        + ',' + deliveryAddress.geo.longitude+'&distance=1500';

      return client.request('GET', uri)
        .then((data) => {

          var restaurants = data['hydra:member'];
          var restaurant = _.first(_.shuffle(restaurants));

          var numberOfProducts = _.random(1, 5);
          var products = [];
          if (restaurant.products.length > 0) {
            while (products.length < numberOfProducts) {
              products.push(_.first(_.shuffle(restaurant.products)));
            }
          }

          var cart = {
            restaurant: restaurant['@id'],
            deliveryAddress: '/api/delivery_addresses/' + deliveryAddress.id,
            orderedItem: []
          }
          var groupedItems = _.countBy(products, (product) => product['@id']);
          cart.orderedItem = _.map(groupedItems, (quantity, product) => {
            return {
              quantity: quantity,
              product: product
            }
          });

          return client.request('POST', '/api/orders', cart);
        })
        .then((order) => {
          console.log('Order created!');
          return new Promise((resolve, reject) => {
            stripe.tokens.create({
              card: {
                "number": '4242424242424242',
                "exp_month": 12,
                "exp_year": 2018,
                "cvc": '123'
              }
            }, function(err, token) {
              if (err) throw err;
              resolve({order: order, token: token});
            });
          });
        })
        .then((args) => {
          console.log('Cart token created!', args.token.id);
          return client.request('PUT', args.order['@id'] + '/pay', {
            stripeToken: args.token.id
          });
        })
        .then((order) => {
          console.log('Order paid!');
          cb(order)
        });
    });
}

module.exports = Customer;