// Scheduled prompts. See modules/schedules.js for how they run.

function view(item) {
	var out = Object.assign({}, item);
	var next = MODS.schedules.next(item, NOW);
	out.next = next ? next.toISOString() : null;
	out.running = !!MAIN.scheduled[item.id];
	return out;
}

NEWACTION('Schedules|list', {
	name: 'List scheduled prompts',
	summary: 'The prompts that Totem sends by itself in a project, with when they run next and how the last run ended.',
	query: 'projectid:String',
	action: async function($) {
		var builder = NOSQL('schedules').find().sort('dtcreated_desc');
		$.query.projectid && builder.where('projectid', $.query.projectid);
		var items = await builder.promise($);
		$.callback(items.map(view));
	}
});

NEWACTION('Schedules|save', {
	name: 'Create or change a scheduled prompt',
	summary: 'A prompt that runs in a new session every N minutes (kind interval, at least 5) or every day at HH:MM of the server (kind daily). It runs unattended, in Plan mode unless mode is build; edits in build mode need autoaccept.',
	input: 'id:String, *projectid:String, *name:String, *text:String, *model:String, kind:String, interval:Number, time:String, mode:String, autoaccept:Boolean, enabled:Boolean',
	action: async function($, model) {

		await NOSQL('projects').read().where('id', model.projectid).error(404).promise($);

		var body = $.body || model;
		var item = {
			projectid: model.projectid,
			name: model.name.trim().substring(0, 60),
			text: model.text.trim(),
			model: model.model,
			kind: model.kind === 'daily' ? 'daily' : 'interval',
			interval: model.kind === 'daily' ? 0 : Math.floor(model.interval || 0),
			time: model.kind === 'daily' ? (model.time || '') : '',
			mode: model.mode === 'build' ? 'build' : 'plan',
			autoaccept: !!model.autoaccept && model.mode === 'build',
			enabled: body.enabled === undefined ? true : !!model.enabled
		};

		if (!item.name || !item.text) {
			$.invalid('@(A schedule needs a name and a prompt)');
			return;
		}

		if (!F.aimodels[item.model]) {
			$.invalid('@(Choose a model first)');
			return;
		}

		var error = MODS.schedules.valid(item);

		if (error) {
			$.invalid(error);
			return;
		}

		if (model.id) {
			var old = await NOSQL('schedules').read().where('id', model.id).error(404).promise($);
			// Changing when it runs counts from now
			if (old.kind !== item.kind || old.interval !== item.interval || old.time !== item.time)
				item.dtlast = NOW;
			await NOSQL('schedules').modify(item).where('id', model.id).promise($);
			$.callback(view(Object.assign({}, old, item)));
			return;
		}

		item.id = UID();
		item.dtcreated = NOW;
		await NOSQL('schedules').insert(item).promise($);
		$.callback(view(item));
	}
});

NEWACTION('Schedules|remove', {
	name: 'Remove a scheduled prompt',
	params: '*id',
	action: async function($) {
		await NOSQL('schedules').remove().where('id', $.params.id).error(404).promise($);
		$.success();
	}
});

NEWACTION('Schedules|run', {
	name: 'Run a scheduled prompt now',
	summary: 'Starts the prompt now in a new session. The schedule keeps its own times.',
	params: '*id',
	action: async function($) {

		var item = await NOSQL('schedules').read().where('id', $.params.id).error(404).promise($);

		MODS.schedules.fire(item, function(err, session) {
			if (err)
				$.invalid(err);
			else
				$.callback({ sessionid: session.id });
		});
	}
});
