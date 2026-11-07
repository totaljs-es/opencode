---
title: A plugin of the interface: ui-plugin and PLUGIN
keywords: plugin, plugins, ui-plugin, tapi, exec, button, page, screen, interface, interfaz, boton, pantalla, items
strong: plugin, plugins, ui-plugin, tapi
---
A plugin is `plugins/<name>/index.js` plus `plugins/<name>/public/index.html`. The page has a `<ui-plugin>` and a `PLUGIN()`; buttons call its functions with the class `exec` and `data-exec`; the server is called with `exports.tapi()`.

```js
// plugins/items/index.js
exports.icon = 'ti ti-list';
exports.name = '@(Items)';
exports.position = 1;
```

```html
<!-- plugins/items/public/index.html -->
<ui-plugin class="CLASS">
	<button class="exec" data-exec="?/load">@(Load)</button>
	<ui-bind path="?.items" config="template" class="block">
		<script type="text/html">
			{{ foreach item in value }}
			<div>{{ item.name }}</div>
			{{ end }}
		</script>
	</ui-bind>
</ui-plugin>

<script>

	PLUGIN(function(exports) {

		exports.load = function() {
			exports.tapi('items ERROR', function(response) {
				exports.set('items', response);
			});
		};

	});

</script>
```
