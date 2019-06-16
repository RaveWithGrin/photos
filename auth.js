var config = require('./config');

var GoogleOAuthStrategy = require('passport-google-oauth20').Strategy;

module.exports = function(passport) {
    passport.serializeUser(function(user, done) {
        done(null, user);
    });
    passport.deserializeUser(function(user, done) {
        done(null, user);
    });
    passport.use(
        new GoogleOAuthStrategy(
            {
                clientID: config.oAuthClientID,
                clientSecret: config.oAuthclientSecret,
                callbackURL: config.oAuthCallbackUrl,
                userProfileURL: 'https://www.googleapis.com/oauth2/v3/userinfo'
            },
            function(token, refreshToken, profile, done) {
                done(null, {
                    profile,
                    token
                });
            }
        )
    );
};
