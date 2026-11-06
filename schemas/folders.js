// The folders of the computer where Totem runs, for choosing the folder of a project. Only the names of folders are listed.

NEWACTION('Folders|list', {
	name: 'Folders of this computer',
	query: 'path:String, hidden:Boolean',
	action: function($) {

		var home = Total.Os.homedir();
		var path = $.query.path ? Total.Path.resolve($.query.path) : home;
		var entries;

		try {
			entries = Total.Fs.readdirSync(path, { withFileTypes: true });
		} catch (e) {
			$.invalid('@(Folder not found)');
			return;
		}

		var items = [];

		for (var entry of entries) {

			if (!$.query.hidden && entry.name.charAt(0) === '.')
				continue;

			var directory = entry.isDirectory();

			// A link to a folder counts as a folder
			if (!directory && entry.isSymbolicLink()) {
				try {
					directory = Total.Fs.statSync(Total.Path.join(path, entry.name)).isDirectory();
				} catch (e) {}
			}

			if (directory)
				items.push({ name: entry.name });
		}

		items.sort((a, b) => a.name.localeCompare(b.name));

		var places = [{ name: 'Home', path: home }];

		if (Total.Fs.existsSync('/Volumes'))
			places.push({ name: 'Volumes', path: '/Volumes' });

		places.push({ name: 'Root', path: Total.Path.parse(path).root });

		$.callback({ path: path, sep: Total.Path.sep, home: home, items: items.slice(0, 1000), places: places });
	}
});
