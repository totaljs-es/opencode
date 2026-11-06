// Model providers. A provider is configuration: its `kind` picks the request format and the stream parser of the framework.
//
//   openai      Chat Completions (OpenAI, OpenRouter, Ollama, llama.cpp, LM Studio and every compatible server)
//   anthropic   Messages API
//   gemini      generateContent with streaming
//
// The conversation is kept in the Chat Completions format (system, user, assistant with tool_calls, tool). Each kind converts it
// for its own API; the answer comes back through the parser of the framework as { content, thinking, tools, usage }.

exports.id = 'provider';

var MAXTOKENS = 8192;

// Sends one streaming request. spec: { url, headers, body, parser, sniff(object, state) } where sniff reads from every event of the
// stream what the parser of the framework does not keep (usage, signatures). It fills state.usage and state.calls.
function stream(ai, callback, spec) {

	var url = new URL(spec.url);
	var lib = url.protocol === 'https:' ? Total.Https : Total.Http;
	var body = JSON.stringify(spec.body);
	var headers = Object.assign({ 'content-type': 'application/json', 'accept': 'text/event-stream', 'content-length': Buffer.byteLength(body) }, spec.headers);
	var finished = false;

	function done(err, response) {
		if (!finished) {
			finished = true;
			callback(err, response);
		}
	}

	var req = lib.request({ protocol: url.protocol, hostname: url.hostname, port: url.port, path: url.pathname + url.search, method: 'POST', headers: headers }, function(res) {

		if (res.statusCode >= 400) {
			var error = '';
			res.on('data', chunk => error += chunk);
			res.on('end', () => done('{0}: {1}'.format(res.statusCode, error.substring(0, 500))));
			return;
		}

		var parser = AIPARSER(spec.parser);

		parser.on('*', function(e) {
			ai.options.stream && ai.options.stream(e);
		});

		// The usage of the request is in the stream: the parser of the framework does not keep it
		var state = { usage: null, calls: [] };
		var tail = '';

		res.on('data', function(chunk) {

			parser.write(chunk);

			tail += chunk.toString('utf8');
			var lines = tail.split('\n');
			tail = lines.pop();

			for (var line of lines) {
				if (line.indexOf('data:') === 0) {
					try {
						spec.sniff(JSON.parse(line.substring(5).trim()), state);
					} catch (e) {}
				}
			}
		});

		res.on('end', function() {
			var output = parser.end();

			if (state.usage)
				output.usage = state.usage;

			// Gemini 3 asks for the signature of a function call to come back with it
			(output.tools || []).forEach(function(tool, index) {
				if (state.calls[index])
					tool.thoughtSignature = state.calls[index];
			});

			done(null, output);
		});

		res.on('error', err => done(err.message));
	});

	ai.options.abort = function() {
		done('aborted');
		req.destroy();
	};

	req.on('error', err => done(err.message));
	req.end(body);
}

function base(config) {
	return (config.url || '').replace(/\/+$/, '');
}

function json(text) {
	try {
		return JSON.parse(text || '{}');
	} catch (e) {
		return {};
	}
}

// ---------------------------------------------------------------------------------------------------------------------
// OpenAI Chat Completions

exports.openai = function(ai, callback) {

	var config = ai.config;
	// The signatures of Gemini function calls are not part of this format
	var messages = ai.payload.messages.map(function(m) {
		if (!m.tool_calls)
			return m;
		return Object.assign({}, m, { tool_calls: m.tool_calls.map(c => ({ id: c.id, type: c.type, function: c.function })) });
	});

	var body = { model: config.model, messages: messages, stream: true, stream_options: { include_usage: true } };

	if (ai.payload.tools && ai.payload.tools.length)
		body.tools = ai.payload.tools;

	// How much the model thinks: none, low, medium or high. Empty leaves the default of the model.
	if (['none', 'low', 'medium', 'high'].indexOf(ai.payload.reasoning) !== -1)
		body.reasoning_effort = ai.payload.reasoning;

	stream(ai, callback, {
		url: base(config) + '/chat/completions',
		headers: config.key ? { authorization: 'Bearer ' + config.key } : {},
		body: body,
		parser: 'openai_chat',
		sniff: function(obj, state) {
			if (obj.usage)
				state.usage = { input: obj.usage.prompt_tokens || 0, output: obj.usage.completion_tokens || 0 };
		}
	});
};

// ---------------------------------------------------------------------------------------------------------------------
// Anthropic Messages API

// Chat Completions messages -> { system, messages } of the Messages API
exports.toanthropic = function(messages) {

	var system = [];
	var output = [];

	for (var m of messages) {

		if (m.role === 'system') {
			system.push(m.content);
			continue;
		}

		if (m.role === 'user') {
			output.push({ role: 'user', content: m.content || '' });
			continue;
		}

		if (m.role === 'assistant') {

			var blocks = [];

			if (m.content)
				blocks.push({ type: 'text', text: m.content });

			for (var call of (m.tool_calls || []))
				blocks.push({ type: 'tool_use', id: call.id, name: call.function.name, input: json(call.function.arguments) });

			if (blocks.length)
				output.push({ role: 'assistant', content: blocks });

			continue;
		}

		// The results of the tools of one step go together in one user message
		var block = { type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content || '' };
		var last = output[output.length - 1];

		if (last && last.role === 'user' && Array.isArray(last.content) && last.content[0].type === 'tool_result')
			last.content.push(block);
		else
			output.push({ role: 'user', content: [block] });
	}

	return { system: system.join('\n'), messages: output };
};

exports.anthropic = function(ai, callback) {

	var config = ai.config;
	var converted = exports.toanthropic(ai.payload.messages);
	var body = { model: config.model, max_tokens: MAXTOKENS, stream: true, messages: converted.messages };

	if (converted.system)
		body.system = converted.system;

	if (ai.payload.tools && ai.payload.tools.length)
		body.tools = ai.payload.tools.map(t => ({ name: t.function.name, description: t.function.description, input_schema: t.function.parameters }));

	stream(ai, callback, {
		url: base(config) + '/v1/messages',
		headers: { 'x-api-key': config.key || '', 'anthropic-version': '2023-06-01' },
		body: body,
		parser: 'anthropic',
		sniff: function(obj, state) {
			if (obj.type === 'message_start' && obj.message && obj.message.usage)
				state.usage = Object.assign(state.usage || { input: 0, output: 0 }, { input: obj.message.usage.input_tokens || 0 });
			else if (obj.type === 'message_delta' && obj.usage)
				state.usage = Object.assign(state.usage || { input: 0, output: 0 }, { output: obj.usage.output_tokens || 0 });
		}
	});
};

// ---------------------------------------------------------------------------------------------------------------------
// Gemini generateContent

// Parameters of a tool in the subset of JSON Schema that Gemini accepts
function geminischema(schema) {
	var out = {};
	for (var key in schema) {
		if (key === 'additionalProperties')
			continue;
		out[key] = key === 'properties' ? Object.keys(schema.properties || {}).reduce(function(map, name) {
			map[name] = geminischema(schema.properties[name]);
			return map;
		}, {}) : schema[key];
	}
	return out;
}

// Chat Completions messages -> { system, contents } of generateContent
exports.togemini = function(messages) {

	var system = [];
	var contents = [];
	var names = {};

	for (var m of messages) {

		if (m.role === 'system') {
			system.push(m.content);
			continue;
		}

		if (m.role === 'user') {
			contents.push({ role: 'user', parts: [{ text: m.content || '' }] });
			continue;
		}

		if (m.role === 'assistant') {

			var parts = [];

			if (m.content)
				parts.push({ text: m.content });

			for (var call of (m.tool_calls || [])) {
				names[call.id] = call.function.name;
				var part = { functionCall: { name: call.function.name, args: json(call.function.arguments) } };
				if (call.thoughtSignature)
					part.thoughtSignature = call.thoughtSignature;
				parts.push(part);
			}

			if (parts.length)
				contents.push({ role: 'model', parts: parts });

			continue;
		}

		var part = { functionResponse: { name: names[m.tool_call_id] || 'tool', response: { output: m.content || '' } } };
		var last = contents[contents.length - 1];

		if (last && last.role === 'user' && last.parts[0].functionResponse)
			last.parts.push(part);
		else
			contents.push({ role: 'user', parts: [part] });
	}

	return { system: system.join('\n'), contents: contents };
};

exports.gemini = function(ai, callback) {

	var config = ai.config;
	var converted = exports.togemini(ai.payload.messages);
	var body = { contents: converted.contents };

	if (converted.system)
		body.systemInstruction = { parts: [{ text: converted.system }] };

	if (ai.payload.tools && ai.payload.tools.length)
		body.tools = [{ functionDeclarations: ai.payload.tools.map(t => ({ name: t.function.name, description: t.function.description, parameters: geminischema(t.function.parameters) })) }];

	stream(ai, callback, {
		url: base(config) + '/v1beta/models/' + encodeURIComponent(config.model) + ':streamGenerateContent?alt=sse',
		headers: { 'x-goog-api-key': config.key || '' },
		body: body,
		parser: 'gemini',
		sniff: function(obj, state) {

			if (obj.usageMetadata)
				state.usage = { input: obj.usageMetadata.promptTokenCount || 0, output: obj.usageMetadata.candidatesTokenCount || 0 };

			// The function calls in the order they arrive, each with its signature when it has one
			for (var candidate of (obj.candidates || [])) {
				for (var part of ((candidate.content && candidate.content.parts) || [])) {
					if (part.functionCall)
						state.calls.push(part.thoughtSignature || null);
				}
			}
		}
	});
};

// The function that sends the requests of a provider kind
exports.byKind = function(kind) {
	return exports[kind === 'anthropic' || kind === 'gemini' ? kind : 'openai'];
};
