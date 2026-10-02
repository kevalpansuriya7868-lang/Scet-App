const {setGlobalOptions} = require("firebase-functions");
const {onRequest} = require("firebase-functions/v2/https");

setGlobalOptions({maxInstances: 10});

const app = require("../backend/server");

exports.api = onRequest(app);