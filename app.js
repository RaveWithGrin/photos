var bodyParser = require('body-parser');
var config = require('./config');
var express = require('express');
var expressWinston = require('express-winston');
var http = require('http');
var persist = require('node-persist');
var request = require('request-promise');
var session = require('express-session');
var sessionFileStore = require('session-file-store');
var winston = require('winston');
var passport = require('passport');
var auth = require('./auth');

var app = express();
var fileStore = sessionFileStore(session);
var server = http.Server(app);
auth(passport);

app.set('view engine', 'ejs');

var mediaItemCache = persist.create({
    dir: 'persist-mediaitemcache/',
    ttl: 3300000
});
mediaItemCache.init();

var albumCache = persist.create({
    dir: 'persist-albumcache/',
    ttl: 600000
});
albumCache.init();

var storage = persist.create({
    dir: 'persist-storage/'
});
storage.init();

var sessionMiddleware = session({
    resave: true,
    saveUninitialized: true,
    store: new fileStore({}),
    secret: 'Photo Frame Sample'
});

var consoleTransport = new winston.transports.Console();
var logger = winston.createLogger({
    format: winston.format.combine(winston.format.colorize(), winston.format.simple()),
    transports: [consoleTransport]
});

if (process.env.DEBUG) {
    logger.level = 'silly';

    app.use(
        expressWinston.logger({
            transports: [consoleTransport],
            winstonInstance: logger
        })
    );
    require('request-promise').debug = true;
} else {
    logger.level = 'verbose';
}

app.use(express.static('static'));
app.use('/js', express.static(__dirname + '/node_modules/jquery/dist/'));
app.use('/fancybox', express.static(__dirname + '/node_modules/@fancyapps/fancybox/dist/'));
app.use('/mdlite', express.static(__dirname + '/node_modules/material-design-lite/dist/'));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use(sessionMiddleware);

app.use(passport.initialize());
app.use(passport.session());

app.use(function(req, res, next) {
    res.locals.name = '-';
    if (req.user && req.user.profile && req.user.profile.name) {
        res.locals.name = req.user.profile.name.givenName || req.user.profile.displayName;
    }
    res.locals.avatarUrl = '';
    if (req.user && req.user.profile && req.user.profile.photos) {
        res.locals.avatarUrl = req.user.profile.photos[0].value;
    }
    next();
});

app.get('/', function(req, res) {
    if (!req.user || !req.isAuthenticated()) {
        res.render('pages/login');
    } else {
        res.render('pages/frame');
    }
});

app.get('/logout', function(req, res) {
    req.logout();
    req.session.destroy();
    res.redirect('/');
});

app.get(
    '/auth/google',
    passport.authenticate('google', {
        scope: config.scopes,
        failureFlash: true,
        session: true
    })
);

app.get(
    '/auth/google/callback',
    passport.authenticate('google', {
        failureRedirect: '/',
        failureFlash: true,
        session: true
    }),
    function(req, res) {
        logger.info('User has logged in.');
        res.redirect('/');
    }
);

app.get('/search', function(req, res) {
    renderIfAuthenticated(req, res, 'pages/search');
});

app.get('/album', function(req, res) {
    renderIfAuthenticated(req, res, 'pages/album');
});
