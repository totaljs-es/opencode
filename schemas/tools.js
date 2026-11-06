// The tools of the agent. They run inside the project root of the session ($.user.root) and are never routed:
// the agent calls them with ACTION() after the permission check. Definitions for the model come from the input declarations.

var SKIP = { 'node_modules': 1, '.git': 1, 'databases': 1, 'tmp': 1 };
var MAXLINES = 2000;

function walk(root, base, filter, output, max) {
	var entries;
	try {
		entries = Total.Fs.readdirSync(base, { withFileTypes: true });
	} catch (e) {
		return;
	}
	for (var entry of entries) {
		if (output.length >= max)
			return;
		if (SKIP[entry.name])
			continue;
		var full = Total.Path.join(base, entry.name);
		if (entry.isDirectory())
			walk(root, full, filter, output, max);
		else if (entry.isFile()) {
			var relative = Total.Path.relative(root, full).split(Total.Path.sep).join('/');
			if (!filter || filter.test(relative))
				output.push(relative);
		}
	}
}

NEWACTION('Tools|read', {
	name: 'Read a file',
	summary: 'Reads a text file of the project, or lists a directory. Lines are numbered.',
	input: '*path:String // Path relative to the project root, offset:Number // First line to read (1 is the first), limit:Number // Number of lines to read',
	action: function($, model) {

		var path = FUNC.resolve($.user.root, model.path);
		if (!path) {
			$.invalid('@(The path is outside the project)');
			return;
		}

		var stat;
		try {
			stat = Total.Fs.statSync(path);
		} catch (e) {
			$.invalid('@(File not found)');
			return;
		}

		if (stat.isDirectory()) {
			var names = Total.Fs.readdirSync(path, { withFileTypes: true }).map(e => e.name + (e.isDirectory() ? '/' : ''));
			$.callback(names.sort().join('\n'));
			return;
		}

		var lines = Total.Fs.readFileSync(path, 'utf8').split('\n');
		var offset = Math.max((model.offset || 1) - 1, 0);
		var limit = model.limit || MAXLINES;
		var output = [];

		for (var i = offset; i < Math.min(lines.length, offset + limit); i++)
			output.push((i + 1) + '\t' + lines[i]);

		var text = output.join('\n');
		if (offset + limit < lines.length)
			text += '\n[{0} more lines, use offset]'.format(lines.length - offset - limit);

		$.callback(FUNC.truncate(text));
	}
});

NEWACTION('Tools|glob', {
	name: 'Find files',
	summary: 'Finds files of the project by glob pattern, for example src/**/*.js. Skips node_modules and .git.',
	input: '*pattern:String // Glob pattern relative to the project root',
	action: function($, model) {
		var output = [];
		walk($.user.root, $.user.root, FUNC.glob(model.pattern), output, 500);
		$.callback(output.length ? output.sort().join('\n') : '(no files)');
	}
});

NEWACTION('Tools|grep', {
	name: 'Search in files',
	summary: 'Searches file contents with a regular expression. Returns path:line:text.',
	input: '*pattern:String // Regular expression, path:String // Folder or file to search (default the project root), include:String // Glob filter for file paths, for example *.js',
	action: function($, model) {

		var root = $.user.root;
		var path = FUNC.resolve(root, model.path || '.');
		if (!path) {
			$.invalid('@(The path is outside the project)');
			return;
		}

		var regex;
		try {
			regex = new RegExp(model.pattern);
		} catch (e) {
			$.invalid('@(Invalid regular expression)');
			return;
		}

		var include = model.include ? FUNC.glob(model.include.indexOf('/') === -1 ? ('**/' + model.include) : model.include) : null;
		var files = [];
		var stat = Total.Fs.statSync(path);

		if (stat.isFile())
			files.push(Total.Path.relative(root, path).split(Total.Path.sep).join('/'));
		else
			walk(root, path, include, files, 5000);

		var output = [];
		for (var file of files) {
			var text;
			try {
				text = Total.Fs.readFileSync(Total.Path.join(root, file), 'utf8');
			} catch (e) {
				continue;
			}
			if (text.indexOf('\u0000') !== -1)
				continue;
			var lines = text.split('\n');
			for (var i = 0; i < lines.length; i++) {
				if (regex.test(lines[i]))
					output.push('{0}:{1}:{2}'.format(file, i + 1, lines[i].substring(0, 300)));
				if (output.length >= 200)
					break;
			}
			if (output.length >= 200)
				break;
		}

		$.callback(output.length ? FUNC.truncate(output.join('\n')) : '(no matches)');
	}
});

NEWACTION('Tools|write', {
	name: 'Write a file',
	summary: 'Creates a file or replaces it with the given content. Creates missing folders.',
	input: '*path:String // Path relative to the project root, *content:String // Full content of the file',
	action: function($, model) {

		var path = FUNC.resolve($.user.root, model.path);
		if (!path) {
			$.invalid('@(The path is outside the project)');
			return;
		}

		Total.Fs.mkdirSync(Total.Path.dirname(path), { recursive: true });
		Total.Fs.writeFileSync(path, model.content, 'utf8');
		$.callback('Written {0} ({1} lines)'.format(model.path, model.content.split('\n').length));
	}
});

NEWACTION('Tools|edit', {
	name: 'Edit a file',
	summary: 'Replaces an exact piece of text in a file. The text must appear once unless all is true.',
	input: '*path:String // Path relative to the project root, *oldstring:String // Exact text to replace, *newstring:String // Replacement text, all:Boolean // Replace every occurrence',
	action: function($, model) {

		var path = FUNC.resolve($.user.root, model.path);
		if (!path) {
			$.invalid('@(The path is outside the project)');
			return;
		}

		var text;
		try {
			text = Total.Fs.readFileSync(path, 'utf8');
		} catch (e) {
			$.invalid('@(File not found)');
			return;
		}

		var count = text.split(model.oldstring).length - 1;

		if (!count) {
			$.invalid('@(The text was not found in the file)');
			return;
		}

		if (count > 1 && !model.all) {
			$.invalid('@(The text appears several times: add more context or set all)');
			return;
		}

		text = text.split(model.oldstring).join(model.newstring);
		Total.Fs.writeFileSync(path, text, 'utf8');
		$.callback('Edited {0} ({1} replacement{2})'.format(model.path, count, count > 1 ? 's' : ''));
	}
});

NEWACTION('Tools|bash', {
	name: 'Run a command',
	summary: 'Runs a shell command in the project root and returns its output. Has a timeout.',
	input: '*command:String // The command line, timeout:Number // Timeout in milliseconds',
	action: function($, model) {

		var timeout = model.timeout || CONF.bashtimeout;
		var env = { PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG || 'en_US.UTF-8' };
		var child = Total.Child.spawn('/bin/sh', ['-c', model.command], { cwd: $.user.root, env: env });
		var sessionid = $.user.sessionid;
		var output = '';
		var killed = '';

		if (!MAIN.children[sessionid])
			MAIN.children[sessionid] = [];

		MAIN.children[sessionid].push(child);

		var timer = setTimeout(function() {
			killed = 'timeout';
			child.kill();
		}, timeout);

		var append = function(chunk) {
			if (output.length < CONF.maxoutput * 2)
				output += chunk;
		};

		child.stdout.on('data', append);
		child.stderr.on('data', append);

		child.on('close', function(code) {
			clearTimeout(timer);
			var list = MAIN.children[sessionid];
			if (list) {
				var index = list.indexOf(child);
				if (index !== -1)
					list.splice(index, 1);
				if (!list.length)
					delete MAIN.children[sessionid];
			}
			var text = FUNC.truncate(output);
			if (killed)
				text += '\n[stopped: ' + killed + ']';
			else
				text += '\n[exit code {0}]'.format(code);
			$.callback(text);
		});

		child.on('error', err => $.invalid(err.message));
	}
});
