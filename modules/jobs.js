// Commands that run in the background (a development server, a watcher). They belong to a session: Stop does not end them, removing the
// session or stopping the server does. The model reads their output and ends them with the job tool.

exports.id = 'jobs';

var MAXOUTPUT = 100000;

exports.start = function(user, command) {

	var env = { PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG || 'en_US.UTF-8' };
	var child = Total.Child.spawn('/bin/sh', ['-c', command], { cwd: user.root, env: env });
	var job = { id: 'j' + UID().substring(0, 6), sessionid: user.sessionid, command: command, child: child, output: '', status: 'running', dtcreated: NOW };

	function append(chunk) {
		job.output += chunk;
		if (job.output.length > MAXOUTPUT)
			job.output = job.output.substring(job.output.length - MAXOUTPUT);
	}

	child.stdout.on('data', append);
	child.stderr.on('data', append);
	child.on('close', code => job.status = job.status === 'stopped' ? 'stopped' : ('exited with code ' + code));
	child.on('error', err => job.status = 'failed: ' + err.message);

	MAIN.jobs[job.id] = job;
	return job;
};

exports.get = (sessionid, id) => MAIN.jobs[id] && MAIN.jobs[id].sessionid === sessionid ? MAIN.jobs[id] : null;

exports.list = sessionid => Object.keys(MAIN.jobs).map(id => MAIN.jobs[id]).filter(job => job.sessionid === sessionid);

exports.tail = function(job) {
	return FUNC.truncate(FUNC.scrub(job.output.length > 4000 ? ('...' + job.output.substring(job.output.length - 4000)) : job.output)) || '(no output yet)';
};

exports.stop = function(job) {
	if (job.status === 'running') {
		job.status = 'stopped';
		job.child.kill();
	}
};

// Ends the jobs of a session (or all of them when there is no id) and forgets them
exports.clear = function(sessionid) {
	for (var id in MAIN.jobs) {
		var job = MAIN.jobs[id];
		if (!sessionid || job.sessionid === sessionid) {
			exports.stop(job);
			delete MAIN.jobs[id];
		}
	}
};

process.on('exit', () => exports.clear());
