---
title: Ids and dates: UID(), NOW
keywords: id, ids, identifier, unique, date, dates, creation, created, timestamp, uuid, guid, generate, fecha, identificador
strong: uid, now, guid, dtcreated
---
`UID()` makes a unique id and `NOW` is the current date. A new record has both:

```js
var item = {};
item.id = UID();
item.name = 'Peter';
item.dtcreated = NOW;
```

Do not use `uuid`, `Date.now()` or `new Date()` for this. The names of the date fields start with `dt` (`dtcreated`, `dtupdated`).
