// A tiny MCP server over stdio for the tests (plain Node.js, not part of the application).

var buffer = '';

// The calls that reach the Forge tools (only when the server runs in the process of the test)
exports.calls = [];

function send(msg) {
	process.stdout.write(JSON.stringify(Object.assign({ jsonrpc: '2.0' }, msg)) + '\n');
}

exports.handle = function(msg) {

	if (msg.method === 'initialize')
		return { result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'mock', version: '1' } } };

	if (msg.method === 'tools/list')
		return { result: { tools: [
			{ name: 'echo', description: 'Echoes a text', inputSchema: { type: 'object', properties: { text: { type: 'string', description: 'The text' } }, required: ['text'] } },
			{ name: 'fail', description: 'Always fails', inputSchema: { type: 'object', properties: {} } },
			{ name: 'Forge_search', description: 'Search the pages of Forge', inputSchema: { type: 'object', properties: { input: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } }, required: ['input'] } },
			{ name: 'Forge_page', description: 'Read a page of Forge', inputSchema: { type: 'object', properties: { input: { type: 'object', properties: { section: { type: 'string' }, slug: { type: 'string' } }, required: ['section', 'slug'] } }, required: ['input'] } }
		] } };

	if (msg.method === 'tools/call') {
		if (msg.params.name === 'echo')
			return { result: { content: [{ type: 'text', text: 'echo: ' + msg.params.arguments.text }] } };
		if (msg.params.name === 'Forge_search') {
			exports.calls.push({ tool: 'search', input: msg.params.arguments.input });
			return { result: { content: [{ type: 'text', text: JSON.stringify({ query: msg.params.arguments.input.query, count: 3, results: [
				{ section: 'jcomponent', slug: 'custom-component', kind: 'recipe', title: 'Write a custom jComponent', description: 'Register a reusable component with COMPONENT()', url: 'https://forge.totaljs.es/en/jcomponent/custom-component/' },
				{ section: 'jcomponent', slug: 'component-lifecycle', kind: 'recipe', title: 'Component lifecycle', description: 'make, setter and destroy', url: 'https://forge.totaljs.es/en/jcomponent/component-lifecycle/' },
				{ section: 'docs', slug: 'extra-page', kind: 'guide', title: 'Extra page', description: 'Another page that may help', url: 'https://forge.totaljs.es/en/docs/extra-page/' }
			] }) }] } };
		}
		if (msg.params.name === 'Forge_page') {
			exports.calls.push({ tool: 'page', input: msg.params.arguments.input });
			return { result: { content: [{ type: 'text', text: JSON.stringify({ title: msg.params.arguments.input.slug, url: 'https://forge.totaljs.es/en/jcomponent/' + msg.params.arguments.input.slug + '/', markdown: 'PAGE ' + msg.params.arguments.input.slug + ': a component is declared with `COMPONENT(name, config, declaration)`.' }) }] } };
		}
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
