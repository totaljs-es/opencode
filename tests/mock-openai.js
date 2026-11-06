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

// Anthropic stream: one event per line pair
function sse(res, type, data) {
	res.write('event: ' + type + '\ndata: ' + JSON.stringify(Object.assign({ type: type }, data)) + '\n\n');
}

function anthropic(res, payload) {

	var last = payload.messages[payload.messages.length - 1];
	var blocks = Array.isArray(last.content) ? last.content : [];
	var result = blocks.find(b => b.type === 'tool_result');
	var text = typeof(last.content) === 'string' ? last.content : '';

	res.writeHead(200, { 'content-type': 'text/event-stream' });
	sse(res, 'message_start', { message: { id: 'msg_1', role: 'assistant', usage: { input_tokens: 21, output_tokens: 1 } } });
	sse(res, 'content_block_start', { index: 0, content_block: { type: 'text', text: '' } });

	var reply = result ? ('Anthropic saw the result: ' + result.content) : (/file/.test(text) ? 'Let me read it.' : ('Anthropic echo: ' + text));
	sse(res, 'content_block_delta', { index: 0, delta: { type: 'text_delta', text: reply } });
	sse(res, 'content_block_stop', { index: 0 });

	if (!result && /file/.test(text)) {
		sse(res, 'content_block_start', { index: 1, content_block: { type: 'tool_use', id: 'toolu_1', name: 'read', input: {} } });
		sse(res, 'content_block_delta', { index: 1, delta: { type: 'input_json_delta', partial_json: '{"path":' } });
		sse(res, 'content_block_delta', { index: 1, delta: { type: 'input_json_delta', partial_json: '"a.txt"}' } });
		sse(res, 'content_block_stop', { index: 1 });
	}

	sse(res, 'message_delta', { delta: { stop_reason: !result && /file/.test(text) ? 'tool_use' : 'end_turn' }, usage: { output_tokens: 9 } });
	sse(res, 'message_stop', {});
	res.end();
}

function gemini(res, payload) {

	var last = payload.contents[payload.contents.length - 1];
	var response = last.parts.find(p => p.functionResponse);
	var text = last.parts[0].text || '';

	res.writeHead(200, { 'content-type': 'text/event-stream' });

	function send(parts, usage) {
		var data = { candidates: [{ content: { role: 'model', parts: parts } }] };
		if (usage)
			data.usageMetadata = { promptTokenCount: 30, candidatesTokenCount: 7 };
		res.write('data: ' + JSON.stringify(data) + '\n\n');
	}

	if (response)
		send([{ text: 'Gemini saw ' + response.functionResponse.name + ': ' + response.functionResponse.response.output }], true);
	else if (/file/.test(text)) {
		send([{ text: 'Let me read it.' }]);
		send([{ functionCall: { name: 'read', args: { path: 'a.txt' } }, thoughtSignature: 'sig-123' }], true);
	} else
		send([{ text: 'Gemini echo: ' + text }], true);

	res.end();
}

exports.calls = [];

exports.start = function(port, callback) {

	var server = Http.createServer(function(req, res) {

		var body = '';
		req.on('data', c => body += c);
		req.on('end', function() {

			// An MCP server over HTTP
			if (req.url === '/mcp') {
				var rpc = JSON.parse(body);
				var answer = require('./mock-mcp').handle(rpc);
				if (!answer || rpc.id == null) {
					res.statusCode = 202;
					res.end();
					return;
				}
				var reply = JSON.stringify(Object.assign({ jsonrpc: '2.0', id: rpc.id }, answer));
				if (req.headers.accept.indexOf('text/event-stream') !== -1 && rpc.method === 'tools/call') {
					res.writeHead(200, { 'content-type': 'text/event-stream' });
					res.end('event: message\ndata: ' + reply + '\n\n');
				} else {
					res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'sess-1' });
					res.end(reply);
				}
				return;
			}

			// Anthropic and Gemini: the key must arrive in their own header
			if (req.url === '/v1/messages') {
				if (req.headers['x-api-key'] !== 'test-key' || req.headers['anthropic-version'] !== '2023-06-01') {
					res.statusCode = 401;
					res.end('{"error":"bad key"}');
					return;
				}
				var asked = JSON.parse(body);
				exports.calls.push({ kind: 'anthropic', headers: req.headers, body: asked });
				anthropic(res, asked);
				return;
			}

			if (/^\/v1beta\/models\/[^/]+:streamGenerateContent/.test(req.url)) {
				if (req.headers['x-goog-api-key'] !== 'test-key') {
					res.statusCode = 403;
					res.end('{"error":"bad key"}');
					return;
				}
				var request = JSON.parse(body);
				exports.calls.push({ kind: 'gemini', url: req.url, headers: req.headers, body: request });
				gemini(res, request);
				return;
			}

			if (req.url === '/v1/models?limit=100' && req.headers['anthropic-version']) {
				res.end(JSON.stringify({ data: [{ id: 'claude-test', display_name: 'Claude Test', max_input_tokens: 200000 }] }));
				return;
			}

			if (req.url === '/v1beta/models?pageSize=1000') {
				res.end(JSON.stringify({ models: [{ name: 'models/gemini-test', displayName: 'Gemini Test', inputTokenLimit: 1048576, supportedGenerationMethods: ['generateContent'] }, { name: 'models/embed-test', supportedGenerationMethods: ['embedContent'] }] }));
				return;
			}

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

			if (req.url === '/model/info') {
				res.end(JSON.stringify({ data: [
					{ model_name: 'gpt-a', litellm_params: { model: 'openai/gpt-4o' }, model_info: { max_input_tokens: 128000, input_cost_per_token: 0.000001, output_cost_per_token: 0.000002, supports_function_calling: true, supports_reasoning: false } },
					{ model_name: 'gpt-a', litellm_params: { model: 'azure/gpt-4o' }, model_info: { max_input_tokens: 128000 } },
					{ model_name: 'local-b', litellm_params: { model: 'ollama/x' }, model_info: { max_tokens: 8192, input_cost_per_token: 0, output_cost_per_token: 0, supports_function_calling: false } },
					{ model_name: 'unknown-c', model_info: {} }
				] }));
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
