// ===================================================
// Total.js Totem
// https://github.com/totaljs-es/totem
// ===================================================

require('total5');

const options = {};

// Total.js runs without the watcher (release mode) when `watcher` is false
options.watcher = !process.argv.includes('--release');
options.servicemode = process.argv.includes('--service') || process.argv.includes('--servicemode');

F.run(options);
