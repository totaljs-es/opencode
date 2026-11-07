---
title: A route that answers with text, JSON or a view
keywords: route, routes, ruta, rutas, endpoint, url, get, post, put, delete, plain, text, json, respond, answer, controller, controllers, controlador, params, query, redirect
strong: route, routes, ruta, rutas, controller, controllers, controlador
---
A route is `ROUTE('METHOD /url', function($) { ... })` inside `exports.install` of a file of `controllers/`. Nothing else is needed: no UI library, no framework.

```js
// controllers/default.js
exports.install = function() {
	ROUTE('GET /hello', hello);
	ROUTE('GET /users/{id}', user);
	ROUTE('POST /ping', ping);
};

function hello($) {
	$.plain('Hello');
}

function user($) {
	$.json({ id: $.params.id, search: $.query.search });
}

function ping($) {
	$.json({ ok: true, received: $.body });
}
```

`$.plain(text)`, `$.json(object)`, `$.html(text)`, `$.view('name', model)`, `$.redirect('/url')`, `$.fallback(404)`. Parameters of the url are `{id}` and are read from `$.params.id`; `$.query` is the query string and `$.body` the body (JSON is parsed).
