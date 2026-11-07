// A run does not survive a restart of the server: the sessions that were running are marked as aborted
FUNC.recover = function(callback) {
	NOSQL('sessions').modify({ status: 'aborted' }).where('status', 'running').callback((err, count) => callback && callback(count));
};

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

// A server that listens on more than this computer must have an access token: returns the reason when it must not start
FUNC.listencheck = function(ip, token) {
	var local = !ip || ip === 'localhost' || ip === '::1' || /^127\./.test(ip);
	return local || token ? '' : 'The server listens on {0} and has no access token. Set `token` in the config (or listen on 127.0.0.1 with `$ip`).'.format(ip);
};

// The access token from a file (a Docker secret) when the config has none
FUNC.readtoken = function() {
	if (!CONF.token && CONF.tokenfile && Total.Fs.existsSync(CONF.tokenfile))
		CONF.token = Total.Fs.readFileSync(CONF.tokenfile, 'utf8').trim();
	return CONF.token;
};

// The project as a session sees it: the folder of its worktree when it has one, so that every tool, snapshot and shell works there
FUNC.sessionproject = function(session, project) {
	return session && session.worktree && session.worktree.path ? Object.assign({}, project, { path: session.worktree.path }) : project;
};

// The access token is compared in constant time (a digest of each side, so that the length does not leak either)
FUNC.sametoken = function(given, expected) {

	if (!given || !expected || typeof(given) !== 'string')
		return false;

	var a = Total.Crypto.createHash('sha256').update(given).digest();
	var b = Total.Crypto.createHash('sha256').update(expected).digest();
	return Total.Crypto.timingSafeEqual(a, b);
};

// A browser sends Origin on a request of a page. It is ours when its host is the host that was asked (or the one that a reverse proxy forwards).
FUNC.sameorigin = function(headers) {

	if (!headers.origin)
		return true;

	var host;

	try {
		host = new URL(headers.origin).host;
	} catch (e) {
		return false;
	}

	return host === headers.host || host === headers['x-forwarded-host'];
};
