// Multi-file patches in a simple text format:
//
//   *** Begin Patch
//   *** Add File: path          lines start with +
//   *** Delete File: path
//   *** Update File: path       one or more hunks: @@ then lines that start with a space (context), - (remove) or + (add)
//   *** End Patch

exports.id = 'patch';

exports.parse = function(text) {

	var lines = text.replace(/\r\n/g, '\n').split('\n');
	var ops = [];
	var op = null;
	var hunk = null;
	var begin = false;
	var end = false;

	for (var line of lines) {

		if (line === '*** Begin Patch') {
			begin = true;
			continue;
		}

		if (!begin)
			continue;

		if (line === '*** End Patch') {
			end = true;
			break;
		}

		var match = line.match(/^\*\*\* (Add|Delete|Update) File: (.+)$/);

		if (match) {
			op = { kind: match[1].toLowerCase(), path: match[2].trim(), hunks: [], lines: [] };
			hunk = null;
			ops.push(op);
			continue;
		}

		if (!op)
			continue;

		if (op.kind === 'add') {
			if (line.charAt(0) === '+')
				op.lines.push(line.substring(1));
			continue;
		}

		if (op.kind === 'update') {

			if (line.indexOf('@@') === 0) {
				hunk = { old: [], new: [] };
				op.hunks.push(hunk);
				continue;
			}

			if (!hunk) {
				hunk = { old: [], new: [] };
				op.hunks.push(hunk);
			}

			var c = line.charAt(0);
			var s = line.substring(1);

			if (c === '-')
				hunk.old.push(s);
			else if (c === '+')
				hunk.new.push(s);
			else if (c === ' ' || line === '') {
				hunk.old.push(s);
				hunk.new.push(s);
			}
		}
	}

	if (!begin || !end)
		return { error: 'The patch must start with "*** Begin Patch" and end with "*** End Patch"' };

	if (!ops.length)
		return { error: 'The patch has no files' };

	return { ops: ops };
};

function find(lines, seq, from) {

	if (!seq.length)
		return from;

	for (var pass = 0; pass < 2; pass++) {
		for (var i = from; i + seq.length <= lines.length; i++) {
			var ok = true;
			for (var j = 0; j < seq.length; j++) {
				var a = lines[i + j];
				var b = seq[j];
				if (pass ? (a.trimEnd() !== b.trimEnd()) : (a !== b)) {
					ok = false;
					break;
				}
			}
			if (ok)
				return i;
		}
	}

	return -1;
}

// Computes the result of every file without writing: { error } or { changes: [{ path, kind, content }] }
exports.plan = function(root, ops) {

	var changes = [];

	for (var op of ops) {

		var path = FUNC.resolve(root, op.path);

		if (!path)
			return { error: 'The path is outside the project: ' + op.path };

		if (op.kind === 'add') {
			if (Total.Fs.existsSync(path))
				return { error: 'The file already exists: ' + op.path };
			changes.push({ path: op.path, full: path, kind: 'add', content: op.lines.join('\n') + '\n' });
			continue;
		}

		if (!Total.Fs.existsSync(path))
			return { error: 'File not found: ' + op.path };

		if (op.kind === 'delete') {
			changes.push({ path: op.path, full: path, kind: 'delete' });
			continue;
		}

		var text = Total.Fs.readFileSync(path, 'utf8');
		var trailing = text.slice(-1) === '\n';
		var lines = text.split('\n');

		if (trailing)
			lines.pop();

		var from = 0;

		for (var i = 0; i < op.hunks.length; i++) {

			var hunk = op.hunks[i];
			var index = find(lines, hunk.old, from);

			if (index === -1)
				return { error: 'The lines of hunk {0} were not found in {1}: read the file again and use exact lines'.format(i + 1, op.path) };

			lines.splice.apply(lines, [index, hunk.old.length].concat(hunk.new));
			from = index + hunk.new.length;
		}

		changes.push({ path: op.path, full: path, kind: 'update', content: lines.join('\n') + (trailing ? '\n' : '') });
	}

	return { changes: changes };
};
