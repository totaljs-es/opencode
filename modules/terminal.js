// The interactive terminal of a session: a shell in the project folder inside a pseudo-terminal, opened by the user and not by the model.
// Python's standard library provides the pseudo-terminal (private/terminal.py), so no native module is needed. It stays alive when the page reloads:
// the output is kept here and sent again on open. macOS and Linux; Windows has no pty module (phase 6).

exports.id = 'terminal';

var MAXOUTPUT = 100000;
var STOPPED = ['exited', 'stopped'];

function find(sessionid) {
	return MAIN.terminals[sessionid] || null;
}

exports.get = find;

exports.running = function(sessionid) {
	var item = find(sessionid);
	return !!(item && item.status === 'running');
};

// Opens the terminal of the session (or returns the one that is running)
exports.open = function(user, columns, rows) {

	var item = find(user.sessionid);

	if (item && item.status === 'running')
		return item;

	if (!Total.Fs.existsSync(user.root)) {
		item = { sessionid: user.sessionid, output: 'The folder of the project does not exist: ' + user.root + '\n', status: 'exited', dtcreated: NOW };
		MAIN.terminals[user.sessionid] = item;
		return item;
	}

	var env = { PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG || 'en_US.UTF-8', TERM: 'dumb', PAGER: 'cat' };
	var shell = CONF.terminalshell || process.env.SHELL || '/bin/sh';
	columns = Math.max(20, Math.min(400, columns || 100));
	rows = Math.max(5, Math.min(200, rows || 24));

	var child = Total.Child.spawn(CONF.$python || 'python3', [PATH.private('terminal.py'), '' + columns, '' + rows, shell, '-i'], { cwd: user.root, env: env, stdio: ['pipe', 'pipe', 'pipe', 'pipe'] });
	item = { sessionid: user.sessionid, child: child, output: '', status: 'running', dtcreated: NOW };

	function append(chunk) {
		var text = FUNC.scrub(chunk.toString('utf8'));
		item.output += text;
		if (item.output.length > MAXOUTPUT)
			item.output = item.output.substring(item.output.length - MAXOUTPUT);
		FUNC.emit(item.sessionid, 'terminal.output', { text: text });
	}

	function finish(status) {
		if (item.status === 'running') {
			item.status = status;
			FUNC.emit(item.sessionid, 'terminal.exit', { status: status });
		}
	}

	child.stdout.on('data', append);
	child.stderr.on('data', append);
	child.on('close', code => finish('exited'));
	child.on('error', err => {
		item.output += 'The terminal could not start: ' + err.message + '\n';
		finish('exited');
	});

	MAIN.terminals[user.sessionid] = item;
	return item;
};

exports.write = function(sessionid, text) {
	var item = find(sessionid);
	if (!item || item.status !== 'running')
		return false;
	item.child.stdin.write(text);
	return true;
};

exports.resize = function(sessionid, columns, rows) {
	var item = find(sessionid);
	if (!item || item.status !== 'running')
		return false;
	item.child.stdio[3].write('{0} {1}\n'.format(Math.max(20, Math.min(400, columns)), Math.max(5, Math.min(200, rows))));
	return true;
};

exports.stop = function(sessionid) {
	var item = find(sessionid);
	if (item && item.status === 'running') {
		item.status = 'stopped';
		item.child.kill();
		FUNC.emit(sessionid, 'terminal.exit', { status: 'stopped' });
	}
};

// Ends the terminals of a session (or all of them without an id) and forgets them
exports.clear = function(sessionid) {
	for (var id in MAIN.terminals) {
		if (!sessionid || id === sessionid) {
			exports.stop(id);
			delete MAIN.terminals[id];
		}
	}
};

process.on('exit', () => exports.clear());
