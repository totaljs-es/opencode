// A tiny OpenAI-compatible server for tests and for looking at the interface without a real model.
// It is a standalone tool (plain Node.js), not part of the application.
//
//   node tests/mock-openai.js 8111        serves http://127.0.0.1:8111/v1/chat/completions

var Http = require('http');

// Writes one Chat Completions chunk
function chunk(res, delta, finish) {
	res.write('data: ' + JSON.stringify({ choices: [{ index: 0, delta: delta, finish_reason: finish || null }] }) + '\n\n');
}

// The end of a stream, with the usage when the client asked for it
function end(res, payload) {
	chunk(res, {}, 'stop');
	if (payload.stream_options && payload.stream_options.include_usage)
		res.write('data: ' + JSON.stringify({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 } }) + '\n\n');
	res.end('data: [DONE]\n\n');
}

function words(res, text, done) {
	var arr = text.split(' ');
	var index = 0;
	var timer = setInterval(function() {
		if (index >= arr.length) {
			clearInterval(timer);
			done();
			return;
		}
		chunk(res, { content: (index ? ' ' : '') + arr[index++] });
	}, 15);
}

exports.start = function(port, callback) {

	var server = Http.createServer(function(req, res) {

		var body = '';
		req.on('data', c => body += c);
		req.on('end', function() {

			// Discovery endpoints of Ollama and of the catalogues
			if (req.url === '/api/tags') {
				res.end(JSON.stringify({ models: [{ name: 'tiny:1b', size: 1000 }, { name: 'big:7b', size: 5000 }] }));
				return;
			}

			if (req.url === '/api/show') {
				var which = JSON.parse(body).model;
				res.end(JSON.stringify(which === 'big:7b' ? { capabilities: ['completion', 'tools', 'thinking'], model_info: { 'llama.context_length': 32768 } } : { capabilities: ['completion'], model_info: { 'llama.context_length': 8192 } }));
				return;
			}

			if (req.url === '/v1/models') {
				res.end(JSON.stringify({ data: [
					{ id: 'free-model:free', name: 'Free Model', context_length: 65536, pricing: { prompt: '0', completion: '0' }, supported_parameters: ['tools', 'reasoning', 'temperature'] },
					{ id: 'paid-model', name: 'Paid Model', context_length: 128000, pricing: { prompt: '0.000001', completion: '0.000002' }, supported_parameters: ['temperature'] },
					{ id: 'plain-model' }
				] }));
				return;
			}

			if (req.url !== '/v1/chat/completions') {
				res.statusCode = 404;
				res.end('not found');
				return;
			}

			var payload = JSON.parse(body);
			var messages = payload.messages;
			var last = messages[messages.length - 1];
			var user = messages.filter(m => m.role === 'user').pop();

			exports.requests.push(payload);

			if (user && /fail/.test(user.content)) {
				res.statusCode = 401;
				res.end('{"error":"invalid key"}');
				return;
			}

			res.writeHead(200, { 'content-type': 'text/event-stream' });

			if (last.role === 'tool' && /Written|Task list/.test(last.content)) {
				words(res, 'Done. ' + last.content, () => end(res, payload));
				return;
			}

			if (last.role === 'tool') {
				words(res, 'I read the file. It has ' + (last.content.split('\n').length) + ' lines.', () => end(res, payload));
				return;
			}

			if (user && /write a note/.test(user.content)) {
				words(res, 'I will write the note.', function() {
					chunk(res, { tool_calls: [{ index: 0, id: 'call_w', type: 'function', function: { name: 'write', arguments: '' } }] });
					chunk(res, { tool_calls: [{ index: 0, function: { arguments: JSON.stringify({ path: 'notes.txt', content: 'hello\nfrom Totem\n' }) } }] });
					chunk(res, {}, 'tool_calls');
					res.end('data: [DONE]\n\n');
				});
				return;
			}

			if (user && /plan it/.test(user.content)) {
				words(res, 'Planning.', function() {
					chunk(res, { tool_calls: [{ index: 0, id: 'call_t', type: 'function', function: { name: 'todo', arguments: JSON.stringify({ todos: JSON.stringify([{ text: 'Read the code', status: 'completed' }, { text: 'Write the feature', status: 'in_progress' }, { text: 'Run the tests', status: 'pending' }]) }) } }] });
					chunk(res, {}, 'tool_calls');
					res.end('data: [DONE]\n\n');
				});
				return;
			}

			if (user && /file/.test(user.content)) {
				words(res, 'Let me look at the file.', function() {
					chunk(res, { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'read', arguments: '' } }] });
					chunk(res, { tool_calls: [{ index: 0, function: { arguments: '{"path":' } }] });
					chunk(res, { tool_calls: [{ index: 0, function: { arguments: '"README.md"}' } }] });
					chunk(res, {}, 'tool_calls');
					res.end('data: [DONE]\n\n');
				});
				return;
			}

			words(res, 'Hello from the mock model. You said: ' + (user ? user.content : ''), () => end(res, payload));
		});
	});

	exports.requests = [];
	server.listen(port, '127.0.0.1', () => callback && callback(server));
	return server;
};

if (require.main === module)
	exports.start(parseInt(process.argv[2] || '8111'), () => console.log('mock model on http://127.0.0.1:' + (process.argv[2] || '8111') + '/v1'));
