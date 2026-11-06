NEWACTION('Sessions|list', {
	name: 'List sessions of a project',
	summary: 'Lists the sessions of a project, newest first.',
	mcp: true,
	query: '*projectid',
	action: async function($) {
		var items = await NOSQL('sessions').find().where('projectid', $.query.projectid).sort('dtupdated_desc').promise($);

		// Names that an old bug wrote ("[object Object]") become the title of the first prompt, or the default name
		for (var item of items) {
			if (!/^\[object Object\]/.test(item.name || ''))
				continue;
			var title = '';
			var first = await NOSQL('messages').find().where('sessionid', item.id).where('role', 'user').sort('dtcreated').take(1).promise($);
			if (first.length) {
				var part = await NOSQL('parts').find().where('messageid', first[0].id).where('type', 'text').take(1).promise($);
				title = part.length ? FUNC.title(part[0].data.text || '') : '';
			}
			item.name = (title || 'New session') + (/\(fork\)$/.test(item.name) ? ' (fork)' : '');
			item.named = false;
			await NOSQL('sessions').modify({ name: item.name, named: false }).where('id', item.id).promise($);
		}

		$.callback(items);
	}
});

NEWACTION('Sessions|create', {
	name: 'Create a session',
	summary: 'Creates a session in a project. The model is one of the models that Totem lists (provider:model).',
	mcp: true,
	input: '*projectid:String, name:String, model:String, autoaccept:Boolean, reasoning:String',
	action: async function($, model) {
		await NOSQL('projects').read().where('id', model.projectid).error(404).promise($);
		// A name given by the user stays; without one the session is named after its first prompt
		var name = (typeof(($.body || model).name) === 'string' ? model.name : '').trim().substring(0, 80);
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
	summary: 'Reads a session: its status, model and mode.',
	mcp: true,
	params: '*id',
	action: async function($) {
		var item = await NOSQL('sessions').read().where('id', $.params.id).error(404).promise($);
		item.redo = await new Promise(resolve => MODS.snapshots.canredo(item.id, resolve));
		$.callback(item);
	}
});

NEWACTION('Sessions|remove', {
	name: 'Remove a session',
	params: '*id',
	action: async function($) {
		var id = $.params.id;
		MODS.agent.abort(id);
		MODS.jobs.clear(id);
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
	summary: 'Reads the messages of a session with their parts (text, reasoning, tool calls with their output).',
	mcp: true,
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
	summary: 'Sends a prompt to the agent of a session and returns at once; read the session to follow it. A change of files or a command asks the person at the Totem screen unless the session auto-accepts edits. The session can be in mode plan (reads only) or build.',
	mcp: true,
	params: '*id',
	input: '*text:String, model:String, autoaccept:Boolean, reasoning:String, mode:String, attachments:[Object]',
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

		if (($.body || model).mode !== undefined)
			session.mode = model.mode === 'plan' ? 'plan' : 'build';

		if ($.body && $.body.reasoning !== undefined)
			session.reasoning = model.reasoning || '';

		if (!session.model || !F.aimodels[session.model]) {
			$.invalid('@(Choose a model first)');
			return;
		}

		await new Promise(resolve => MODS.snapshots.dropredo(session.id, resolve));
		await NOSQL('sessions').modify({ model: session.model, autoaccept: session.autoaccept, mode: session.mode || 'build', reasoning: session.reasoning || '' }).where('id', session.id).promise($);

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
	summary: 'Stops the agent of a session.',
	mcp: true,
	params: '*id',
	action: function($) {
		MODS.agent.abort($.params.id);
		$.success();
	}
});


NEWACTION('Sessions|diff', {
	name: 'Files changed by the agent in a session',
	summary: 'Lists the files that the agent changed in a session, each with its patch.',
	mcp: true,
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

NEWACTION('Sessions|redo', {
	name: 'Redo the last undo',
	params: '*id',
	action: async function($) {

		if (MAIN.running[$.params.id]) {
			$.invalid('@(The session is running)');
			return;
		}

		var session = await NOSQL('sessions').read().where('id', $.params.id).error(404).promise($);
		var project = await NOSQL('projects').read().where('id', session.projectid).error(404).promise($);

		MODS.snapshots.redo(session, project, function(err, restored) {
			if (err)
				$.invalid(err);
			else
				$.callback(restored);
		});
	}
});

NEWACTION('Sessions|fork', {
	name: 'Copy a session up to a message into a new session',
	params: '*id',
	input: 'messageid:String',
	action: async function($, model) {

		var session = await NOSQL('sessions').read().where('id', $.params.id).error(404).promise($);
		var messages = await NOSQL('messages').find().where('sessionid', session.id).sort('dtcreated').promise($);
		var parts = await NOSQL('parts').find().where('sessionid', session.id).sort('dtcreated').promise($);

		// Up to and including the message that was chosen (all of them without one)
		if (model.messageid) {
			var index = messages.findIndex(m => m.id === model.messageid);
			if (index === -1) {
				$.invalid('@(Message not found)');
				return;
			}
			messages = messages.slice(0, index + 1);
		}

		var copy = Object.assign({}, session, { id: UID(), name: ((session.name || 'New session') + ' (fork)').substring(0, 80), named: true, status: 'idle', dtcreated: NOW, dtupdated: NOW });
		delete copy.redo;
		await NOSQL('sessions').insert(copy).promise($);

		var files = await new Promise(resolve => MODS.attachments.copy(session.id, copy.id, resolve));
		var ids = {};

		for (var message of messages) {
			ids[message.id] = UID();
			await NOSQL('messages').insert(Object.assign({}, message, { id: ids[message.id], sessionid: copy.id })).promise($);
		}

		for (var part of parts) {

			if (!ids[part.messageid])
				continue;

			var data = Object.assign({}, part.data);

			if (part.type === 'file' && files[data.id])
				data.id = files[data.id];

			await NOSQL('parts').insert(Object.assign({}, part, { id: UID(), messageid: ids[part.messageid], sessionid: copy.id, data: data })).promise($);
		}

		$.callback(copy);
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

NEWACTION('Sessions|jobs', {
	name: 'Background commands of a session',
	summary: 'The commands that the agent started in the background in this session, with their state and the end of their output.',
	params: '*id',
	action: function($) {
		$.callback(MODS.jobs.list($.params.id).map(job => ({ id: job.id, command: job.command, status: job.status, output: MODS.jobs.tail(job), dtcreated: job.dtcreated })));
	}
});

NEWACTION('Sessions|jobstop', {
	name: 'Stop a background command',
	params: '*id',
	input: '*job:String',
	action: function($, model) {

		var job = MODS.jobs.get($.params.id, model.job);

		if (!job) {
			$.invalid('@(Job not found)');
			return;
		}

		MODS.jobs.stop(job);
		$.success();
	}
});
