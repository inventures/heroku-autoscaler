var url = require('url');
var querystring = require('querystring');
var https = require('https');
var _ = require('underscore');

//heroku log api call
var applicationName = 'hatchtv';
var apiKey = '427684cd6debb0218a4a8089c296205a7c0c7c63';

//count requests for the last n milliseconds
var periods = 60;
var interval = 1000;

//how many requests per server
var requestsPerServer = 750 * 60;
var minServers = 1;
var servers = 1;
var threshold = 0.2;

//attaches to the heroku logging service
function consume (data) {
    var address = url.parse('' + data);

    var buffer = '';
    var total = 0;
    var last = 0;
    var queue = [];
    var dynos = {};

    var options = {
        host: address.host,
        path: address.path
    };

    //consumes data from the heroku logging service
    var responseHandler = function (res) {
        res.on('data', function(chunk) {
            var lines = ('' + chunk).split('\n');

            lines.forEach(function(line) {
                var dyno = /(web\.[\d]+)/ig.exec(line);
                if(dyno) {
                    dyno = dyno[0];
                    if(!dynos[dyno]) dynos[dyno] = { total: 0, errors: 0 };
                    dynos[dyno].total ++;
                    if(line.indexOf('error') > -1) dynos[dyno].errors ++;

                    total++;
                }
            });
        });

        res.on('end', function() {
            console.log('END');
        });
    };

    //counts the total number of active users in the specified time period
    var counter = function () {
        var current = total - last;

        //clear console
        console.log('\033[2J');

        queue.push(current);
        if(queue.length > periods) queue = queue.slice(1);

        var sum = _.reduce(queue, function(memo, num) { return memo + num; }, 0);

        console.log(servers + ' dynos');
        console.log(current + ' reqs/s');
        console.log(sum + ' active users');
        console.log('-----------------------')

        Object.keys(dynos).forEach(function(key) {
            console.log(key + ': ' + dynos[key].total + ' / ' + dynos[key].errors);
        });

        var serversRequired = Math.max(minServers, sum / requestsPerServer);

        if(parseInt(serversRequired) > servers && serversRequired > servers * (1+threshold)) {
            servers = parseInt(serversRequired);
            console.log('increasing active servers to ' + servers);
            scale(servers);
        }

        if(parseInt(serversRequired) < servers && serversRequired < servers / (1+threshold)) {
            servers = parseInt(serversRequired);
            console.log('decreasing active servers to ' + servers);
            scale(servers);
        }        

        last = total;
    };

    var req = https.request(options, responseHandler);
    req.write('');
    req.end();

    setInterval(counter, interval);
}

//scales the number of servers automatically
function scale (servers) {
    var data = querystring.stringify({
        type: 'web',
        qty: servers
    });

    var headers = {
        Accept: "application/json",
        Authorization: new Buffer(':' + apiKey).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': data.length
    };

    var options = {
        headers: headers,
        hostname: 'api.heroku.com',
        path: '/apps/' + applicationName + '/ps/scale',
        method: 'POST'
    };

    var req = https.request(options, function (res) {
        res.on('data', function(data) {
            console.log('' + data + ' dynos running');
        });
    });

    req.write(data);
    req.end();
}

//starts up the autoscaler service
function start () {
    scale(minServers);

    var headers = {
        Accept: "application/json",
        Authorization: new Buffer(':' + apiKey).toString('base64')
    };

    var options = {
        headers: headers,
        hostname: 'api.heroku.com',
        path: '/apps/' + applicationName + '/logs?logplex=true&ps=router&tail=1&num=0',
        method: 'GET'
    };

    var req = https.request(options, function (res) {
        res.on('data', function(url) {
            consume(url);
        });
    });

    req.end();
}

//and now start the autoscaler application
start();
