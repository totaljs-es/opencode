var USER = { id: 'local', name: 'Local', sa: true, permissions: [] };

AUTH(function($) {

	// No token: the server is local (it listens on 127.0.0.1) and has one user
	if (!CONF.token) {
		$.success(USER);
		return;
	}

	if (BLOCKED($, 10)) {
		$.invalid();
		return;
	}

	var token = $.headers['x-token'] || $.cookie('totem');

	if (token && token === CONF.token) {
		BLOCKED($, -1);
		$.success(USER);
	} else
		$.invalid();
});

// MCP (POST /$mcp/, only with `$mcp : true` in the config). The default of the framework accepts everybody, so Totem decides:
// a page of a browser is refused (it sends Origin), and the caller is either a program with the access token as a Bearer token, or, when the
// server has no token, a program of this computer asking for localhost.
Total.mcp.auth = function($) {

	var headers = $.headers || {};
	var req = $.controller && $.controller.req;
	var address = (req && req.socket && req.socket.remoteAddress) || '';

	if (headers.origin) {
		$.invalid();
		return;
	}

	if (CONF.token) {

		if (BLOCKED($, 10)) {
			$.invalid();
			return;
		}

		if ($.token && $.token === CONF.token) {
			BLOCKED($, -1);
			$.success(USER);
		} else
			$.invalid();

		return;
	}

	var local = /^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(address) && /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(headers.host || '');

	if (local)
		$.success(USER);
	else
		$.invalid();
};
