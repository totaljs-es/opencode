// The texts of the interface and their translations. Texts are written as @(English text) in plugins, views, schemas and the other
// application folders; the resources are `resources/<language>.resource`, one line per text: `T<hash> : translation`. The key is the hash
// that Total.js computes from the English text, so a changed English text needs a new translation.
//
//   node scripts/translations.js                list the languages and the texts that each one misses
//   node scripts/translations.js export <lang>  print the missing texts as JSON { "English": "" } to translate
//   node scripts/translations.js import <lang> <file.json>   add translations from { "English": "translation" } to the resource
//
// The languages are the ones of private/languages.json; `en` has no resource (the English text is the default).

require('total5');

const Fs = require('fs');
const Path = require('path');

const ROOT = Path.join(__dirname, '..');
const FOLDERS = ['plugins', 'views', 'schemas', 'modules', 'definitions', 'controllers', 'public/js'];

function key(text) {
	return 'T' + text.hash(true).toString(36);
}

// The texts between @( and the matching ), with nested parentheses
function extract(source, found) {

	var index = -1;

	while ((index = source.indexOf('@(', index + 1)) !== -1) {
		var depth = 0;
		for (var i = index + 2; i < source.length; i++) {
			var c = source[i];
			if (c === '(')
				depth++;
			else if (c === ')') {
				if (depth) {
					depth--;
					continue;
				}
				var text = source.substring(index + 2, i);
				if (text.trim())
					found[text] = 1;
				break;
			}
		}
	}
}

function scan(dir, found) {
	for (var entry of Fs.readdirSync(dir, { withFileTypes: true })) {
		var full = Path.join(dir, entry.name);
		if (entry.isDirectory())
			scan(full, found);
		else if (/\.(html|js|json)$/.test(entry.name))
			extract(Fs.readFileSync(full, 'utf8'), found);
	}
}

exports.texts = function() {
	var found = {};
	FOLDERS.forEach(folder => {
		var dir = Path.join(ROOT, folder);
		Fs.existsSync(dir) && scan(dir, found);
	});
	return Object.keys(found).sort();
};

exports.languages = () => JSON.parse(Fs.readFileSync(Path.join(ROOT, 'private/languages.json'), 'utf8')).map(l => l.id).filter(id => id !== 'en');

exports.read = function(language) {
	var map = {};
	var file = Path.join(ROOT, 'resources', language + '.resource');
	if (!Fs.existsSync(file))
		return map;
	for (var line of Fs.readFileSync(file, 'utf8').split('\n')) {
		var index = line.indexOf(' : ');
		if (index > 0 && line[0] === 'T')
			map[line.substring(0, index).trim()] = line.substring(index + 3).trim();
	}
	return map;
};

exports.missing = function(language) {
	var have = exports.read(language);
	return exports.texts().filter(text => !have[key(text)]);
};

exports.key = key;

if (require.main === module) {

	var command = process.argv[2];
	var language = process.argv[3];

	if (!command) {
		var texts = exports.texts();
		console.log(texts.length + ' texts');
		exports.languages().forEach(id => console.log(id + ': ' + exports.missing(id).length + ' missing'));
	} else if (command === 'export') {
		var out = {};
		exports.missing(language).forEach(text => out[text] = '');
		console.log(JSON.stringify(out, null, '\t'));
	} else if (command === 'import') {
		var map = exports.read(language);
		var given = JSON.parse(Fs.readFileSync(process.argv[4], 'utf8'));
		var known = {};
		exports.texts().forEach(text => known[text] = 1);
		var added = 0;
		for (var text in given) {
			if (known[text] && given[text] && given[text].trim()) {
				map[key(text)] = given[text].trim().replace(/\n/g, ' ');
				added++;
			}
		}
		Fs.mkdirSync(Path.join(ROOT, 'resources'), { recursive: true });
		Fs.writeFileSync(Path.join(ROOT, 'resources', language + '.resource'), Object.keys(map).sort().map(k => k + ' : ' + map[k]).join('\n') + '\n');
		console.log('added ' + added + ', missing ' + exports.missing(language).length);
	}
}
