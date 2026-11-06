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
