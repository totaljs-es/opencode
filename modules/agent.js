// The agent loop: prompt -> model -> tool calls -> model -> ... until the model answers without tools.
// Events go to the interface through FUNC.emit(); finished parts are stored in NoSQL.

exports.id = 'agent';

// Tools shown to the model: the name, the action that runs it and whether it only reads.
// The definition comes from the action itself (toAITool()).
var TOOLS = {
	read: { action: 'Tools|read', readonly: true },
	glob: { action: 'Tools|glob', readonly: true },
	grep: { action: 'Tools|grep', readonly: true },
	write: { action: 'Tools|write' },
	edit: { action: 'Tools|edit' },
	bash: { action: 'Tools|bash' }
};

exports.tools = TOOLS;

// Definitions for the model: the arguments are flattened (the model sends { path }, the action receives { input: { path } })
exports.definitions = function() {
	var output = [];
	for (var name in TOOLS) {
		var action = F.actions[TOOLS[name].action];
		if (!action)
			continue;
		var meta = action.toAITool();
		var schema = meta.inputSchema.properties.input || { type: 'object', properties: {} };
		output.push({ type: 'function', function: { name: name, description: meta.description, parameters: { type: 'object', properties: schema.properties || {}, required: schema.required || [] } } });
	}
	return output;
};

function system(run) {
	var text = MAIN.base;
	text += '\nWorking directory: {0}\nPlatform: {1}\nDate: {2}\n'.format(run.root, Total.Os.platform(), new Date().format('yyyy-MM-dd'));
	return text;
}

// Converts the stored parts of a session into the messages of the provider
function history(messages, parts) {

	var output = [];
	var byid = {};

	for (var part of parts) {
		if (!byid[part.messageid])
			byid[part.messageid] = [];
		byid[part.messageid].push(part);
	}

	for (var message of messages) {

		var items = (byid[message.id] || []).sort((a, b) => a.seq - b.seq);

		if (message.role === 'user') {
			var text = '';
			for (var item of items) {
				if (item.type === 'text')
					text += item.data.text;
			}
			output.push({ role: 'user', content: text });
			continue;
		}

		var content = '';
		var calls = [];
		var results = [];

		var flush = function() {
			if (!content && !calls.length)
				return;
			var msg = { role: 'assistant', content: content || null };
			if (calls.length)
				msg.tool_calls = calls;
			output.push(msg);
			for (var result of results)
				output.push(result);
			content = '';
			calls = [];
			results = [];
		};

		for (var part of items) {
			if (part.type === 'text')
				content += part.data.text;
			else if (part.type === 'tool') {
				calls.push({ id: part.data.call, type: 'function', function: { name: part.data.tool, arguments: JSON.stringify(part.data.input || {}) } });
				results.push({ role: 'tool', tool_call_id: part.data.call, content: part.data.error ? ('Error: ' + part.data.error) : (part.data.output || '') });
			} else if (part.type === 'step')
				flush();
		}

		flush();
	}

	return output;
}

exports.history = history;

// Starts a run. The user message is already stored. callback(err) is called when the run ends.
exports.run = function(session, project, message, callback) {

	var run = {
		sessionid: session.id,
		projectid: project.id,
		root: project.path,
		autoaccept: !!session.autoaccept,
		aborted: false,
		steps: 0,
		max: session.maxsteps || CONF.maxsteps,
		model: session.model,
		parts: {},
		seq: 0,
		open: {},
		messages: [],
		ai: null
	};

	MAIN.running[session.id] = run;

	function finish(status, error) {
		delete MAIN.running[session.id];
		NOSQL('sessions').modify({ status: status, dtupdated: NOW }).where('id', session.id).callback(NOOP);
		FUNC.emit(session.id, 'session.status', { status: status });
		if (error)
			FUNC.emit(session.id, 'error', { message: error, retry: false });
		callback && callback(error || null);
	}

	function fail(error) {
		closeparts(run);
		finish('error', error);
	}

	FUNC.emit(session.id, 'session.status', { status: 'running' });
	NOSQL('sessions').modify({ status: 'running', dtupdated: NOW }).where('id', session.id).callback(NOOP);

	// The assistant message of this run
	var assistant = { id: UID(), sessionid: session.id, role: 'assistant', model: session.model, dtcreated: new Date() };
	run.message = assistant;
	NOSQL('messages').insert(assistant).callback(NOOP);
	FUNC.emit(session.id, 'message.created', { message: assistant });

	NOSQL('messages').find().where('sessionid', session.id).sort('dtcreated').callback(function(err, messages) {
		NOSQL('parts').find().where('sessionid', session.id).sort('dtcreated').callback(function(err, parts) {

			// The new assistant message has no parts yet: it is not part of the history
			messages = messages.filter(m => m.id !== assistant.id);

			run.messages = history(messages, parts);
			step(run, finish, fail);
		});
	});
};

function step(run, finish, fail) {

	if (run.aborted) {
		closeparts(run);
		finish('aborted');
		return;
	}

	if (run.steps >= run.max) {
		closeparts(run);
		finish('error', '@(Step limit reached)');
		return;
	}

	run.steps++;

	var ai = AIMODEL(run.model);
	ai.payload.messages = [{ role: 'system', content: system(run) }].concat(run.messages);
	ai.payload.tools = exports.definitions();
	run.ai = ai;

	ai.stream(function(e) {
		if (run.aborted)
			return;
		if (e.type === 'content')
			delta(run, 'text', e.delta);
		else if (e.type === 'thinking')
			delta(run, 'reasoning', e.delta);
		else if (e.type === 'tool_start')
			toolstart(run, e.tool);
	});

	ai.callback(function(err, output) {

		run.ai = null;

		if (run.aborted) {
			closeparts(run);
			finish('aborted');
			return;
		}

		if (err) {
			fail(typeof(err) === 'string' ? err : (err.message || 'Model error'));
			return;
		}

		closeparts(run);

		var tools = output.tools || [];
		var stepdata = { tokens: output.usage || null, finish: tools.length ? 'tools' : 'stop' };
		addpart(run, 'step', stepdata, true);

		// The assistant message of this step for the next request
		var msg = { role: 'assistant', content: output.content || null };
		if (tools.length)
			msg.tool_calls = tools.map(t => ({ id: t.id, type: 'function', function: { name: t.name, arguments: JSON.stringify(t.arguments || {}) } }));
		run.messages.push(msg);

		if (!tools.length) {
			finish('idle');
			return;
		}

		runtools(run, tools, function() {
			step(run, finish, fail);
		});
	});
}

// Opens a part, or appends to the open part of the same type
function delta(run, type, text) {

	var part = run.open[type];

	if (!part) {
		part = addpart(run, type, { text: '' }, false);
		run.open[type] = part;
	}

	part.data.text += text;
	FUNC.emit(run.sessionid, 'part.delta', { partid: part.id, text: text });
}

function addpart(run, type, data, closed) {

	var part = { id: UID(), messageid: run.message.id, sessionid: run.sessionid, type: type, data: data, dtcreated: NOW, seq: run.seq++ };

	FUNC.emit(run.sessionid, 'part.created', { part: part });

	if (closed)
		storepart(run, part);

	return part;
}

function storepart(run, part) {
	NOSQL('parts').insert(part).callback(NOOP);
	FUNC.emit(run.sessionid, 'part.closed', { partid: part.id });
}

function closeparts(run) {
	for (var type in run.open) {
		storepart(run, run.open[type]);
		delete run.open[type];
	}
}

function toolstart(run, tool) {
	// The model started a call: show it as pending until the arguments are complete
	var part = addpart(run, 'tool', { call: tool.id, tool: tool.name, input: {}, status: 'pending' }, false);
	run.parts[tool.id] = part;
}

function runtools(run, tools, callback) {

	tools.wait(function(tool, next) {

		if (run.aborted) {
			next();
			return;
		}

		var part = run.parts[tool.id];

		if (!part) {
			part = addpart(run, 'tool', { call: tool.id, tool: tool.name }, false);
			run.parts[tool.id] = part;
		}

		part.data.input = tool.arguments || {};

		function result(status, output, error) {
			part.data.status = status;
			part.data.output = output || '';
			part.data.error = error || '';
			FUNC.emit(run.sessionid, 'part.updated', { part: part });
			storepart(run, part);
			run.messages.push({ role: 'tool', tool_call_id: tool.id, content: error ? ('Error: ' + error) : (output || '') });
			next();
		}

		var meta = TOOLS[tool.name];

		if (!meta) {
			result('error', '', 'Unknown tool: ' + tool.name);
			return;
		}

		MODS.permissions.check(run, tool.name, part.data.input, function(reply, reason) {

			if (reply !== 'allow') {
				result('denied', '', reason || '@(Denied)');
				return;
			}

			part.data.status = 'running';
			FUNC.emit(run.sessionid, 'part.updated', { part: part });

			var user = { id: 'agent', sa: true, root: run.root, sessionid: run.sessionid, projectid: run.projectid };

			ACTION(meta.action, part.data.input).user(user).callback(function(err, response) {
				if (run.aborted)
					next();
				else if (err)
					result('error', '', (err.items && err.items[0] && err.items[0].error) || err.toString());
				else
					result('done', typeof(response) === 'string' ? response : JSON.stringify(response));
			});
		});

	}, callback);
}

exports.abort = function(sessionid) {

	var run = MAIN.running[sessionid];
	if (!run)
		return false;

	run.aborted = true;
	MODS.permissions.cancel(sessionid);

	if (run.ai && run.ai.options.abort)
		run.ai.options.abort();

	for (var child of (MAIN.children[sessionid] || []))
		child.kill();

	return true;
};
