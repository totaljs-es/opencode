// Instructions of a project (AGENTS.md) and its skills (folders with SKILL.md), read from the project root.

exports.id = 'instructions';

var SKILLS = ['.totem/skills', '.claude/skills', '.agents/skills', 'skills'];
var MAXTEXT = 20000;

function read(path) {
	try {
		return Total.Fs.readFileSync(path, 'utf8');
	} catch (e) {
		return '';
	}
}

function frontmatter(text) {
	var match = text.match(/^---\n([\s\S]*?)\n---\n?/);
	var meta = {};
	if (match) {
		for (var line of match[1].split('\n')) {
			var index = line.indexOf(':');
			if (index > 0)
				meta[line.substring(0, index).trim()] = line.substring(index + 1).trim();
		}
	}
	return { meta: meta, body: match ? text.substring(match[0].length) : text };
}

exports.frontmatter = frontmatter;

exports.text = function(root) {
	var text = read(Total.Path.join(root, 'AGENTS.md')) || read(Total.Path.join(root, 'CLAUDE.md'));
	return text.length > MAXTEXT ? (text.substring(0, MAXTEXT) + '\n[truncated]') : text;
};

// [{ name, description, file }]
exports.skills = function(root) {

	var found = {};

	for (var base of SKILLS) {
		var dir = Total.Path.join(root, base);
		var names;
		try {
			names = Total.Fs.readdirSync(dir);
		} catch (e) {
			continue;
		}
		for (var name of names) {
			var file = Total.Path.join(dir, name, 'SKILL.md');
			var parsed = frontmatter(read(file));
			if (parsed.meta.name || parsed.body) {
				var id = parsed.meta.name || name;
				if (!found[id])
					found[id] = { name: id, description: parsed.meta.description || '', file: file };
			}
		}
	}

	return Object.keys(found).sort().map(key => found[key]);
};

exports.skill = function(root, name) {
	for (var item of exports.skills(root)) {
		if (item.name === name) {
			var body = frontmatter(read(item.file)).body;
			return body.length > MAXTEXT ? (body.substring(0, MAXTEXT) + '\n[truncated]') : body;
		}
	}
	return null;
};
