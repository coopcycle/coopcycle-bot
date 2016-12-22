var notify = require('bootstrap-notify');
var _ = require('underscore');

var hostname = window.location.hostname;
if (window.location.port) {
  hostname += (':' + window.location.port);
}

var socket = io.connect('//' + hostname);

$('#couriers button.start-stop').on('click', function(e) {
  var status = $(e.currentTarget).data('status');
  var id = $(this).parents('tr').data('courier-id');
  if (status === 'online') {
    $.post('/bots/' + id + '/stop')
      .then(function(response) {
        console.log(response);
      });
  }
  if (!status || status === 'stopped') {
    $.post('/bots/' + id + '/start')
      .then(function(response) {
        console.log(response);
      });
  }
});

socket.on('order', function (order) {
  console.log('New order created', order);
  $.notify('New order for restaurant ' + order.restaurant.name, {
    delay: 2000
  });
});

socket.on('apps', function (apps) {

  $.each(couriers, function(key, courier) {

    var $row = $('#couriers tr[data-courier-id="' + courier.id + '"]');

    var app = _.find(apps, function(app) {
      return app.username === courier.username;
    });

    var status = app ? app.status : null;

    $startStopBtn = $row.find('.start-stop');
    $statusEl = $row.find('.status');

    $startStopBtn.data('status', status);

    $startStopBtn
      .removeClass('btn-warning')
      .removeClass('btn-success');

    $row
      .removeClass('danger')
      .removeClass('success');

    if (status === 'online') {
      $startStopBtn.addClass('btn-warning').text('Stop bot');
      $row.removeClass('warning').addClass('success');
    }
    if (status === 'stopped') {
      $startStopBtn.addClass('btn-success').text('Start bot');
      $row.removeClass('warning').addClass('danger');
    }

    $statusEl.text(status);
  });
});