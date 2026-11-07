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

	if (FUNC.sametoken(token, CONF.token)) {
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

		if (FUNC.sametoken($.token, CONF.token)) {
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

// Every response: nothing sniffs types, nothing frames the page (a framed Totem would be a terminal to click blindly), no referrer leaves.
// A request that changes something and comes from a page of another origin is refused, whatever the cookie says.
ON('request', function(ctrl) {

	var headers = ctrl.response.headers;
	headers['x-content-type-options'] = 'nosniff';
	headers['x-frame-options'] = 'DENY';
	headers['referrer-policy'] = 'no-referrer';
	headers['content-security-policy'] = "frame-ancestors 'none'";

	if (ctrl.method !== 'GET' && ctrl.method !== 'HEAD' && ctrl.method !== 'OPTIONS' && !FUNC.sameorigin(ctrl.headers))
		ctrl.fallback(403);
});
