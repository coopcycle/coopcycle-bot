var Promise = require('promise');
var _ = require('underscore');

const CONFIG = require('../config.json')
const stripe = require("stripe")(CONFIG.STRIPE_SECRET_KEY)

require('./fetch-polyfill')
const CoopCycle = require('coopcycle-js')


function Customer(model) {
  this.model = model;
  this.client = new CoopCycle.Client(CONFIG.COOPCYCLE_BASE_URL, {
    token: model.token,
    refresh_token: model.refreshToken
  })
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

function getRandomMenuItem(restaurant) {
  const menuSections = restaurant.hasMenu.hasMenuSection;
  const randomSectionIndex = _.random(0, menuSections.length - 1);
  const randomSection = menuSections[randomSectionIndex];
  const randomizedItems = _.shuffle(randomSection.hasMenuItem);

  return randomizedItems[0];
}

function buildRandomOrder(client, restaurant, address) {

  if (!restaurant.hasMenu) {
    return new Promise((resolve, reject) => reject('No menu available'))
  }

  var numberOfProducts = _.random(1, 5);
  var menuItems = [];
  while (menuItems.length < numberOfProducts) {
    menuItems.push(getRandomMenuItem(restaurant));
  }

  var groupedItems = _.countBy(menuItems, menuItem => menuItem['@id']);

  var order = {
    restaurant: restaurant['@id'],
    delivery: {
      deliveryAddress: address['@id']
    },
    orderedItem: _.map(groupedItems, (quantity, menuItem) => {
      return {
        quantity: quantity,
        menuItem: menuItem
      }
    })
  }

  return client.request('POST', '/api/orders', order);
}

Customer.prototype.createRandomOrder = function() {

  var credentials = {
    token: this.model.token,
    refreshToken: this.model.refreshToken
  }

  return new Promise((resolve, reject) => {

    this.client.request('GET', '/api/me')
      .then(data => {

        if (data.addresses.length === 0) {
          return reject('Customer ' + this.model.username + ' has no adresses');
        }

        var deliveryAddress = _.first(_.shuffle(data.addresses));

        findNearbyRestaurant(this.client, deliveryAddress)
          .then((restaurant) => {
            console.log('Restaurant found!');
            return buildRandomOrder(this.client, restaurant, deliveryAddress);
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
            return this.client.request('PUT', args.order['@id'] + '/pay', {
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
      })
      .catch(err => console.log(err));

    });
}

module.exports = Customer;