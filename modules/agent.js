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
	bash: { action: 'Tools|bash' },
	patch: { action: 'Tools|patch' },
	fetch: { action: 'Tools|fetch', readonly: true },
	todo: { action: 'Tools|todo' },
	ask: { action: 'Tools|ask' },
	skill: { action: 'Tools|skill', readonly: true }
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

	var instructions = MODS.instructions.text(run.root);
	if (instructions)
		text += '\nInstructions of this project (AGENTS.md):\n' + instructions + '\n';

	var skills = MODS.instructions.skills(run.root);
	if (skills.length) {
		text += '\nSkills of this project. Load one with the skill tool when it applies:\n';
		for (var skill of skills)
			text += '- {0}: {1}\n'.format(skill.name, skill.description);
	}

	return text;
}

// Rough size of the request in tokens
function estimate(messages) {
	var size = 0;
	for (var m of messages)
		size += (m.content ? m.content.length : 0) + (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0);
	return Math.ceil(size / 4);
}

// Level 1 of compaction: the output of old tool calls becomes one line. The stored history is not touched.
function trimoutput(messages, keep) {
	var count = 0;
	for (var i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role === 'tool' && ++count > keep && messages[i].content.length > 200)
			messages[i] = { role: 'tool', tool_call_id: messages[i].tool_call_id, content: '[output omitted: {0} characters]'.format(messages[i].content.length) };
	}
}

// Level 2: the older turns become a summary written by the model of the session. callback(err)
function summarize(run, callback) {

	var cut = Math.max(run.messages.length - 8, 0);

	// Never separate a tool call from its results
	while (cut > 0 && run.messages[cut].role === 'tool')
		cut--;

	if (cut < 2) {
		callback();
		return;
	}

	var older = run.messages.slice(0, cut);
	var transcript = older.map(m => (m.role + ': ' + (m.content || (m.tool_calls ? JSON.stringify(m.tool_calls) : ''))).substring(0, 1500)).join('\n');

	var ai = AIMODEL(run.model);
	ai.payload.messages = [
		{ role: 'system', content: 'Summarize the conversation for an assistant that continues the work. Keep goals, decisions, files changed and open problems. Under 300 words.' },
		{ role: 'user', content: transcript }
	];

	ai.callback(function(err, output) {
		if (err || !output || !output.content) {
			callback();
			return;
		}
		run.messages = [{ role: 'user', content: 'Summary of the earlier conversation:\n' + output.content }].concat(run.messages.slice(cut));
		addpart(run, 'compaction', { removed: older.length, summary: output.content }, true);
		callback();
	});
}

function compact(run, callback) {

	// The window of the model when it is known, with room for the answer; otherwise the configured limit
	var meta = (MAIN.modelmeta && MAIN.modelmeta[run.model]) || {};
	var limit = meta.context ? Math.floor(meta.context * 0.8) : CONF.contextlimit;

	if (estimate(run.messages) <= limit) {
		callback();
		return;
	}

	trimoutput(run.messages, 6);

	if (estimate(run.messages) <= limit) {
		callback();
		return;
	}

	summarize(run, callback);
}

function retryable(err) {
	return typeof(err) === 'string' && /^(429|5\d\d)\b|ECONNRESET|ETIMEDOUT|ECONNREFUSED|socket hang up|network|fetch failed|Timeout/i.test(err);
}

// The signature that Gemini 3 asks to receive back with a function call
function withsignature(call, signature) {
	if (signature)
		call.thoughtSignature = signature;
	return call;
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
				calls.push(withsignature({ id: part.data.call, type: 'function', function: { name: part.data.tool, arguments: JSON.stringify(part.data.input || {}) } }, part.data.thoughtSignature));
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
		attempts: 0,
		denials: 0,
		open: {},
		messages: [],
		ai: null
	};

	MAIN.running[session.id] = run;

	function finish(status, error) {
		delete MAIN.running[session.id];
		NOSQL('sessions').modify({ status: status, dtupdated: NOW }).where('id', session.id).callback(NOOP);

		// The error comes first so that a client that stops at the final status has already seen it
		if (error)
			FUNC.emit(session.id, 'error', { message: error, retry: false });

		FUNC.emit(session.id, 'session.status', { status: status });
		callback && callback(error || null);
	}

	function fail(error) {
		closeparts(run);
		finish('error', error);
	}

	FUNC.emit(session.id, 'session.status', { status: 'running' });
	NOSQL('sessions').modify({ status: 'running', dtupdated: NOW }).where('id', session.id).callback(NOOP);

	// The assistant message of this run
	var assistant = { id: UID(), sessionid: session.id, role: 'assistant', model: session.model, dtcreated: FUNC.stamp() };
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

	// A model that keeps trying what the user rejected is stopped: the user decides how to continue
	if (run.denials >= 3) {
		closeparts(run);
		addpart(run, 'text', { text: 'Stopped: the last 3 actions were rejected. Tell me how you want to continue.' }, true);
		finish('idle');
		return;
	}

	run.steps++;

	compact(run, function() {
		request(run, finish, fail);
	});
}

function request(run, finish, fail) {

	if (run.aborted) {
		closeparts(run);
		finish('aborted');
		return;
	}

	var ai = AIMODEL(run.model);
	ai.payload.messages = [{ role: 'system', content: system(run) }].concat(run.messages);

	// A model that is known not to support tools only chats: the request without tools is better than an error
	var meta = (MAIN.modelmeta && MAIN.modelmeta[run.model]) || {};
	ai.payload.tools = meta.tools === false ? [] : exports.definitions();
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

			var message = typeof(err) === 'string' ? err : (err.message || 'Model error');

			// Transient errors are retried with backoff; the partial answer stays stored
			if (retryable(message) && run.attempts < CONF.retries) {
				run.attempts++;
				run.steps--;
				closeparts(run);
				FUNC.emit(run.sessionid, 'error', { message: message, retry: true });
				setTimeout(() => step(run, finish, fail), CONF.retrybase * Math.pow(2, run.attempts - 1));
				return;
			}

			fail(message);
			return;
		}

		run.attempts = 0;
		closeparts(run);

		var tools = output.tools || [];
		var stepdata = { tokens: output.usage || null, finish: tools.length ? 'tools' : 'stop' };
		addpart(run, 'step', stepdata, true);

		// The assistant message of this step for the next request
		var msg = { role: 'assistant', content: output.content || null };
		if (tools.length)
			msg.tool_calls = tools.map(t => withsignature({ id: t.id, type: 'function', function: { name: t.name, arguments: JSON.stringify(t.arguments || {}) } }, t.thoughtSignature));

		// The signatures travel with the stored call so that the history can send them back
		tools.forEach(function(t) {
			var stored = run.parts[t.id];
			if (stored && t.thoughtSignature)
				stored.data.thoughtSignature = t.thoughtSignature;
		});
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

// The message of an action error, with the field when the input is invalid
function failure(err) {
	if (err && err.items && err.items.length)
		return err.items.map(item => (item.error && item.error !== '@') ? item.error : ('invalid or missing ' + (item.name || 'input'))).join('; ');
	return (err && err.message) || String(err);
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
			output = FUNC.scrub(output);
			error = FUNC.plain(FUNC.scrub(error));
			run.denials = status === 'denied' ? run.denials + 1 : 0;
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
				result('denied', '', reason || 'Denied. Do not try again.');
				return;
			}

			part.data.status = 'running';
			FUNC.emit(run.sessionid, 'part.updated', { part: part });

			var user = { id: 'agent', sa: true, root: run.root, sessionid: run.sessionid, projectid: run.projectid, messageid: run.message.id };

			ACTION(meta.action, part.data.input).user(user).callback(function(err, response) {
				if (run.aborted)
					next();
				else if (err)
					result('error', '', failure(err));
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
