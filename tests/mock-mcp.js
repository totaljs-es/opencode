// A tiny MCP server over stdio for the tests (plain Node.js, not part of the application).

var buffer = '';

function send(msg) {
	process.stdout.write(JSON.stringify(Object.assign({ jsonrpc: '2.0' }, msg)) + '\n');
}

exports.handle = function(msg) {

	if (msg.method === 'initialize')
		return { result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'mock', version: '1' } } };

	if (msg.method === 'tools/list')
		return { result: { tools: [
			{ name: 'echo', description: 'Echoes a text', inputSchema: { type: 'object', properties: { text: { type: 'string', description: 'The text' } }, required: ['text'] } },
			{ name: 'fail', description: 'Always fails', inputSchema: { type: 'object', properties: {} } }
		] } };

	if (msg.method === 'tools/call') {
		if (msg.params.name === 'echo')
			return { result: { content: [{ type: 'text', text: 'echo: ' + msg.params.arguments.text }] } };
		return { result: { isError: true, content: [{ type: 'text', text: 'it failed' }] } };
	}

	return msg.id != null ? { error: { code: -32601, message: 'Method not found' } } : null;
};

if (require.main === module) {
	process.stdin.on('data', function(chunk) {
		buffer += chunk.toString('utf8');
		var lines = buffer.split('\n');
		buffer = lines.pop();
		lines.forEach(function(line) {
			if (!line.trim())
				return;
			var msg = JSON.parse(line);
			var answer = exports.handle(msg);
			if (answer && msg.id != null)
				send(Object.assign({ id: msg.id }, answer));
		});
	});
}
