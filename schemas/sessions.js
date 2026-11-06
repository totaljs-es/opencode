NEWACTION('Sessions|list', {
	name: 'List sessions of a project',
	query: '*projectid',
	action: async function($) {
		var items = await NOSQL('sessions').find().where('projectid', $.query.projectid).sort('dtupdated_desc').promise($);
		$.callback(items);
	}
});

NEWACTION('Sessions|create', {
	name: 'Create a session',
	input: '*projectid:String, name:String, model:String, autoaccept:Boolean, reasoning:String',
	action: async function($, model) {
		await NOSQL('projects').read().where('id', model.projectid).error(404).promise($);
		// A name given by the user stays; without one the session is named after its first prompt
		var name = (model.name || '').trim().substring(0, 80);
		var item = { id: UID(), projectid: model.projectid, name: name || 'New session', named: !!name, model: model.model || '', status: 'idle', autoaccept: !!model.autoaccept, reasoning: model.reasoning || '', maxsteps: CONF.maxsteps, dtcreated: NOW, dtupdated: NOW };
		await NOSQL('sessions').insert(item).promise($);
		$.callback(item);
	}
});

NEWACTION('Sessions|update', {
	name: 'Rename a session',
	params: '*id',
	input: '*name:String',
	action: async function($, model) {

		var session = await NOSQL('sessions').read().where('id', $.params.id).error(404).promise($);
		var name = model.name.trim().substring(0, 80);

		if (!name) {
			$.invalid('@(The name is empty)');
			return;
		}

		session.name = name;
		session.named = true;
		await NOSQL('sessions').modify({ name: name, named: true }).where('id', session.id).promise($);
		FUNC.emit(session.id, 'session.updated', { session: session });
		$.success();
	}
});

NEWACTION('Sessions|read', {
	name: 'Read a session',
	params: '*id',
	action: async function($) {
		var item = await NOSQL('sessions').read().where('id', $.params.id).error(404).promise($);
		$.callback(item);
	}
});

NEWACTION('Sessions|remove', {
	name: 'Remove a session',
	params: '*id',
	action: async function($) {
		var id = $.params.id;
		MODS.agent.abort(id);
		await new Promise(resolve => MODS.snapshots.clear(id, resolve));
		await new Promise(resolve => MODS.attachments.clear(id, resolve));
		await NOSQL('todos').remove().where('sessionid', id).promise($);
		await NOSQL('parts').remove().where('sessionid', id).promise($);
		await NOSQL('messages').remove().where('sessionid', id).promise($);
		await NOSQL('sessions').remove().where('id', id).promise($);
		$.success();
	}
});

NEWACTION('Sessions|messages', {
	name: 'Messages of a session with their parts',
	params: '*id',
	action: async function($) {
		var id = $.params.id;
		var messages = await NOSQL('messages').find().where('sessionid', id).sort('dtcreated').promise($);
		var parts = await NOSQL('parts').find().where('sessionid', id).sort('dtcreated').promise($);
		var byid = {};
		for (var part of parts) {
			if (!byid[part.messageid])
				byid[part.messageid] = [];
			byid[part.messageid].push(part);
		}
		for (var message of messages)
			message.parts = (byid[message.id] || []).sort((a, b) => a.seq - b.seq);
		$.callback(messages);
	}
});

NEWACTION('Sessions|prompt', {
	name: 'Send a prompt to the agent',
	params: '*id',
	input: '*text:String, model:String, autoaccept:Boolean, reasoning:String, attachments:[Object]',
	action: async function($, model) {

		var session = await NOSQL('sessions').read().where('id', $.params.id).error(404).promise($);

		if (MAIN.running[session.id]) {
			$.invalid('@(The session is running)');
			return;
		}

		var project = await NOSQL('projects').read().where('id', session.projectid).error(404).promise($);

		if (model.model)
			session.model = model.model;

		// A Boolean input is false when it is missing: only an explicit value changes the session
		if ($.body && $.body.autoaccept !== undefined)
			session.autoaccept = !!model.autoaccept;

		if ($.body && $.body.reasoning !== undefined)
			session.reasoning = model.reasoning || '';

		if (!session.model || !F.aimodels[session.model]) {
			$.invalid('@(Choose a model first)');
			return;
		}

		await NOSQL('sessions').modify({ model: session.model, autoaccept: session.autoaccept, reasoning: session.reasoning || '' }).where('id', session.id).promise($);

		// The files of the prompt: images and text files
		var files = await new Promise(resolve => MODS.attachments.save(session.id, model.attachments, (err, saved) => resolve(err ? { error: err } : saved)));

		if (files.error) {
			$.invalid(files.error);
			return;
		}

		// A command of the project: /name arguments. The conversation shows what the user typed, the model gets the expanded text.
		var command = MODS.commands.expand(project.path, model.text);
		// The first prompt of a session that has no name of the user gives it one
		if (!session.named && (!session.name || session.name === 'New session')) {
			var first = await NOSQL('messages').find().where('sessionid', session.id).take(1).promise($);
			if (!first.length) {
				var title = FUNC.title(model.text);
				if (title) {
					session.name = title;
					await NOSQL('sessions').modify({ name: title }).where('id', session.id).promise($);
					FUNC.emit(session.id, 'session.updated', { session: session });
				}
			}
		}

		var message = { id: UID(), sessionid: session.id, role: 'user', dtcreated: FUNC.stamp() };
		var part = { id: UID(), messageid: message.id, sessionid: session.id, type: 'text', data: { text: model.text }, dtcreated: NOW, seq: 0 };

		if (command)
			part.data.expanded = command.text;

		await NOSQL('messages').insert(message).promise($);
		await NOSQL('parts').insert(part).promise($);

		FUNC.emit(session.id, 'message.created', { message: message });
		FUNC.emit(session.id, 'part.created', { part: part });

		// One part per file, after the text
		for (var i = 0; i < files.length; i++) {
			var filepart = { id: UID(), messageid: message.id, sessionid: session.id, type: 'file', data: files[i], dtcreated: NOW, seq: i + 1 };
			await NOSQL('parts').insert(filepart).promise($);
			FUNC.emit(session.id, 'part.created', { part: filepart });
		}

		MODS.agent.run(session, project, message);
		$.callback({ messageid: message.id });
	}
});

NEWACTION('Sessions|abort', {
	name: 'Stop the agent',
	params: '*id',
	action: function($) {
		MODS.agent.abort($.params.id);
		$.success();
	}
});


NEWACTION('Sessions|diff', {
	name: 'Files changed by the agent in a session',
	params: '*id',
	action: async function($) {
		var session = await NOSQL('sessions').read().where('id', $.params.id).error(404).promise($);
		var project = await NOSQL('projects').read().where('id', session.projectid).error(404).promise($);
		MODS.snapshots.files(session, project, (err, files) => $.callback(files));
	}
});

NEWACTION('Sessions|undo', {
	name: 'Undo the changes of a message and the later ones',
	params: '*id',
	input: '*messageid:String',
	action: async function($, model) {

		if (MAIN.running[$.params.id]) {
			$.invalid('@(The session is running)');
			return;
		}

		var session = await NOSQL('sessions').read().where('id', $.params.id).error(404).promise($);
		var project = await NOSQL('projects').read().where('id', session.projectid).error(404).promise($);

		MODS.snapshots.undo(session, project, model.messageid, function(err, restored) {
			if (err)
				$.invalid(err);
			else
				$.callback(restored);
		});
	}
});

NEWACTION('Sessions|todos', {
	name: 'Task list of a session',
	params: '*id',
	action: async function($) {
		var items = await NOSQL('todos').find().where('sessionid', $.params.id).sort('index').promise($);
		$.callback(items);
	}
});
