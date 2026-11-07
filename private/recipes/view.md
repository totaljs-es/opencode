---
title: Views: render a page with data
keywords: view, views, template, html, render, page, vista, vistas, plantilla
strong: view, views, vista, vistas
---
A view is an HTML file in `views/`; the route renders it with `$.view(name, model)`.

```js
// controllers/default.js
exports.install = function() {
	ROUTE('GET /', index);
};

function index($) {
	$.view('index', { title: 'Hello', items: ['a', 'b'] });
}
```

```html
<!-- views/index.html -->
<h1>@{model.title}</h1>
<ul>
@{foreach item in model.items}
	<li>@{item}</li>
@{end}
</ul>
```

Do not use `res.render`, `ejs` or `pug`.
