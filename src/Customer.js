var baseURL = process.env.NODE_ENV === 'production' ? "https://coopcycle.org" : "http://coopcycle.dev";
var CONFIG = require('../config.json');

var stripe = require("stripe")(CONFIG.STRIPE_SECRET_KEY);
var API = require('./API');
var Promise = require('promise');
var _ = require('underscore');

function Customer(model) {
  this.model = model;
}

function findNearbyRestaurant(client, address) {
  var uri = '/api/restaurants?coordinate=' + [ address.geo.latitude, address.geo.longitude ] + '&distance=3000';

  return new Promise((resolve, reject) => {
    client.request('GET', uri)
      .then((data) => {
        var restaurants = data['hydra:member'];

        if (restaurants.length === 0) {
          return reject('No restaurant nearby');
        }

        var restaurant = _.first(_.shuffle(restaurants));
        resolve(restaurant);
      })
  });
}

function buildRandomOrder(client, restaurant, address) {

  var numberOfProducts = _.random(1, 5);
  var products = [];
  if (restaurant.products.length > 0) {
    while (products.length < numberOfProducts) {
      products.push(_.first(_.shuffle(restaurant.products)));
    }
  }

  var cart = {
    restaurant: restaurant['@id'],
    delivery: {
      deliveryAddress: address['@id']
    },
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
}

Customer.prototype.createRandomOrder = function() {

  var credentials = {
    token: this.model.token,
    refreshToken: this.model.refreshToken
  }
  var client = API.createClient(baseURL, this.model);

  return new Promise((resolve, reject) => {

    client.request('GET', '/api/me')
      .then((data) => {

        if (data.addresses.length === 0) {
          return reject('Customer ' + this.model.username + ' has no adresses');
        }

        var deliveryAddress = _.first(_.shuffle(data.addresses));

        findNearbyRestaurant(client, deliveryAddress)
          .then((restaurant) => {
            console.log('Restaurant found!');
            return buildRandomOrder(client, restaurant, deliveryAddress);
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
                if (err) return reject(err);
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
            resolve(order)
          })
          .catch((err) => {
            reject(err);
          })
      });

    });
}

module.exports = Customer;