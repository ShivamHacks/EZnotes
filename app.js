var express = require('express');
var path = require('path');
var favicon = require('serve-favicon');

var app = express();

// server
var server = require('http').Server(app);
var port = normalizePort(process.env.PORT || '3000');
app.set('port', port);
server.listen(port, function(){
  console.log('listening on: ' + this.address().port);
});

// bodyparser
var bodyParser = require('body-parser'); // needs to go before router
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
var multipart = require('connect-multiparty');
var multipartMiddleware = multipart();
var router = express.Router();
app.use(router);
app.use(express.static(path.join(__dirname, 'public')));
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'hjs');
var shortid = require('shortid');
var request = require('request');
var AWS = require('aws-sdk');
AWS.config.loadFromPath('./config.json');
var dynamodb = new AWS.DynamoDB();

var paramsTemp = function(key, email) {
  return {
    Item: {
      email: { S: email },
      id: { S: shortid.generate() },
      key: { S: key }
    },
    TableName: 'EZnotes'
  };
};

// sockets
var io = require('socket.io')(server);
var userIDs = [];
var allClients = [];
var emails = [];
var url = 'https://en.wikipedia.org/w/api.php?format=json&action=query&prop=extracts&exintro=&explaintext=&titles=key';

io.on('connection', function (socket) {


  allClients.push(socket);
  userIDs.push(socket.id);
  console.log('user connect ' + socket.id);
  socket.emit('initial-connection', {
    myID: socket.id
  });
  socket.on('disconnect',function() { 
    var disconnectedIndex = allClients.indexOf(socket);
    console.log('user disconnect ' + userIDs[disconnectedIndex]);
    userIDs.splice(disconnectedIndex, 1);
    allClients.splice(disconnectedIndex, 1);
    emails.splice(disconnectedIndex, 1);
  });


// When user loads page, send current notes
socket.on('get-data', function (data) {
  var email = data.email;
  emails.push(email);
  var paramsFind = {
    KeyConditions: {
      email: {
        ComparisonOperator: 'EQ',
        AttributeValueList: [
        {
          S: email
        }
        ]
      }
    },
    TableName: 'EZnotes',
    AttributesToGet: [
    'key'
    ]
  }
  dynamodb.query(paramsFind, function(err, data) {
    if (err) {
      console.log(err, err.stack);
    } else {
      if (data != null) {
        for (var i in data.Items) {
          var loc = url.replace('key', data.Items[i].key.S.replace(/ /g,"_"));
          request({
            url: loc,
            json: true
          }, function (error, response, body) {
            var key;
            var value;
            if (!error && response.statusCode == 200) {
              for (var j in body.query.pages) {
                key = body.query.pages[j].title;
                value = body.query.pages[j].extract;
              }
              if (value == null) {
                value = 'nothing found...';
              }
            } else {
              value = 'error';
            }
            socket.emit("data-send", {
              key: key,
              value: value
            });
          });
        }
      }
    }
  });
});


// When user submits text to save data
socket.on('sendsave', function (data) {
  var key = data.key;
  console.log(key);
  var loc = url.replace('key', key.replace(/ /g,"_"));
  request({
    url: loc,
    json: true
  }, function (error, response, body) {
    var value;
    if (!error && response.statusCode == 200) {
      // need to fix issue, if body.query.pages DNE
      for (var i in body.query.pages) {
        value = body.query.pages[i].extract;
      }
      if (value == null) {
        value = 'nothing found...';
      }
    } else {
      value = 'error';
    }
    var email = emails[allClients.indexOf(socket)];
    console.log(allClients.indexOf(socket));
    var params = paramsTemp(key, email);
    dynamodb.putItem(params, function(err, data) {
      if (err) {
        console.log(err, err.stack);
        socket.emit("instant-send", {
          data: {
            key: key,
            value: 'error'
          }
        });
      } else {
        socket.emit("instant-send", {
          data: {
            key: key,
            value: value
          }
        });
      }
    });
  });
});


});



/* Routing */
router.get('/', function(req, res, next) {
  res.render('index', {});
});

router.get('/newuser', function(req, res, next) {
  res.render('login', {});
});

router.get('/login', function(req, res, next) {
  res.render('login', {});
});
// REGISTRATION START

// node mailer setup
var nodemailer = require("nodemailer");
var smtpTransport = nodemailer.createTransport("SMTP", {
  service: "Gmail",
  auth: {
    user: "helloworldtestingemail@gmail.com",
    pass: "helloauth5647"
  }
});

// users
router.post('/newuser', multipartMiddleware, function (req, res) {
  console.log(req.body);
  var email = req.body.email;
  var pswrd = req.body.pswrd;
  var token = shortid.generate();

  console.log(email);

  smtpTransport.sendMail({
    from: "Hello <helloworldtestingemail@gmail.com>",
    to: email,
    subject: "Confirm your account",
    html: "<p>Confirm your account <a href='https://eznotes.herokuapp.com/authentication?email=" + email + "&token=" + token + "'>here</a></p>"
  }, function(error, response){
    if(error){
      console.log(error);
    } else{
      var paramsSave = {
        Item: {
          email: { S: email },
          pswrd: { S: pswrd },
          confm: { BOOL: false },
          token: { S: token}
        },
        TableName: 'EZnotes_users'
      }
      dynamodb.putItem(paramsSave, function(err, data) {
        if (err) {
          console.log(err, err.stack);
        } else {
          console.log('success');
        }
      });
    }
  });

  res.render('checkemail', {});
});

router.post('/login', multipartMiddleware, function (req, res) {
  console.log(req.body);
  console.log('login');
  var email = req.body.email;
  var pswrd = req.body.pswrd;

  var paramsFind = {
    KeyConditions: {
      email: {
        ComparisonOperator: 'EQ',
        AttributeValueList: [
        {
          S: email
        }
        ]
      }
    },
    TableName: 'EZnotes_users',
    AttributesToGet: [
    'email'
    ]
  }

  dynamodb.query(paramsFind, function(err, data) {
    if (err) {
      console.log(err, err.stack);
      res.send('error');
    } else {
      res.render('confirm', {
        email: email
      });
    }
  });
});

router.get('/authentication', function (req, res, next) {
  // confirm email here

  var email = req.query.email;
  var token = req.query.token;

  var paramsFind = {
    KeyConditions: {
      email: {
        ComparisonOperator: 'EQ',
        AttributeValueList: [
        {
          S: email
        }
        ]
      }
    },
    TableName: 'EZnotes_users',
    AttributesToGet: [
    'email',
    'token'
    ]
  }

  dynamodb.query(paramsFind, function(err, data) {
    if (err) {
      console.log(err, err.stack);
    } else {
      if (data.Items[0].token.S == token) {
        var paramsUpdate = {
          Key: {
            email: {
              S: data.Items[0].email.S
            }
          },
          TableName: 'EZnotes_users',
          AttributeUpdates: {
            confm: {
              Action: 'PUT',
              Value: {
                BOOL: true
              }
            }
          }
        }
        dynamodb.updateItem(paramsUpdate, function(err, data) {
          if (err) {
            console.log(err, err.stack);
          } else {
            console.log('confirmed');
          }
        });
      }
    }
  });

  res.render('confirm', {
    email: email
  });
});

// REGISTRATION END


// catch 404 and forward to error handler
app.use(function(req, res, next) {
  var err = new Error('Not Found');
  err.status = 404;
  next(err);
});

// error handlers

// development error handler
// will print stacktrace
if (app.get('env') === 'development') {
  app.use(function(err, req, res, next) {
    res.status(err.status || 500);
    res.render('error', {
      message: err.message,
      error: err
    });
  });
}

// production error handler
// no stacktraces leaked to user
app.use(function(err, req, res, next) {
  res.status(err.status || 500);
  res.render('error', {
    message: err.message,
    error: {}
  });
});

function normalizePort(val) {
  var port = parseInt(val, 10);
  if (isNaN(port)) { return val; }
  if (port >= 0) { return port; }
  return false;
}

module.exports = app;
