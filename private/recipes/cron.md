---
title: Scheduled work: CRON and the service event
keywords: cron, schedule, scheduled, timer, interval, every, midnight, daily, hourly, job, jobs, task, tarea, programar, diario, cada
strong: cron, schedule, scheduled
---
`CRON('minute hour day month weekday', function)` runs a function on a schedule. It is called once at the start of the application.

```js
// definitions/jobs.js
CRON('0 0 * * *', function() {
	// every day at midnight
});

CRON('*/5 * * * *', function() {
	// every five minutes
});

// every minute
ON('service', function() {
	// ...
});
```

Do not use `setInterval` or `node-cron`.
