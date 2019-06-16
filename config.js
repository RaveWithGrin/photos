module.exports = {
    config: {
        oAuthClientID: 'CLIENT_ID_HERE',
        oAuthclientSecret: 'CLIENT_SECRET_HERE',
        oAuthCallbackUrl: 'http://127.0.0.1:8080/auth/google/callback',
        port: 8080,
        scopes: ['https://www.googleapis.com/auth/photoslibrary.readonly', 'profile'],
        photosToLoad: 150,
        searchPageSize: 100,
        albumPageSize: 50,
        apiEndpoint: 'https://photoslibrary.googleapis.com'
    }
};
