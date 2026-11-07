---
title: NoSQL: insert, find, read, modify, remove
keywords: nosql, database, db, storage, store, save, insert, find, read, modify, update, remove, delete, collection, datos, base, guardar
strong: nosql
---
`NOSQL('name')` is the embedded database. Every builder ends with `.promise($)` (or `.callback(function(err, response) { })`).

```js
var item = { id: UID(), name: 'Peter', dtcreated: NOW };

await NOSQL('users').insert(item).promise($);
var list = await NOSQL('users').find().where('name', 'Peter').sort('dtcreated_desc').take(10).promise($);
var one = await NOSQL('users').read().where('id', id).error(404).promise($);
await NOSQL('users').modify({ name: 'Paul' }).where('id', id).promise($);
await NOSQL('users').remove().where('id', id).promise($);
```

`UID()` makes an id and `NOW` is the current date. `.error(404)` answers the action with 404 when nothing is found.
