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

app.use('/loadFromSearch', async function(req, res) {
    var authToken = req.user.token;
    logger.info('Loading images from search.');
    logger.silly('Received form data: ', req.body);

    var filters = {
        contentFilter: {},
        mediaTypeFilter: {
            mediaTypes: ['PHOTO']
        }
    };

    if (req.body.includedCategories) {
        filters.contentFilter.includedCategories = [req.body.includedCategories];
    }

    if (req.body.excludedCategories) {
        filters.contentFilter.excludedCategories = [req.body.excludedCategories];
    }

    if ((req.body.dateFilter = 'exact')) {
        filters.dateFilter = {
            dates: constructDate(req.body.exactYear, req.body.exactMonth, req.body.exactDay)
        };
    } else if (req.body.dateFilter == 'range') {
        filters.dateFilter = {
            ranges: [
                {
                    startDate: constructDate(req.body.startYear, req.body.startMonth, req.body.startDay),
                    endDate: constructDate(req.body.endYear, req.body.endMonth, req.body.endDay)
                }
            ]
        };
    }

    var parameters = {
        filters
    };

    var data = await libraryApiSearch(authToken, parameters);

    var userId = req.user.profile.id;
    returnPhotos(res, userId, data, parameters);
});

app.post('/loadFromAlbum', async function(req, res) {
    var albumId = req.body.albumId;
    var userId = req.user.profile.id;
    var authToken = req.user.token;

    logger.info('Importing album: ' + albumId);

    var parameters = {
        albumId
    };

    var data = await libraryApiSearch(authToken, parameters);

    returnPhotos(res, userId, data, parameters);
});

app.get('/getAlbums', async function(req, res) {
    logger.info('Loading albums');
    var userId = req.user.profile.id;

    var cachedAlbums = await albumCache.getItem(userId);
    if (cachedAlbums) {
        logger.verbose('Loaded albums from cache.');
        res.status(200).send(cachedAlbums);
    } else {
        logger.verbose('Loading albums from API.');
        var data = await libraryApiGetAlbums(req.user.token);
        if (data.error) {
            returnError(res, data);
            albumCache.removeItem(userId);
        } else {
            res.status(200).send(data);
            albumCache.setItemSync(userId, data);
        }
    }
});

app.get('/getQueue', async function(req, res) {
    var userId = req.user.profile.id;
    var authToken = req.user.token;

    logger.info('Loading queue.');
    var cachedPhotos = await mediaItemCache.getItem(userId);
    var stored = await storage.getItem(userId);

    if (cachedPhotos) {
        logger.verbose('Returning cached photos.');
        res.status(200).send({
            photos: cachedPhotos,
            parameters: stored.parameters
        });
    } else if (stored && stored.parameters) {
        logger.verbose('Resubmitting filter search ' + JSON.stringify(stored.parameters));
        var data = await libraryApiSearch(authToken, stored.parameters);
        returnPhotos(res, userId, data, stored.parameters);
    } else {
        logger.verbose('No cached data.');
        res.status(200).send({});
    }
});

server.listen(config.port, function() {
    console.log('App listening on port ' + config.port);
    console.log('Press Ctrl+C to quit.');
});

function renderIfAuthenticated(req, res, page) {
    if (!req.user || !req.isAuthenticated()) {
        res.redirect('/');
    } else {
        res.render(page);
    }
}

function returnPhotos(res, userId, data, searchParameter) {
    if (data.error) {
        returnError(res, data);
    } else {
        delete searchParameter.pageToken;
        delete searchParameter.pageSize;

        mediaItemCache.setItemSync(userId, data.photos);
        storage.setItemSync(userId, { parameters: searchParameter });

        res.status(200).send({
            photos: data.photos,
            parameters: searchParameter
        });
    }
}

function returnError(res, data) {
    var statusCode = data.error.code || 500;
    res.status(statusCode).send(data.error);
}

function constructDate(year, month, day) {
    var date = {};
    if (year) date.year = year;
    if (month) date.month = month;
    if (day) date.day = day;
    return date;
}
async function libraryApiSearch(authToken, parameters) {
    var photos = [];
    var nextPageToken = null;
    var error = null;

    parameters.pageSize = config.searchPageSize;

    try {
        do {
            logger.info('Submitting search with parameters: ' + JSON.stringify(parameters));
            var result = await request.post(config.apiEndpoint + '/v1/mediaItems:search', {
                headers: {
                    'Content-Type': 'application/json'
                },
                json: parameters,
                auth: {
                    bearer: authToken
                }
            });

            logger.debug(`Response: ${result}`);
            var items = result && result.mediaItems ? result.mediaItems.filter(x => x).filter(x => x.mimeType && x.mimeType.startsWith('image/')) : [];

            photos = photos.concat(items);

            parameters.pageToken = result.nextPageToken;

            logger.verbose('Found ' + items.length + ' images in this request. Total images: ' + photos.length);
        } while (photos.length < config.photosToLoad && parameters.pageToken != null);
    } catch (err) {
        error = err.error.error || { name: err.name, code: err.statusCode, message: err.message };
        logger.error(error);
    }

    logger.info('Search complete.');
    return { photos, parameters, error };
}

async function libraryApiGetAlbums(authToken) {
    var albums = [];
    var nextPageToken = null;
    var error = null;
    var parameters = { pageSize: config.albumPageSize };

    try {
        do {
            logger.verbose('Loading albums. Received so far: ' + albums.length);
            var result = await request.get(config.apiEndpoint + '/v1/albums', {
                headers: {
                    'Content-Type': 'application/json'
                },
                qs: parameters,
                json: true,
                auth: {
                    bearer: authToken
                }
            });

            logger.debug('Response: ' + result);

            if (result && result.albums) {
                logger.verbose('Number of albums received: ' + result.albums.length);
                var items = result.albums.filter(x => !!x);

                albums = albums.concat(items);
            }
            parameters.pageToken = result.nextPageToken;
        } while (parameters.pageToken != null);
    } catch (err) {
        error = err.error.error || { name: err.name, code: err.statusCode, message: err.message };
        logger.error(error);
    }

    logger.info('Albums loaded.');
    return { albums, error };
}
