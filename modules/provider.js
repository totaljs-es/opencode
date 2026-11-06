// Model providers. A provider is configuration: its `kind` picks the request format and the stream parser of the framework.
// Phase 1 implements `openai` (Chat Completions: OpenAI, OpenRouter, Ollama and every compatible server).

exports.id = 'provider';

// Called by AIMODEL(...) through NEWAIMODEL(name, config, exports.openai)
exports.openai = function(ai, callback) {

	var config = ai.config;
	var payload = { model: config.model, messages: ai.payload.messages, stream: true, stream_options: { include_usage: true } };

	if (ai.payload.tools && ai.payload.tools.length)
		payload.tools = ai.payload.tools;

	var url = new URL((config.url || '').replace(/\/+$/, '') + '/chat/completions');
	var lib = url.protocol === 'https:' ? Total.Https : Total.Http;
	var body = JSON.stringify(payload);
	var headers = { 'content-type': 'application/json', 'accept': 'text/event-stream', 'content-length': Buffer.byteLength(body) };

	if (config.key)
		headers.authorization = 'Bearer ' + config.key;

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

		var parser = AIPARSER('openai_chat');

		parser.on('*', function(e) {
			ai.options.stream && ai.options.stream(e);
		});

		// The usage of the request arrives in the last chunk: the parser of the framework does not keep it
		var usage = null;
		var tail = '';

		res.on('data', function(chunk) {

			parser.write(chunk);

			tail += chunk.toString('utf8');
			var lines = tail.split('\n');
			tail = lines.pop();

			for (var line of lines) {
				if (line.indexOf('data:') === 0 && line.indexOf('"usage"') !== -1) {
					try {
						var u = JSON.parse(line.substring(5).trim()).usage;
						if (u && (u.prompt_tokens || u.completion_tokens))
							usage = { input: u.prompt_tokens || 0, output: u.completion_tokens || 0 };
					} catch (e) {}
				}
			}
		});

		res.on('end', function() {
			var output = parser.end();
			if (usage)
				output.usage = usage;
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
};
