// Resolves a path inside the root of a project. Returns null when it leaves the root
// (a relative path with .., an absolute path, or a symbolic link that points outside).
FUNC.resolve = function(root, path) {

	var base = Total.Path.resolve(root);
	var target = Total.Path.resolve(base, path || '.');

	if (target !== base && target.indexOf(base + Total.Path.sep) !== 0)
		return null;

	var existing = target;
	while (!Total.Fs.existsSync(existing)) {
		var parent = Total.Path.dirname(existing);
		if (parent === existing)
			break;
		existing = parent;
	}

	var real = Total.Fs.realpathSync(existing);
	var realbase = Total.Fs.realpathSync(base);

	if (real !== realbase && real.indexOf(realbase + Total.Path.sep) !== 0)
		return null;

	return target;
};

// Sends an event to the clients subscribed to the session
FUNC.emit = function(sessionid, type, data) {
	if (MAIN.ws) {
		var message = { type: type, sessionid: sessionid, ts: Date.now(), data: data };
		MAIN.ws.send(message, function(client) {
			return client.sessions && client.sessions[sessionid] === true;
		});
	}
	if (FUNC.onevent)
		FUNC.onevent(sessionid, type, data);
};

// Strictly increasing timestamps: two messages of the same millisecond keep their order
var laststamp = 0;

FUNC.stamp = function() {
	var time = Date.now();
	if (time <= laststamp)
		time = laststamp + 1;
	laststamp = time;
	return new Date(time);
};

// Text for the model or the log: the translation markers @(Text) are removed
FUNC.plain = function(text) {
	return typeof(text) === 'string' ? text.replace(/@\(([^)]*)\)/g, '$1') : text;
};

// A title for a session from the first thing the user says: one line, no markup, short
FUNC.title = function(text) {
	var line = (text || '').split('\n')[0].replace(/[`*_#>\[\]]+/g, ' ').replace(/\s+/g, ' ').trim();
	return line.length > 48 ? (line.substring(0, 47).trim() + '…') : line;
};

// Shortens a text to the maximum output of a tool and says so
FUNC.truncate = function(text, max) {
	max = max || CONF.maxoutput;
	if (text.length <= max)
		return text;
	return text.substring(0, max) + '\n[truncated: {0} more characters]'.format(text.length - max);
};

FUNC.encryptkey = function(value) {
	return value ? value.encrypt(CONF.secret) : '';
};

FUNC.decryptkey = function(value) {
	return value ? (value.decrypt(CONF.secret) || '') : '';
};

// Converts a glob pattern (* and **) into a regular expression
FUNC.glob = function(pattern) {
	var value = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\//g, '\u0001').replace(/\*\*/g, '\u0002').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0001/g, '(.*/)?').replace(/\u0002/g, '.*');
	return new RegExp('^' + value + '$');
};

// Secrets that must never reach the model, the interface or the stored output: provider keys, the access token and the application secret
MAIN.secrets = [];

FUNC.scrub = function(text) {

	if (!text || typeof(text) !== 'string')
		return text;

	var list = MAIN.secrets.slice();

	if (CONF.token)
		list.push(CONF.token);

	if (CONF.secret)
		list.push(CONF.secret);

	for (var secret of list) {
		if (secret && secret.length >= 8 && text.indexOf(secret) !== -1)
			text = text.split(secret).join('[secret]');
	}

	// Common key formats
	return text.replace(/\b(sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{30,}|AKIA[0-9A-Z]{16})\b/g, '[secret]');
};
