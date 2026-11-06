// Definitions of sub-agents: files with a name, a description, the tools they may use and a prompt.
// Built in: private/agents/*.md. A project adds or replaces them in .totem/agents/*.md.

exports.id = 'agents';

function load(dir, found) {

	var names;
	try {
		names = Total.Fs.readdirSync(dir);
	} catch (e) {
		return;
	}

	for (var file of names) {

		if (!/\.md$/.test(file))
			continue;

		var parsed = MODS.instructions.frontmatter(Total.Fs.readFileSync(Total.Path.join(dir, file), 'utf8'));
		var name = parsed.meta.name || file.replace(/\.md$/, '');

		found[name] = {
			name: name,
			description: parsed.meta.description || '',
			tools: (parsed.meta.tools || 'read, glob, grep').split(',').map(t => t.trim()).filter(Boolean),
			maxsteps: parseInt(parsed.meta.maxsteps) || 20,
			prompt: parsed.body.trim()
		};
	}
}

exports.list = function(root) {
	var found = {};
	load(PATH.private('agents'), found);
	load(Total.Path.join(root, '.totem/agents'), found);
	return Object.keys(found).sort().map(key => found[key]);
};

exports.get = function(root, name) {
	return exports.list(root).findItem('name', name);
};
