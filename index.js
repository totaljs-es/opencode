// ===================================================
// Total.js Totem
// https://github.com/totaljs-es/totem
// ===================================================

require('total5');

const options = {};

// The server listens on the local interface unless `ip` is set in the config
options.ip = '127.0.0.1';
options.release = process.argv.includes('--release');
options.servicemode = process.argv.includes('--service') || process.argv.includes('--servicemode');

F.run(options);
