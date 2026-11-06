NEWACTION('Providers|list', {
	name: 'List providers',
	action: async function($) {
		var items = await NOSQL('providers').find().promise($);
		for (var item of items) {
			item.haskey = !!item.key;
			delete item.key;
		}
		$.callback(items);
	}
});

NEWACTION('Providers|save', {
	name: 'Save a provider',
	input: 'id:String, *name:String, *url:String, key:String, models:[String], disabled:Boolean',
	action: async function($, model) {

		var item = model.id ? await NOSQL('providers').read().where('id', model.id).promise($) : null;

		if (model.id && !item) {
			$.invalid(404);
			return;
		}

		var data = { name: model.name, url: model.url, models: model.models || [], disabled: !!model.disabled, dtupdated: NOW };

		// An empty key keeps the stored one: the interface never receives it
		if (model.key)
			data.key = FUNC.encryptkey(model.key);

		if (item)
			await NOSQL('providers').modify(data).where('id', item.id).promise($);
		else {
			data.id = model.name.slug();
			data.key = data.key || '';
			data.dtcreated = NOW;
			await NOSQL('providers').insert(data).promise($);
		}

		FUNC.providers();
		$.success(data.id || item.id);
	}
});

NEWACTION('Providers|remove', {
	name: 'Remove a provider',
	params: '*id',
	action: async function($) {
		await NOSQL('providers').remove().where('id', $.params.id).promise($);
		$.success();
	}
});

NEWACTION('Providers|models', {
	name: 'Models that can be used in a session',
	action: function($) {
		var items = Object.keys(F.aimodels).sort();
		$.callback(items);
	}
});
