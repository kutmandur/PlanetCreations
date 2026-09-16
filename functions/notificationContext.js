const {AsyncLocalStorage} = require('node:async_hooks');
const notificationContext = new AsyncLocalStorage();
module.exports = {notificationContext};
