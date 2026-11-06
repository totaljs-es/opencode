NEWACTION('Account|read', {
	name: 'Current user',
	action: function($) {
		$.callback({ id: $.user.id, name: $.user.name, version: CONF.version });
	}
});
