NEWACTION('Account|read', {
	name: 'Current user',
	action: function($) {
		$.callback({ id: $.user.id, name: $.user.name, version: CONF.version });
	}
});


NEWACTION('Account|login', {
	name: 'Sign in with the access token',
	input: '*token:String',
	user: false,
	action: function($, model) {

		if (BLOCKED($, 10)) {
			$.invalid('@(Invalid token)');
			return;
		}

		if (!CONF.token || model.token !== CONF.token) {
			$.invalid('@(Invalid token)');
			return;
		}

		BLOCKED($, -1);
		$.cookie('totem', model.token, '1 month');
		$.success();
	}
});

NEWACTION('Account|logout', {
	name: 'Sign out',
	action: function($) {
		$.cookie('totem', '', '-1 day');
		$.success();
	}
});
