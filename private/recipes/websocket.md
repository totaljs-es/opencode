---
title: A WebSocket route
keywords: websocket, websockets, socket, sockets, realtime, real-time, chat, broadcast, live, push, tiempo
strong: websocket, websockets, socket
---
A WebSocket is a route with the method `SOCKET`. The function receives the socket; `$.send()` sends to all the clients and `client.send()` to one.

```js
// controllers/chat.js
exports.install = function() {
	ROUTE('SOCKET /chat', socket);
};

function socket($) {

	$.on('open', function(client) {
		client.send({ type: 'hello' });
	});

	$.on('message', function(client, message) {
		$.send(message);
	});
}
```

Messages are JSON objects. Do not use `socket.io` or `ws`.
