NEWACTION('Projects|list', {
	name: 'List projects',
	action: async function($) {
		var items = await NOSQL('projects').find().sort('dtopened_desc').promise($);
		$.callback(items);
	}
});

NEWACTION('Projects|open', {
	name: 'Open a project folder',
	input: '*path:String',
	action: async function($, model) {

		var path = Total.Path.resolve(model.path);
		var stat;

		try {
			stat = Total.Fs.statSync(path);
		} catch (e) {
			$.invalid('@(Folder not found)');
			return;
		}

		if (!stat.isDirectory()) {
			$.invalid('@(The path is not a folder)');
			return;
		}

		var item = await NOSQL('projects').read().where('path', path).promise($);

		if (item) {
			item.dtopened = NOW;
			await NOSQL('projects').modify({ dtopened: NOW }).where('id', item.id).promise($);
		} else {
			item = { id: UID(), name: Total.Path.basename(path), path: path, ownerid: $.user.id, dtcreated: NOW, dtopened: NOW };
			await NOSQL('projects').insert(item).promise($);
		}

		$.callback(item);
	}
});

NEWACTION('Projects|remove', {
	name: 'Forget a project',
	params: '*id',
	action: async function($) {
		var id = $.params.id;
		var sessions = await NOSQL('sessions').find().where('projectid', id).promise($);
		for (var session of sessions)
			await ACTION('Sessions|remove').params({ id: session.id }).user($.user).promise($);
		await NOSQL('projects').remove().where('id', id).promise($);
		$.success();
	}
});

NEWACTION('Projects|files', {
	name: 'List a folder of a project',
	params: '*id',
	query: 'path',
	action: async function($) {

		var project = await NOSQL('projects').read().where('id', $.params.id).error(404).promise($);
		var path = FUNC.resolve(project.path, $.query.path || '.');

		if (!path) {
			$.invalid('@(The path is outside the project)');
			return;
		}

		var items = [];
		try {
			for (var entry of Total.Fs.readdirSync(path, { withFileTypes: true })) {
				if (entry.name !== '.git' && entry.name !== 'node_modules')
					items.push({ name: entry.name, directory: entry.isDirectory() });
			}
		} catch (e) {
			$.invalid('@(Folder not found)');
			return;
		}

		items.sort((a, b) => a.directory === b.directory ? a.name.localeCompare(b.name) : (a.directory ? -1 : 1));
		$.callback(items);
	}
});
