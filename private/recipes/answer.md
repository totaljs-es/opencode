---
title: How an action answers
keywords: answer, respond, callback, success, invalid, error, 404, return, response, respuesta, responder, devolver
strong: callback, invalid
---
An action answers once, with one of these:

```js
$.callback(data);               // the data: an object, an array, a text
$.success();                    // { success: true }
$.success(id);                  // { success: true, value: id }
$.invalid(404);                 // the error 404
$.invalid('@(The ticket does not exist)');   // an error with a text for people
```

There is no `$.send()`, `res.json()` or `return` for the answer: call exactly one of them, then stop.
