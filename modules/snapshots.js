// Snapshots: before a tool changes a file, its previous content is kept so the user can see the diff of a session and undo it.
// The diff is computed from the snapshots, so unrelated work in the project never appears in it.

exports.id = 'snapshots';

var MAXSIZE = 2 * 1024 * 1024;
var CONTEXT = 3;

function dir() {
	return PATH.databases('snapshots');
}

function lines(text) {
	if (!text)
		return [];
	var arr = text.split('\n');
	if (arr[arr.length - 1] === '')
		arr.pop();
	return arr;
}

// Edit script of two arrays of lines: [{ t: ' ' | '-' | '+', s: line }]
function script(a, b) {

	var start = 0;
	while (start < a.length && start < b.length && a[start] === b[start])
		start++;

	var ea = a.length;
	var eb = b.length;
	while (ea > start && eb > start && a[ea - 1] === b[eb - 1]) {
		ea--;
		eb--;
	}

	var ops = [];
	var i;

	for (i = 0; i < start; i++)
		ops.push({ t: ' ', s: a[i] });

	var x = a.slice(start, ea);
	var y = b.slice(start, eb);
	var n = x.length;
	var m = y.length;

	if (n * m > 4000000) {
		// Too large for the table: show a replacement
		for (i = 0; i < n; i++)
			ops.push({ t: '-', s: x[i] });
		for (i = 0; i < m; i++)
			ops.push({ t: '+', s: y[i] });
	} else {

		var width = m + 1;
		var table = new Uint32Array((n + 1) * width);

		for (i = n - 1; i >= 0; i--) {
			for (var j = m - 1; j >= 0; j--)
				table[i * width + j] = x[i] === y[j] ? table[(i + 1) * width + j + 1] + 1 : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
		}

		i = 0;
		var k = 0;
		while (i < n && k < m) {
			if (x[i] === y[k]) {
				ops.push({ t: ' ', s: x[i] });
				i++;
				k++;
			} else if (table[(i + 1) * width + k] >= table[i * width + k + 1])
				ops.push({ t: '-', s: x[i++] });
			else
				ops.push({ t: '+', s: y[k++] });
		}

		while (i < n)
			ops.push({ t: '-', s: x[i++] });
		while (k < m)
			ops.push({ t: '+', s: y[k++] });
	}

	for (i = ea; i < a.length; i++)
		ops.push({ t: ' ', s: a[i] });

	return ops;
}

// Unified diff of two texts: { additions, deletions, patch }
exports.diff = function(oldtext, newtext) {

	var ops = script(lines(oldtext), lines(newtext));
	var additions = 0;
	var deletions = 0;
	var changes = [];
	var i;

	for (i = 0; i < ops.length; i++) {
		if (ops[i].t === '+')
			additions++;
		else if (ops[i].t === '-')
			deletions++;
		if (ops[i].t !== ' ')
			changes.push(i);
	}

	if (!changes.length)
		return { additions: 0, deletions: 0, patch: '' };

	// Groups of changes whose context touches
	var groups = [];
	var current = null;
	for (i = 0; i < changes.length; i++) {
		var at = changes[i];
		if (current && at - current.end <= CONTEXT * 2 + 1)
			current.end = at;
		else {
			current = { begin: at, end: at };
			groups.push(current);
		}
	}

	var out = [];
	var oldline = [];
	var newline = [];
	var o = 1;
	var n = 1;

	for (i = 0; i < ops.length; i++) {
		oldline[i] = o;
		newline[i] = n;
		if (ops[i].t !== '+')
			o++;
		if (ops[i].t !== '-')
			n++;
	}

	for (var group of groups) {
		var from = Math.max(group.begin - CONTEXT, 0);
		var to = Math.min(group.end + CONTEXT, ops.length - 1);
		var oc = 0;
		var nc = 0;
		var body = [];
		for (i = from; i <= to; i++) {
			if (ops[i].t !== '+')
				oc++;
			if (ops[i].t !== '-')
				nc++;
			body.push(ops[i].t + ops[i].s);
		}
		out.push('@@ -{0},{1} +{2},{3} @@'.format(oldline[from], oc, newline[from], nc));
		out = out.concat(body);
	}

	return { additions: additions, deletions: deletions, patch: out.join('\n') };
};

// Keeps the content of a file before the first change of a message. `user` is the context of the tool call.
exports.before = function(user, relative, path) {

	if (!user.messageid)
		return;

	var key = user.messageid + ':' + relative;
	var memo = MAIN.snapshots || (MAIN.snapshots = {});

	if (memo[key])
		return;

	memo[key] = 1;

	var existed = Total.Fs.existsSync(path);
	var id = UID();
	var size = 0;

	if (existed) {
		var content = Total.Fs.readFileSync(path);
		size = content.length;
		if (size <= MAXSIZE) {
			Total.Fs.mkdirSync(dir(), { recursive: true });
			Total.Fs.writeFileSync(Total.Path.join(dir(), id), content);
		} else
			size = -1;
	}

	NOSQL('snapshots').insert({ id: id, sessionid: user.sessionid, messageid: user.messageid, path: relative, existed: existed, size: size, dtcreated: new Date() }).callback(NOOP);
	FUNC.emit(user.sessionid, 'diff.updated', { path: relative });
};

function blob(snapshot) {
	if (!snapshot.existed)
		return '';
	if (snapshot.size < 0)
		return null;
	try {
		return Total.Fs.readFileSync(Total.Path.join(dir(), snapshot.id), 'utf8');
	} catch (e) {
		return null;
	}
}

// The earliest snapshot of each path: the state before the session touched it
function earliest(snapshots) {
	var map = {};
	snapshots.sort((a, b) => a.dtcreated - b.dtcreated);
	for (var item of snapshots) {
		if (!map[item.path])
			map[item.path] = item;
	}
	return map;
}

// callback(err, files) with [{ path, status, additions, deletions, patch }]
exports.files = function(session, project, callback) {
	NOSQL('snapshots').find().where('sessionid', session.id).callback(function(err, snapshots) {

		var map = earliest(snapshots || []);
		var files = [];

		for (var path in map) {

			var original = blob(map[path]);
			var full = FUNC.resolve(project.path, path);
			var exists = full && Total.Fs.existsSync(full);
			var current = exists ? Total.Fs.readFileSync(full, 'utf8') : '';

			if (original === null) {
				files.push({ path: path, status: 'modified', additions: 0, deletions: 0, patch: '(the file was too large to keep a snapshot)' });
				continue;
			}

			if (map[path].existed === exists && original === current)
				continue;

			var result = exports.diff(original, current);
			files.push({ path: path, status: !map[path].existed ? 'added' : (!exists ? 'deleted' : 'modified'), additions: result.additions, deletions: result.deletions, patch: result.patch });
		}

		files.sort((a, b) => a.path.localeCompare(b.path));
		callback(null, files);
	});
};

// Restores the files that the message and the later ones changed. callback(err, restored)
exports.undo = function(session, project, messageid, callback) {

	NOSQL('messages').find().where('sessionid', session.id).sort('dtcreated').callback(function(err, messages) {

		var index = messages.findIndex(m => m.id === messageid);
		if (index === -1) {
			callback('@(Message not found)');
			return;
		}

		var ids = messages.slice(index).map(m => m.id);

		NOSQL('snapshots').find().where('sessionid', session.id).callback(function(err, snapshots) {

			snapshots = (snapshots || []).filter(s => ids.indexOf(s.messageid) !== -1);

			var map = earliest(snapshots);
			var restored = [];

			for (var path in map) {

				var full = FUNC.resolve(project.path, path);
				if (!full)
					continue;

				var original = blob(map[path]);
				if (original === null)
					continue;

				if (map[path].existed) {
					Total.Fs.mkdirSync(Total.Path.dirname(full), { recursive: true });
					Total.Fs.writeFileSync(full, original, 'utf8');
				} else if (Total.Fs.existsSync(full))
					Total.Fs.unlinkSync(full);

				restored.push(path);
			}

			for (var item of snapshots) {
				delete (MAIN.snapshots || {})[item.messageid + ':' + item.path];
				try {
					Total.Fs.unlinkSync(Total.Path.join(dir(), item.id));
				} catch (e) {}
			}

			NOSQL('snapshots').remove().in('id', snapshots.map(s => s.id)).callback(function() {
				FUNC.emit(session.id, 'diff.updated', { paths: restored });
				callback(null, restored);
			});
		});
	});
};

// Removes the snapshots of a session or of a list of sessions
exports.clear = function(sessionid, callback) {

	var ids = Array.isArray(sessionid) ? sessionid : [sessionid];

	if (!ids.length) {
		callback && callback();
		return;
	}

	NOSQL('snapshots').find().in('sessionid', ids).callback(function(err, snapshots) {
		for (var item of (snapshots || [])) {
			try {
				Total.Fs.unlinkSync(Total.Path.join(dir(), item.id));
			} catch (e) {}
		}
		NOSQL('snapshots').remove().in('sessionid', ids).callback(() => callback && callback());
	});
};
