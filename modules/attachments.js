// Files that the user attaches to a prompt: images (for models that can see) and text files (their text goes into the prompt).
// They are kept in databases/attachments; the conversation keeps a part of type "file" with the metadata.

exports.id = 'attachments';

var IMAGES = { 'image/png': 1, 'image/jpeg': 1, 'image/gif': 1, 'image/webp': 1 };
var TEXT = /\.(txt|md|markdown|json|jsonc|js|mjs|cjs|ts|tsx|jsx|css|scss|less|html|htm|xml|svg|yml|yaml|toml|ini|sql|sh|bash|zsh|py|rb|php|java|kt|go|rs|c|h|cpp|hpp|cs|swift|csv|tsv|log|env|conf|config|gitignore|vue|svelte)$/i;
var MAXFILES = 6;
var MAXIMAGE = 5 * 1024 * 1024;
var MAXTEXT = 200 * 1024;
var MAXTOTAL = 12 * 1024 * 1024;

function dir() {
	return PATH.databases('attachments');
}

function file(id) {
	return Total.Path.join(dir(), id);
}

exports.limits = { files: MAXFILES, image: MAXIMAGE, text: MAXTEXT };

// items: [{ name, mime, data (base64) }]. callback(err, [{ id, name, mime, size, kind }])
exports.save = function(sessionid, items, callback) {

	items = items || [];

	if (!items.length) {
		callback(null, []);
		return;
	}

	if (items.length > MAXFILES) {
		callback('@(Too many files: the limit is) ' + MAXFILES);
		return;
	}

	var checked = [];
	var total = 0;

	for (var item of items) {

		var name = ('' + (item.name || 'file')).replace(/[\\/\u0000-\u001f]/g, '_').substring(0, 120);
		var mime = ('' + (item.mime || '')).toLowerCase();
		var buffer = Buffer.from(item.data || '', 'base64');
		var kind = IMAGES[mime] ? 'image' : ((/^text\//.test(mime) || mime === 'application/json' || mime === 'application/xml' || TEXT.test(name)) ? 'text' : '');

		if (!kind) {
			callback('@(This kind of file cannot be attached:) ' + name);
			return;
		}

		if (!buffer.length) {
			callback('@(The file is empty:) ' + name);
			return;
		}

		if (buffer.length > (kind === 'image' ? MAXIMAGE : MAXTEXT)) {
			callback('@(The file is too large:) ' + name);
			return;
		}

		// A text file must be text
		if (kind === 'text' && buffer.indexOf(0) !== -1) {
			callback('@(This is not a text file:) ' + name);
			return;
		}

		total += buffer.length;

		if (total > MAXTOTAL) {
			callback('@(The files are too large together)');
			return;
		}

		checked.push({ name: name, mime: kind === 'image' ? mime : 'text/plain', kind: kind, buffer: buffer });
	}

	Total.Fs.mkdirSync(dir(), { recursive: true });

	var saved = [];

	for (var entry of checked) {
		var id = UID();
		Total.Fs.writeFileSync(file(id), entry.buffer);
		var meta = { id: id, sessionid: sessionid, name: entry.name, mime: entry.mime, kind: entry.kind, size: entry.buffer.length, dtcreated: new Date() };
		NOSQL('attachments').insert(meta).callback(NOOP);
		saved.push({ id: id, name: entry.name, mime: entry.mime, kind: entry.kind, size: entry.buffer.length });
	}

	callback(null, saved);
};

exports.buffer = function(id) {
	try {
		return Total.Fs.readFileSync(file(id));
	} catch (e) {
		return null;
	}
};

exports.text = function(id) {
	var buffer = exports.buffer(id);
	return buffer ? buffer.toString('utf8') : null;
};

// The data URL of an image, as the models receive it
exports.dataurl = function(meta) {
	var buffer = exports.buffer(meta.id);
	return buffer ? ('data:' + meta.mime + ';base64,' + buffer.toString('base64')) : null;
};

// Removes the files of one session or of a list of sessions
exports.clear = function(sessionid, callback) {

	var ids = Array.isArray(sessionid) ? sessionid : [sessionid];

	if (!ids.length) {
		callback && callback();
		return;
	}

	NOSQL('attachments').find().in('sessionid', ids).callback(function(err, items) {

		for (var item of (items || [])) {
			try {
				Total.Fs.unlinkSync(file(item.id));
			} catch (e) {}
		}

		NOSQL('attachments').remove().in('sessionid', ids).callback(() => callback && callback());
	});
};
