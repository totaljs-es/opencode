require('total5');
require('total5/test');

// Native tests of Totem. They start the application in this process, with a disposable data folder and a scripted model.
// Run: node tests/run.js

const ROOT = Total.Path.join(__dirname, '..');
const TMP = Total.Fs.mkdtempSync(Total.Path.join(Total.Os.tmpdir(), 'totem-test-'));
const PROJECT = Total.Path.join(TMP, 'project');
const PORT = 8097;
const URL = 'http://127.0.0.1:' + PORT + '/api/';

['databases', 'tmp', 'logs', 'project'].forEach(name => Total.Fs.mkdirSync(Total.Path.join(TMP, name)));
Total.Fs.writeFileSync(Total.Path.join(PROJECT, 'a.txt'), 'one\ntwo\nthree\n');
process.chdir(ROOT);

function check(message, ok) {
	Test.print(message, ok ? null : 'failed');
}

function api(schema, data) {
	return new Promise(function(resolve) {
		RESTBuilder.POST(URL, { schema: schema, data: data }).exec(function(err, response) {
			resolve({ err: err, response: response });
		});
	});
}

// The scripted model: every request looks at the last message and answers with the next step of the script
var script = [];
var requests = [];

function fake(ai, callback) {

	requests.push(ai.payload);

	var step = script.shift();
	if (!step) {
		callback('script ended');
		return;
	}

	if (step.wait) {
		ai.options.abort = function() {
			clearTimeout(timer);
			callback('aborted');
		};
		var timer = setTimeout(() => callback(null, { content: 'late', tools: [] }), step.wait);
		return;
	}

	var output = { content: step.content || '', thinking: '', tools: step.tools || [] };

	if (step.content)
		ai.options.stream && ai.options.stream({ type: 'content', delta: step.content, content: step.content });

	for (var tool of output.tools)
		ai.options.stream && ai.options.stream({ type: 'tool_start', tool: { id: tool.id, name: tool.name, arguments: {} } });

	setImmediate(() => callback(null, output));
}

// Collects the events the interface would receive
var events = [];

function until(fn, ms) {
	return new Promise(function(resolve) {
		var started = Date.now();
		var timer = setInterval(function() {
			if (fn() || Date.now() - started > (ms || 5000)) {
				clearInterval(timer);
				resolve(fn());
			}
		}, 20);
	});
}

Test.push('boot', function(next) {

	F.run({ watcher: false, release: false, ip: '127.0.0.1', port: PORT, config: { $dirdatabases: Total.Path.join(TMP, 'databases'), $dirtmp: Total.Path.join(TMP, 'tmp'), $dirlogs: Total.Path.join(TMP, 'logs') } });

	ON('ready', function() {
		NEWAIMODEL('fake', fake);
		FUNC.onevent = (sessionid, type, data) => events.push({ sessionid: sessionid, type: type, data: data });
		check('the application starts', true);
		check('the tools are registered as actions', !!F.actions['Tools|read'] && !!F.actions['Tools|bash']);

		// "ready" is emitted before the server accepts requests: wait for the API
		var started = Date.now();
		var wait = function() {
			api('account').then(function(r) {
				if (r.response && r.response.id) {
					check('the API answers', true);
					next();
				} else if (Date.now() - started > 10000)
					check('the API answers', false);
				else
					setTimeout(wait, 100);
			});
		};
		wait();
	});
});

Test.push('tool definitions', function(next) {
	var defs = MODS.agent.definitions();
	var read = defs.find(d => d.function.name === 'read');
	check('every core tool has a definition', defs.length === 6);
	check('arguments are flattened', read && read.function.parameters.properties.path && read.function.parameters.required.indexOf('path') !== -1);
	check('the descriptions of the fields reach the model', read && !!read.function.parameters.properties.path.description);
	next();
});

Test.push('project boundary', async function(next) {
	check('a path inside the project resolves', !!FUNC.resolve(PROJECT, 'a.txt'));
	check('a new file inside the project resolves', !!FUNC.resolve(PROJECT, 'src/new.js'));
	check('.. is refused', FUNC.resolve(PROJECT, '../x') === null);
	check('an absolute path outside is refused', FUNC.resolve(PROJECT, '/etc/passwd') === null);
	Total.Fs.symlinkSync('/etc', Total.Path.join(PROJECT, 'link'));
	check('a symbolic link that leaves the project is refused', FUNC.resolve(PROJECT, 'link/passwd') === null);
	next();
});

var projectid, sessionid;

Test.push('projects and sessions', async function(next) {
	var r = await api('projects_open', { path: PROJECT });
	projectid = r.response && r.response.id;
	check('a project opens', !!projectid);
	r = await api('projects_open', { path: PROJECT });
	check('opening it again does not duplicate it', r.response.id === projectid);
	r = await api('projects_open', { path: '/nonexistent/folder' });
	check('a missing folder is refused', !!(r.err && r.err.items && r.err.items[0].error));
	r = await api('sessions_create', { projectid: projectid, model: 'fake' });
	sessionid = r.response && r.response.id;
	check('a session is created', !!sessionid);
	next();
});

Test.push('agent run: read, write, answer', async function(next) {

	script = [
		{ content: 'Let me look.', tools: [{ id: 'c1', name: 'read', arguments: { path: 'a.txt' } }] },
		{ tools: [{ id: 'c2', name: 'write', arguments: { path: 'src/b.txt', content: 'hello' } }] },
		{ content: 'Done.' }
	];

	var r = await api('sessions_prompt/' + sessionid, { text: 'do it' });
	check('the prompt is accepted at once', !!(r.response && r.response.messageid));

	// write asks the user: answer once
	var ask = await until(() => events.find(e => e.type === 'permission.ask'));
	check('write asks for permission', !!ask && ask.data.tool === 'write');
	r = await api('permissions_reply/' + ask.data.id, { reply: 'once' });
	check('the reply is accepted', r.response && r.response.success === true);

	var idle = await until(() => events.filter(e => e.type === 'session.status' && e.data.status === 'idle').length > 0);
	check('the session ends idle', idle);
	check('the file was written inside the project', Total.Fs.readFileSync(Total.Path.join(PROJECT, 'src/b.txt'), 'utf8') === 'hello');
	check('read ran without asking', !events.some(e => e.type === 'permission.ask' && e.data.tool === 'read'));

	r = await api('sessions_messages/' + sessionid);
	var assistant = r.response.find(m => m.role === 'assistant');
	var tools = assistant.parts.filter(p => p.type === 'tool');
	check('messages are stored with ordered parts', r.response.length === 2 && assistant.parts[0].type === 'text');
	check('tool parts keep input and output', tools.length === 2 && tools[0].data.output.indexOf('1\tone') !== -1 && tools[1].data.status === 'done');
	check('the second request carried the tool result', requests[1].messages.some(m => m.role === 'tool' && m.content.indexOf('one') !== -1));
	check('the deltas were streamed', events.some(e => e.type === 'part.delta'));
	next();
});

Test.push('permissions', async function(next) {

	events.length = 0;
	script = [{ tools: [{ id: 'd1', name: 'write', arguments: { path: 'c.txt', content: 'x' } }] }, { content: 'Stopped.' }];
	await api('sessions_prompt/' + sessionid, { text: 'write c' });
	var ask = await until(() => events.find(e => e.type === 'permission.ask'));
	await api('permissions_reply/' + ask.data.id, { reply: 'reject' });
	await until(() => events.filter(e => e.type === 'session.status' && e.data.status === 'idle').length > 0);
	check('a rejected write does not happen', !Total.Fs.existsSync(Total.Path.join(PROJECT, 'c.txt')));
	var r = await api('sessions_messages/' + sessionid);
	var denied = r.response[r.response.length - 1].parts.find(p => p.type === 'tool');
	check('the rejection is stored as denied', denied && denied.data.status === 'denied');

	events.length = 0;
	script = [{ tools: [{ id: 'e1', name: 'read', arguments: { path: '../outside' } }] }, { content: 'ok' }];
	await api('sessions_prompt/' + sessionid, { text: 'read outside' });
	await until(() => events.filter(e => e.type === 'session.status' && e.data.status === 'idle').length > 0);
	r = await api('sessions_messages/' + sessionid);
	denied = r.response[r.response.length - 1].parts.find(p => p.type === 'tool');
	check('a path outside the project is denied without asking', denied.data.status === 'denied' && !events.some(e => e.type === 'permission.ask'));
	next();
});

Test.push('bash and abort', async function(next) {

	events.length = 0;
	script = [{ tools: [{ id: 'f1', name: 'bash', arguments: { command: 'pwd; echo hi' } }] }, { content: 'ok' }];
	await api('sessions_prompt/' + sessionid, { text: 'run' });
	var ask = await until(() => events.find(e => e.type === 'permission.ask'));
	await api('permissions_reply/' + ask.data.id, { reply: 'once' });
	await until(() => events.filter(e => e.type === 'session.status' && e.data.status === 'idle').length > 0);
	var r = await api('sessions_messages/' + sessionid);
	var part = r.response[r.response.length - 1].parts.find(p => p.type === 'tool');
	check('a command runs in the project root', part.data.output.indexOf(Total.Fs.realpathSync(PROJECT)) !== -1 && part.data.output.indexOf('hi') !== -1);

	events.length = 0;
	script = [{ wait: 10000 }];
	await api('sessions_prompt/' + sessionid, { text: 'slow' });
	await until(() => MAIN.running[sessionid]);
	await api('sessions_abort/' + sessionid);
	var aborted = await until(() => events.some(e => e.type === 'session.status' && e.data.status === 'aborted'));
	check('abort stops a running model call', aborted && !MAIN.running[sessionid]);
	next();
});

Test.push('real provider over HTTP', async function(next) {

	var mock = require('./mock-openai');
	await new Promise(resolve => mock.start(8111, resolve));

	var r = await api('providers_save', { name: 'Mock', url: 'http://127.0.0.1:8111/v1', key: 'secret-key', models: ['mock'] });
	check('a provider is saved', r.response && r.response.success === true);

	r = await api('providers');
	check('the key is never returned', r.response.length === 1 && r.response[0].haskey === true && r.response[0].key === undefined);
	var stored = await NOSQL('providers').read().where('id', 'mock').promise();
	check('the key is stored encrypted', stored.key && stored.key !== 'secret-key' && FUNC.decryptkey(stored.key) === 'secret-key');

	await new Promise(resolve => setTimeout(resolve, 200));
	r = await api('providers_models');
	check('its models can be chosen', r.response.indexOf('mock:mock') !== -1);

	r = await api('sessions_create', { projectid: projectid, model: 'mock:mock' });
	var id = r.response.id;
	events.length = 0;

	await api('sessions_prompt/' + id, { text: 'please read the file' });
	await until(() => events.some(e => e.type === 'permission.ask') || events.some(e => e.type === 'session.status' && e.data.status === 'idle'));
	check('read runs without asking', !events.some(e => e.type === 'permission.ask'));
	await until(() => events.filter(e => e.type === 'session.status' && e.data.status === 'idle').length > 0);

	r = await api('sessions_messages/' + id);
	var assistant = r.response.find(m => m.role === 'assistant');
	var tool = assistant.parts.find(p => p.type === 'tool');
	var texts = assistant.parts.filter(p => p.type === 'text').map(p => p.data.text).join('|');
	check('the stream of the provider was parsed into text and a tool call', texts.indexOf('Let me look at the file.') !== -1 && tool && tool.data.tool === 'read' && tool.data.input.path === 'README.md');
	check('the answer follows the tool result', texts.indexOf('I read the file.') !== -1);
	check('the provider received the key and the tools', mock.requests.length === 2 && mock.requests[0].tools.length === 6 && mock.requests[0].model === 'mock');

	events.length = 0;
	await api('sessions_prompt/' + id, { text: 'please fail' });
	await until(() => events.some(e => e.type === 'session.status' && e.data.status === 'error'));
	check('a provider error ends the run with a visible error', events.some(e => e.type === 'error' && /401/.test(e.data.message)));
	next();
});

Test.push('cleanup', async function(next) {
	var r = await api('projects_remove/' + projectid);
	check('removing a project removes its sessions', r.response.success === true);
	var left = await NOSQL('sessions').find().where('projectid', projectid).promise();
	check('no session is left', left.length === 0);
	Total.Fs.rmSync(TMP, { recursive: true, force: true });
	next();
});

Test.run();
