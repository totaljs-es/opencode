---
title: Code style: ES5, tabs, short names
keywords: style, format, formatting, convention, conventions, es5, tabs, indent, var, function, loop, estilo, formato, convenciones, sum, array
strong: es5, tabs, convention, conventions, convenciones
---
The style of Total.js 5 code:

- Indent with TABS, one tab per level. Never spaces.
- ES5: `var`, `function`, classic `for` loops. No arrow functions (`=>`), no `const`, no `let`, no template literals (use `'{0}'.format(value)`).
- Semicolons. Short names: `id`, `name`, `dtcreated`.

```js
function sum(numbers) {
	var total = 0;
	for (var i = 0; i < numbers.length; i++)
		total += numbers[i];
	return total;
}

var text = 'Hello {0}'.format(name);
```

Use the prototypes of Total.js first (`findItem`, `parseJSON`, `slug`...).
