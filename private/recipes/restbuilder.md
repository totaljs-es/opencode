---
title: Outgoing HTTP requests: RESTBuilder
keywords: restbuilder, http, https, request, fetch, axios, call, download, api, external, get, post, peticion, llamada
strong: restbuilder
---
`RESTBuilder` makes the outgoing requests. Do not use `axios`, `node-fetch` or `require('http')`.

```js
// in an action
var response = await RESTBuilder.GET('https://api.example.com/items').promise($);
$.callback(response);

// with a callback
RESTBuilder.POST('https://api.example.com/items', { name: 'A' }).header('x-token', CONF.token).exec(function(err, response, output) {
	// output.status is the HTTP status
});
```
