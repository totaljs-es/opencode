// Custom commands: a prompt in a file, run with /name and arguments. They live in .totem/commands/*.md:
//
//   ---
//   description: Review a file
//   ---
//   Review $ARGUMENTS and list the problems by severity.

exports.id = 'commands';

exports.list = function(root) {

	var dir = Total.Path.join(root, '.totem/commands');
	var names;

	try {
		names = Total.Fs.readdirSync(dir);
	} catch (e) {
		return [];
	}

	return names.filter(file => /\.md$/.test(file)).sort().map(function(file) {
		var parsed = MODS.instructions.frontmatter(Total.Fs.readFileSync(Total.Path.join(dir, file), 'utf8'));
		return { name: file.replace(/\.md$/, ''), description: parsed.meta.description || '', template: parsed.body.trim() };
	});
};

// "/name arguments" -> the text of the command with $ARGUMENTS replaced, or null when the text is not a command of the project
exports.expand = function(root, text) {

	var match = text.match(/^\/([a-zA-Z0-9_-]+)(?:\s+([\s\S]*))?$/);

	if (!match)
		return null;

	var command = exports.list(root).findItem('name', match[1]);

	if (!command)
		return null;

	var args = (match[2] || '').trim();
	var output = command.template.indexOf('$ARGUMENTS') === -1 ? (command.template + (args ? ('\n\n' + args) : '')) : command.template.split('$ARGUMENTS').join(args);

	return { name: command.name, text: output };
};
