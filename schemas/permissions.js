NEWACTION('Permissions|reply', {
	name: 'Answer a permission question',
	params: '*id',
	input: '*reply:String',
	action: function($, model) {

		if (['once', 'always', 'reject'].indexOf(model.reply) === -1) {
			$.invalid('@(Invalid reply)');
			return;
		}

		if (MODS.permissions.reply($.params.id, model.reply))
			$.success();
		else
			$.invalid(404);
	}
});

NEWACTION('Permissions|list', {
	name: 'Permission rules of a project',
	query: '*projectid',
	action: async function($) {
		var items = await NOSQL('permissions').find().where('projectid', $.query.projectid).promise($);
		$.callback(items);
	}
});

NEWACTION('Permissions|remove', {
	name: 'Remove a permission rule',
	params: '*id',
	action: async function($) {
		await NOSQL('permissions').remove().where('id', $.params.id).promise($);
		$.success();
	}
});


NEWACTION('Questions|reply', {
	name: 'Answer a question of the agent',
	params: '*id',
	input: '*answer:String',
	action: function($, model) {
		if (MODS.permissions.answer($.params.id, model.answer))
			$.success();
		else
			$.invalid(404);
	}
});
