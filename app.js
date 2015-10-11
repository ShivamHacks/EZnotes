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

var paramsTemp = function(data) {
  return {
    Item: {
      email: { S: data.email },
      id: { S: shortid.generate() },
      key: { S: data.key },
      value: { S: data.value }
    },
    TableName: 'EZnotes'
  };
}

// sockets
var io = require('socket.io')(server);
var userIDs = [];
var allClients = [];
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
  });

  socket.on('get-data', function (data) {
    var email = data.email;
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
      'key',
      'value'
      ]
    }
    dynamodb.query(paramsFind, function(err, data) {
      if (err) {
        console.log(err, err.stack);
      } else {
        socket.emit("data-send", {
          data: data
        });
      }
    });
  });

  socket.on('sendsave', function (data) {
    console.log(data);
    var url = 'https://en.wikipedia.org/w/api.php?format=json&action=query&prop=extracts&exintro=&explaintext=&titles=' + data.key.replace(/ /g,"_");
    var value = 'nothing found...';

    request({
      url: url,
      json: true
    }, function (error, response, body) {
      for (var key in body.query.pages) {
        value = body.query.pages[key].extract;
      }

      socket.emit("instant-send", {
        data: {
          key: data.key,
          value: value
        }
      });

      var params = paramsTemp({
        email: data.email,
        key: encodeURIComponent(data.key),
        value: value
      });

      dynamodb.putItem(params, function(err, data) {
        if (err) {
          console.log(err, err.stack);
        } else {
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






























/*var fs = require('fs');
var request = require('request');

var url = "https://en.wikipedia.org/w/api.php?action=query&format=json&list=allpages&aplimit=500&apfrom=NUM";
var current = 0;
var articles = [];
while(current < 10) {
  var offset = current * 500;
  console.log(offset);
  request({
    url: url.replace("NUM", offset),
    json: true
  }, function (error, response, body) {
    //console.log(body.query.allpages);
    if (!error && response.statusCode === 200) {
      try {
        //console.log(body.query.allpages[0]);
        for (i=0; i<body.query.allpages.length; i++) {
          //console.log(body.query.allpages[i]);
          articles.push("hi");
          //console.log(body.query.allpages[i].title);
        }
      }
      catch (e) {

      }
      finally {

      }
    }
  });
  current++;
}
console.log(articles);
fs.writeFile('./wikiTable.json', JSON.stringify(articles), 'utf8', function() {
  console.log('successful article save');
}); */








/*
var url = 'https://en.wikipedia.org/w/api.php?format=json&action=query&prop=extracts&exintro=&explaintext=&titles=George_Washington';

for (i=0; i < 10; i++) {
  request({
    url: url,
    json: true
  }, function (error, response, body) {
      //console.log(error);
      console.log(response.statusCode);
      for (var key in body.query.pages) {
        console.log(body.query.pages[key].title);
      }
    });
}

*/

/*

router.post('/save', function (req, res) {
  //console.log(req.body);
  var params;
  if (req.body.auto == 'true') {
    var url = 'https://en.wikipedia.org/w/api.php?format=json&action=query&prop=extracts&exintro=&explaintext=&titles=' + req.body.key;
    // still need to fix if pages doesn't exist

    // see more
    // get a bunch of domains
    request({
      url: url,
      json: true
    }, function (error, response, body) {
      console.log(body);
      if (!error && response.statusCode === 200) {
        var value = "nothing found...";
        try {
          for (var key in body.query.pages) {
            if (body.query.pages[key].extract != "") {
              value = body.query.pages[key].extract;
            } else {
              value = "nothing found...";
            }
          }
        }
        catch (e) {
          console.log(e);
          value = "nothing found...";
        }
        finally {
          params = paramsTemp({
            id: shortid.generate(),
            email: req.body.email,
            action: req.body.action,
            key: encodeURIComponent(req.body.key),
            value: encodeURIComponent(value)
          });
    console.log('before', req.body.userID);
    allClients[userIDs.indexOf(req.body.userID)].emit("instant-send", {
      data: {
        key: req.body.key.replace(/_/g," "),
        value: value
      }
    });

    console.log('after');
  }

} else {
  console.log(error, response.statusCode);
}

});
}
}); */

          /*
          dynamodb.putItem(params, function(err, data) {
            if (err) {
              console.log(err, err.stack);
            } else {
              console.log('sending');
              allClients[userIDs.indexOf(req.body.userID)].emit("instant-send", {
                data: {
                  key: req.body.key.replace(/_/g," "),
                  value: value
                }
              });
              console.log('sent');
            }
          }); 
*/

/*

router.post('/finish', function (req, res) {
  var params = {
    KeyConditions: {
      email: {
        ComparisonOperator: 'EQ',
        AttributeValueList: [
        {
          S: req.body.email
        }
        ]
      }
    },
    TableName: 'EZnotes',
    AttributesToGet: [
    'key',
    'value'
    ]
  }
  dynamodb.query(params, function(err, data) {
    if (err) {
      console.log(err, err.stack);
    } else {
      console.log('sending out to: ' + req.body.userID);
      allClients[userIDs.indexOf(req.body.userID)].emit("sending-notes", {
        data: data
      });
      console.log('sent');
    }
  });
});

*/












//var cookieParser = require('cookie-parser');
//app.use(cookieParser());

//var multipart = require('connect-multiparty');
//var multipartMiddleware = multipart();


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
