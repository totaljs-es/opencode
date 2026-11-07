---
title: Project structure, FUNC, MAIN and MODS
keywords: structure, folders, folder, project, new, create, estructura, carpetas, proyecto, func, main, mods, module, modules, modulo, helper, helpers, shared, state, definitions, index.js, package.json
strong: func, mods, definitions, structure, estructura, index.js
---
A Total.js 5 project: `index.js`, `config`, `package.json` (dependency `total5`) and the folders `controllers/` (routes), `schemas/` (actions), `definitions/` (startup code, `AUTH`), `modules/` (shared code), `plugins/`, `views/`, `public/`, `resources/`.

```js
// index.js
require('total5');
var options = {};
F.run(options);
```

```js
// definitions/func.js: a shared helper
FUNC.title = function(text) {
	return (text || '').trim().substring(0, 48);
};

// definitions/main.js: shared state
MAIN.running = {};
```

```js
// modules/mailer.js: used as MODS.mailer.send(...)
exports.id = 'mailer';

exports.send = function(email, text) {
	// ...
};
```

Shared helpers go in `FUNC`, shared state in `MAIN`, and the modules of the application are used through `MODS`, never with `require()`.
