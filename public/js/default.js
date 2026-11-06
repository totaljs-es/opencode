// Totem browser helpers

// Events from the server go to the chat plugin
ON('message', function(msg) {
	if (msg && msg.type && PLUGINS.chat && PLUGINS.chat.event)
		PLUGINS.chat.event(msg);
});

// Subscriptions are lost when the socket reconnects: the chat subscribes again
ON('online', function(is) {
	if (is && PLUGINS.chat && PLUGINS.chat.online)
		PLUGINS.chat.online();
});

Thelpers.shortpath = function(path) {
	if (!path)
		return '';
	var arr = path.split('/');
	return arr.length > 3 ? ('.../' + arr.slice(-2).join('/')) : path;
};

Thelpers.json = function(value) {
	if (value == null)
		return '';
	return Thelpers.encode(typeof(value) === 'string' ? value : JSON.stringify(value, null, 2));
};

// A unified patch as lines with a class per kind of line
Thelpers.diffhtml = function(patch) {
	if (!patch)
		return '';
	return patch.split('\n').map(function(line) {
		var type = line.charAt(0) === '+' ? 'add' : (line.charAt(0) === '-' ? 'del' : (line.indexOf('@@') === 0 ? 'hunk' : ''));
		return '<span' + (type ? (' class="' + type + '"') : '') + '>' + Thelpers.encode(line || ' ') + '</span>';
	}).join('');
};
