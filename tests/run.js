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

	// A request to summarize is answered without using the script
	if (ai.payload.messages[0].content.indexOf('Summarize the conversation') === 0) {
		callback(null, { content: 'SUMMARY of the work', thinking: '', tools: [] });
		return;
	}

	var step = script.shift();

	if (step && step.error) {
		callback(step.error);
		return;
	}
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
		// The data is copied: a part keeps changing after the event, like on the wire
		FUNC.onevent = (sessionid, type, data) => events.push({ sessionid: sessionid, type: type, data: JSON.parse(JSON.stringify(data)) });
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
	check('every tool has a definition', defs.length === 12);
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
	check('the user message comes before the answer', r.response[0].role === 'user' && r.response[1].role === 'assistant');
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
	check('the model is told not to retry a rejection', requests[requests.length - 1].messages.some(m => m.role === 'tool' && /do not try it again/i.test(m.content) && m.content.indexOf('@(') === -1));
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

Test.push('repeated rejections', async function(next) {

	var id = await session();
	events.length = 0;
	script = [];
	for (var i = 0; i < 5; i++)
		script.push({ tools: [{ id: 'w' + i, name: 'write', arguments: { path: 'never' + i + '.txt', content: 'x' } }] });

	await api('sessions_prompt/' + id, { text: 'keep trying' });

	for (var n = 0; n < 3; n++) {
		var ask = await until(() => events.filter(e => e.type === 'permission.ask')[n]);
		await api('permissions_reply/' + ask.data.id, { reply: 'reject' });
	}

	await idle(id);
	check('the run stops after three rejected actions', script.length === 2 && !events.some(e => e.type === 'permission.ask' && events.filter(x => x.type === 'permission.ask').length > 3));
	var r = await api('sessions_messages/' + id);
	var parts = r.response.find(m => m.role === 'assistant').parts;
	check('the stop is explained in the conversation', parts[parts.length - 1].type === 'text' && /Stopped/.test(parts[parts.length - 1].data.text));
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


function session(options) {
	return api('sessions_create', Object.assign({ projectid: projectid, model: 'fake' }, options || {})).then(r => r.response.id);
}

function idle(id) {
	return until(() => events.filter(e => e.sessionid === id && e.type === 'session.status' && e.data.status === 'idle').length > 0);
}

Test.push('diff', function(next) {
	var diff = MODS.snapshots.diff;
	var r = diff('a\nb\nc\nd\ne\nf\ng\nh\n', 'a\nb\nX\nd\ne\nf\ng\nh\ni\n');
	check('diff counts additions and deletions', r.additions === 2 && r.deletions === 1);
	check('diff has a unified hunk with context', r.patch.indexOf('@@ -1,') === 0 && r.patch.indexOf('-c') !== -1 && r.patch.indexOf('+X') !== -1 && r.patch.indexOf(' b') !== -1);
	check('equal texts have no diff', diff('a\nb\n', 'a\nb\n').patch === '');
	check('an empty original is all additions', diff('', 'x\ny\n').additions === 2);
	next();
});

Test.push('snapshots: diff and undo', async function(next) {

	var id = await session({ autoaccept: true });
	events.length = 0;
	script = [
		{ tools: [{ id: 's1', name: 'write', arguments: { path: 'n.txt', content: 'new file\n' } }, { id: 's2', name: 'edit', arguments: { path: 'a.txt', oldstring: 'two', newstring: 'TWO' } }] },
		{ content: 'Changed.' }
	];

	await api('sessions_prompt/' + id, { text: 'change things' });
	await idle(id);
	check('auto-accept lets edits run without asking', !events.some(e => e.type === 'permission.ask') && Total.Fs.existsSync(Total.Path.join(PROJECT, 'n.txt')));

	var r = await api('sessions_diff/' + id);
	var files = r.response;
	var a = files.find(f => f.path === 'a.txt');
	var n = files.find(f => f.path === 'n.txt');
	check('the diff lists the changed files', files.length === 2 && a.status === 'modified' && n.status === 'added');
	check('the diff has the lines', a.additions === 1 && a.deletions === 1 && a.patch.indexOf('-two') !== -1 && a.patch.indexOf('+TWO') !== -1);

	r = await api('sessions_messages/' + id);
	var assistant = r.response.find(m => m.role === 'assistant');
	r = await api('sessions_undo/' + id, { messageid: assistant.id });
	check('undo restores the files', Total.Fs.readFileSync(Total.Path.join(PROJECT, 'a.txt'), 'utf8') === 'one\ntwo\nthree\n' && !Total.Fs.existsSync(Total.Path.join(PROJECT, 'n.txt')));
	r = await api('sessions_diff/' + id);
	check('the diff is empty after undo', r.response.length === 0);
	next();
});

Test.push('tool errors', async function(next) {
	var id = await session({ autoaccept: true });
	events.length = 0;
	script = [{ tools: [{ id: 'e1', name: 'read', arguments: {} }, { id: 'e2', name: 'read', arguments: { path: 'missing.txt' } }] }, { content: 'ok' }];
	await api('sessions_prompt/' + id, { text: 'bad calls' });
	await idle(id);
	var r = await api('sessions_messages/' + id);
	var tools = r.response.find(m => m.role === 'assistant').parts.filter(p => p.type === 'tool');
	check('a call with a missing argument names the argument', /path/.test(tools[0].data.error) && tools[0].data.status === 'error');
	check('an error has no translation markers', tools[1].data.error === 'File not found');
	next();
});

Test.push('patch tool', async function(next) {

	var user = { id: 'agent', sa: true, root: PROJECT, sessionid: 'x', projectid: projectid };
	Total.Fs.writeFileSync(Total.Path.join(PROJECT, 'p.txt'), 'alpha\nbeta\ngamma\n');
	Total.Fs.writeFileSync(Total.Path.join(PROJECT, 'gone.txt'), 'bye\n');

	var patch = ['*** Begin Patch', '*** Update File: p.txt', '@@', ' alpha', '-beta', '+BETA', '+beta2', ' gamma', '*** Add File: q/new.txt', '+hello', '*** Delete File: gone.txt', '*** End Patch'].join('\n');
	var out = await ACTION('Tools|patch', { patch: patch }).user(user).promise();
	check('a patch updates, adds and deletes', Total.Fs.readFileSync(Total.Path.join(PROJECT, 'p.txt'), 'utf8') === 'alpha\nBETA\nbeta2\ngamma\n' && Total.Fs.readFileSync(Total.Path.join(PROJECT, 'q/new.txt'), 'utf8') === 'hello\n' && !Total.Fs.existsSync(Total.Path.join(PROJECT, 'gone.txt')));

	var bad = ['*** Begin Patch', '*** Add File: z.txt', '+z', '*** Update File: p.txt', '@@', '-does not exist', '+x', '*** End Patch'].join('\n');
	var failed = false;
	try {
		await ACTION('Tools|patch', { patch: bad }).user(user).promise();
	} catch (e) {
		failed = true;
	}
	check('a patch that does not match writes nothing', failed && !Total.Fs.existsSync(Total.Path.join(PROJECT, 'z.txt')));

	failed = false;
	try {
		await ACTION('Tools|patch', { patch: ['*** Begin Patch', '*** Add File: ../escape.txt', '+x', '*** End Patch'].join('\n') }).user(user).promise();
	} catch (e) {
		failed = true;
	}
	check('a patch outside the project is refused', failed);
	next();
});

Test.push('instructions and skills', async function(next) {

	Total.Fs.writeFileSync(Total.Path.join(PROJECT, 'AGENTS.md'), '# Rules\nAlways use tabs.\n');
	Total.Fs.mkdirSync(Total.Path.join(PROJECT, '.claude/skills/demo'), { recursive: true });
	Total.Fs.writeFileSync(Total.Path.join(PROJECT, '.claude/skills/demo/SKILL.md'), '---\nname: demo\ndescription: A demonstration skill\n---\n\n# Demo\nDo the demo steps.\n');

	var id = await session();
	events.length = 0;
	requests.length = 0;
	script = [{ tools: [{ id: 'k1', name: 'skill', arguments: { name: 'demo' } }] }, { content: 'ok' }];
	await api('sessions_prompt/' + id, { text: 'use the skill' });
	await idle(id);

	var system = requests[0].messages[0].content;
	check('AGENTS.md is part of the system prompt', system.indexOf('Always use tabs.') !== -1);
	check('the skills are listed with their description', system.indexOf('- demo: A demonstration skill') !== -1);
	check('the skill tool returns the body', requests[1].messages.some(m => m.role === 'tool' && m.content.indexOf('Do the demo steps.') !== -1));
	check('the skill tool ran without asking', !events.some(e => e.type === 'permission.ask'));
	next();
});

Test.push('todo and ask tools', async function(next) {

	var id = await session();
	events.length = 0;
	script = [
		{ tools: [{ id: 't1', name: 'todo', arguments: { todos: JSON.stringify([{ text: 'one', status: 'in_progress' }, { text: 'two', status: 'pending' }]) } }] },
		{ tools: [{ id: 't2', name: 'ask', arguments: { question: 'Which database?', options: ['PostgreSQL', 'NoSQL'] } }] },
		{ content: 'Thanks.' }
	];

	await api('sessions_prompt/' + id, { text: 'plan' });
	var question = await until(() => events.find(e => e.type === 'question.ask'));
	check('the todo tool updates the list and emits it', events.some(e => e.type === 'todo.updated' && e.data.items.length === 2));
	check('the ask tool waits for the user', !!question && question.data.options.length === 2);
	var r = await api('sessions_todos/' + id);
	check('the task list is stored', r.response.length === 2 && r.response[0].status === 'in_progress');

	await api('questions_reply/' + question.data.id, { answer: 'PostgreSQL' });
	await idle(id);
	r = await api('sessions_messages/' + id);
	var ask = r.response.find(m => m.role === 'assistant').parts.find(p => p.type === 'tool' && p.data.tool === 'ask');
	check('the answer returns to the model as the tool result', ask && ask.data.output === 'PostgreSQL');
	next();
});

Test.push('retry', async function(next) {

	CONF.retrybase = 10;
	var id = await session();
	events.length = 0;
	script = [{ error: '503: overloaded' }, { error: 'ECONNRESET' }, { content: 'Recovered.' }];
	await api('sessions_prompt/' + id, { text: 'hello' });
	await idle(id);
	check('transient errors are retried and reported', events.filter(e => e.type === 'error' && e.data.retry === true).length === 2);

	events.length = 0;
	script = [{ error: '401: invalid key' }];
	await api('sessions_prompt/' + id, { text: 'again' });
	await until(() => events.some(e => e.type === 'session.status' && e.data.status === 'error'));
	check('an authentication error is not retried', events.filter(e => e.type === 'error').length === 1 && events.find(e => e.type === 'error').data.retry === false);

	events.length = 0;
	script = [{ error: '503: a' }, { error: '503: b' }, { error: '503: c' }, { error: '503: d' }];
	await api('sessions_prompt/' + id, { text: 'again' });
	await until(() => events.some(e => e.type === 'session.status' && e.data.status === 'error'));
	check('retries stop after the limit', events.filter(e => e.type === 'error' && e.data.retry === true).length === 3);
	next();
});

Test.push('compaction', async function(next) {

	Total.Fs.writeFileSync(Total.Path.join(PROJECT, 'big.txt'), ('x'.repeat(99) + '\n').repeat(50));

	async function reads(count) {
		var id = await session();
		events.length = 0;
		requests.length = 0;
		script = [];
		for (var i = 0; i < count; i++)
			script.push({ tools: [{ id: 'r' + i, name: 'read', arguments: { path: 'big.txt' } }] });
		script.push({ content: 'Finished.' });
		await api('sessions_prompt/' + id, { text: 'read it many times' });
		await idle(id);
		return id;
	}

	// Level 1: about 1300 tokens per read, the limit allows the six newest outputs
	CONF.contextlimit = 9500;
	var id = await reads(9);
	check('old tool output is reduced to one line', requests.some(r => r.messages.some(m => m.role === 'tool' && m.content.indexOf('[output omitted') === 0)));
	check('level 1 does not call the model to summarize', !requests.some(r => r.messages[0].content.indexOf('Summarize the conversation') === 0));

	// Level 2: the limit is lower than six outputs
	CONF.contextlimit = 600;
	id = await reads(9);
	check('older turns become a summary', requests.some(r => r.messages.some(m => m.role === 'user' && m.content.indexOf('Summary of the earlier conversation') === 0)));
	var r = await api('sessions_messages/' + id);
	var parts = r.response.find(m => m.role === 'assistant').parts;
	check('the stored history keeps everything and notes the compaction', parts.filter(p => p.type === 'tool').length === 9 && parts.some(p => p.type === 'compaction'));

	CONF.contextlimit = 100000;
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
	check('the provider received the key and the tools', mock.requests.length === 2 && mock.requests[0].tools.length === 12 && mock.requests[0].model === 'mock');

	events.length = 0;
	await api('sessions_prompt/' + id, { text: 'please fail' });
	await until(() => events.some(e => e.type === 'session.status' && e.data.status === 'error'));
	check('a provider error ends the run with a visible error', events.some(e => e.type === 'error' && /401/.test(e.data.message)));
	next();
});

Test.push('providers, discovery and model metadata', async function(next) {

	var base = 'http://127.0.0.1:8111/v1';
	var r = await api('providers_templates');
	var ids = r.response.map(t => t.id);
	check('templates cover local servers and remote catalogues', ['ollama', 'llamacpp', 'lmstudio', 'openrouter', 'openai'].every(id => ids.indexOf(id) !== -1) && r.response.find(t => t.id === 'ollama').local === true);

	r = await api('providers_available', { url: base, kind: 'ollama' });
	var tiny = r.response.find(m => m.id === 'tiny:1b');
	var big = r.response.find(m => m.id === 'big:7b');
	check('Ollama models come with capabilities and context', r.response.length === 2 && tiny.tools === false && big.tools === true && big.reasoning === true && big.context === 32768 && tiny.context === 8192);

	r = await api('providers_available', { url: base, kind: 'openrouter' });
	var free = r.response.find(m => m.id === 'free-model:free');
	var paid = r.response.find(m => m.id === 'paid-model');
	var plain = r.response.find(m => m.id === 'plain-model');
	check('catalogue models say if they are free and support tools', free.free === true && free.tools === true && free.reasoning === true && free.context === 65536 && paid.free === false && paid.tools === false);
	check('unknown values stay null', plain.tools === null && plain.free === null && plain.context === null);
	check('catalogue models carry their price per token', free.price.input === 0 && paid.price.input === 0.000001 && paid.price.output === 0.000002 && plain.price === null);

	// Detection on this computer: the local templates point to the mock (Ollama) or to a closed port
	var saved = MAIN.templates;
	MAIN.templates = saved.map(t => t.local ? Object.assign({}, t, { url: t.id === 'ollama' ? base : 'http://127.0.0.1:1/v1' }) : t);
	r = await api('providers_detect');
	MAIN.templates = saved;
	check('detection finds the servers that answer and skips the others', r.response.length === 1 && r.response[0].template.id === 'ollama' && r.response[0].models.length === 2);

	r = await api('providers_save', { name: 'Local mock', url: base, kind: 'ollama', models: ['tiny:1b', 'big:7b'], meta: { 'tiny:1b': { id: 'tiny:1b', context: 8192, tools: false }, 'big:7b': { id: 'big:7b', context: 32768, tools: true, reasoning: true } } });
	check('a provider is saved with the metadata of its models', r.response && r.response.success === true);
	await new Promise(resolve => setTimeout(resolve, 200));

	r = await api('providers_catalog');
	var entry = r.response.find(m => m.id === 'local-mock:tiny:1b');
	check('the catalogue lists the models with what they can do', entry && entry.tools === false && entry.context === 8192 && r.response.find(m => m.id === 'local-mock:big:7b').reasoning === true);

	var mock = require('./mock-openai');
	var id = await session({ model: 'local-mock:tiny:1b' });
	events.length = 0;
	mock.requests.length = 0;
	await api('sessions_prompt/' + id, { text: 'hello without tools' });
	await idle(id);
	check('a model without tool support gets a request without tools', mock.requests.length === 1 && mock.requests[0].tools === undefined);

	r = await api('sessions_messages/' + id);
	var step = r.response.find(m => m.role === 'assistant').parts.find(p => p.type === 'step');
	check('the usage of the request is kept in the step', step.data.tokens && step.data.tokens.input === 12 && step.data.tokens.output === 5);

	id = await session({ model: 'local-mock:big:7b' });
	mock.requests.length = 0;
	await api('sessions_prompt/' + id, { text: 'hello with tools' });
	await idle(id);
	check('a model with tool support gets the tools', mock.requests[0].tools && mock.requests[0].tools.length === 12);
	next();
});

Test.push('Anthropic and Gemini', async function(next) {

	var mock = require('./mock-openai');
	var root = 'http://127.0.0.1:8111';

	// The conversion of the conversation
	var tools = [{ role: 'assistant', content: 'Looking.', tool_calls: [{ id: 'a', type: 'function', function: { name: 'read', arguments: '{"path":"x"}' } }, { id: 'b', type: 'function', function: { name: 'glob', arguments: '{"pattern":"*"}' } }] }, { role: 'tool', tool_call_id: 'a', content: 'one' }, { role: 'tool', tool_call_id: 'b', content: 'two' }];
	var a = MODS.provider.toanthropic([{ role: 'system', content: 'SYS' }, { role: 'user', content: 'hi' }].concat(tools));
	check('Anthropic: the system prompt is separate', a.system === 'SYS' && a.messages[0].role === 'user');
	check('Anthropic: tool calls become tool_use blocks', a.messages[1].role === 'assistant' && a.messages[1].content[0].type === 'text' && a.messages[1].content[1].type === 'tool_use' && a.messages[1].content[1].input.path === 'x');
	check('Anthropic: the results of one step go in one user message', a.messages.length === 3 && a.messages[2].content.length === 2 && a.messages[2].content[1].tool_use_id === 'b');

	var g = MODS.provider.togemini([{ role: 'system', content: 'SYS' }, { role: 'user', content: 'hi' }].concat(tools));
	check('Gemini: the system prompt is separate and the assistant is the model', g.system === 'SYS' && g.contents[1].role === 'model' && g.contents[1].parts[1].functionCall.name === 'read');
	check('Gemini: results carry the name of their function', g.contents[2].parts.length === 2 && g.contents[2].parts[0].functionResponse.name === 'read' && g.contents[2].parts[1].functionResponse.name === 'glob');

	var hist = MODS.provider.togemini([{ role: 'assistant', content: null, tool_calls: [{ id: 'a', type: 'function', thoughtSignature: 'SIG', function: { name: 'read', arguments: '{}' } }] }]);
	check('Gemini: a stored signature goes back in its function call', hist.contents[0].parts[0].thoughtSignature === 'SIG');

	// Discovery with the key in the header of each API
	var r = await api('providers_available', { url: root, kind: 'anthropic', key: 'test-key' });
	check('Anthropic models are listed with their context', r.response.length === 1 && r.response[0].id === 'claude-test' && r.response[0].context === 200000 && r.response[0].tools === true);
	r = await api('providers_available', { url: root, kind: 'gemini', key: 'test-key' });
	check('Gemini models are listed and only the ones that generate', r.response.length === 1 && r.response[0].id === 'gemini-test' && r.response[0].context === 1048576);

	// A conversation with each provider
	await api('providers_save', { name: 'Claude mock', url: root, kind: 'anthropic', key: 'test-key', models: ['claude-test'] });
	await api('providers_save', { name: 'Gemini mock', url: root, kind: 'gemini', key: 'test-key', models: ['gemini-test'] });
	await new Promise(resolve => setTimeout(resolve, 300));

	for (var kind of ['anthropic', 'gemini']) {

		var id = await session({ model: (kind === 'anthropic' ? 'claude-mock:claude-test' : 'gemini-mock:gemini-test') });
		events.length = 0;
		mock.calls.length = 0;
		await api('sessions_prompt/' + id, { text: 'please read the file' });
		await until(() => events.some(e => e.type === 'permission.ask') || events.some(e => e.type === 'session.status' && e.data.status === 'idle'));
		await idle(id);

		var calls = mock.calls.filter(c => c.kind === kind);
		var label = kind === 'anthropic' ? 'Anthropic' : 'Gemini';
		check(label + ': the conversation takes two requests with the key in its header', calls.length === 2);

		if (kind === 'anthropic') {
			check('Anthropic: system, tools with input_schema and max_tokens are sent', calls[0].body.system.indexOf('You are Totem') === 0 && calls[0].body.tools.length === 12 && !!calls[0].body.tools[0].input_schema && calls[0].body.max_tokens > 0);
			check('Anthropic: the second request carries the tool result', calls[1].body.messages.some(m => Array.isArray(m.content) && m.content.some(b => b.type === 'tool_result' && b.tool_use_id === 'toolu_1')));
		} else {
			check('Gemini: system instruction and function declarations are sent', calls[0].body.systemInstruction.parts[0].text.indexOf('You are Totem') === 0 && calls[0].body.tools[0].functionDeclarations.length === 12 && JSON.stringify(calls[0].body.tools).indexOf('additionalProperties') === -1);
			check('Gemini: the signature of the function call is sent back', calls[1].body.contents.some(c => c.role === 'model' && c.parts.some(p => p.functionCall && p.thoughtSignature === 'sig-123')));
			check('Gemini: the second request carries the function response', calls[1].body.contents.some(c => c.parts.some(p => p.functionResponse && p.functionResponse.name === 'read')));
		}

		r = await api('sessions_messages/' + id);
		var assistant = r.response.find(m => m.role === 'assistant');
		var texts = assistant.parts.filter(p => p.type === 'text').map(p => p.data.text).join('|');
		var tool = assistant.parts.find(p => p.type === 'tool');
		var steps = assistant.parts.filter(p => p.type === 'step');
		check(label + ': text and the tool call are parsed from the stream', texts.indexOf('Let me read it.') !== -1 && texts.indexOf(label + ' saw') !== -1 && tool && tool.data.tool === 'read');
		check(label + ': the usage of every step is kept', steps[0].data.tokens && steps[0].data.tokens.input > 0 && steps[0].data.tokens.output > 0);
	}

	// A wrong key is a visible error
	await api('providers_save', { name: 'Claude bad', url: root, kind: 'anthropic', key: 'wrong', models: ['claude-test'] });
	await new Promise(resolve => setTimeout(resolve, 300));
	var bad = await session({ model: 'claude-bad:claude-test' });
	events.length = 0;
	await api('sessions_prompt/' + bad, { text: 'hello' });
	await until(() => events.some(e => e.type === 'session.status' && e.data.status === 'error'));
	check('a rejected key ends the run with the error of the provider', events.some(e => e.type === 'error' && /401/.test(e.data.message)));
	next();
});

Test.push('sub-agents and commands', async function(next) {

	var id = await session();
	events.length = 0;
	requests.length = 0;
	script = [
		{ tools: [{ id: 'ta', name: 'task', arguments: { agent: 'explore', prompt: 'Find the lines of a.txt' } }] },
		{ tools: [{ id: 'cr', name: 'read', arguments: { path: 'a.txt' } }] },
		{ content: 'FOUND three lines' },
		{ content: 'The sub-agent said it.' }
	];

	await api('sessions_prompt/' + id, { text: 'delegate' });
	await idle(id);

	check('the task tool runs without asking', !events.some(e => e.type === 'permission.ask'));
	check('the sub-agent has its own prompt and context', requests.length === 4 && requests[1].messages[0].content.indexOf('You are the explore agent') === 0 && requests[1].messages.length === 2 && requests[1].messages[1].content === 'Find the lines of a.txt');
	check('the sub-agent only gets the tools of its definition', JSON.stringify(requests[1].tools.map(t => t.function.name)) === JSON.stringify(['read', 'glob', 'grep', 'fetch', 'skill']));
	check('the parent lists the agents it can delegate to', requests[0].messages[0].content.indexOf('- explore:') !== -1 && requests[0].messages[0].content.indexOf('- general:') !== -1);
	check('the progress of the sub-agent is shown in the tool call', events.some(e => e.type === 'part.updated' && e.data.part.data.tool === 'task' && /\[read\] done/.test(e.data.part.data.output || '')));
	var r = await api('sessions_messages/' + id);
	var parts = r.response.find(m => m.role === 'assistant').parts;
	var task = parts.find(p => p.type === 'tool' && p.data.tool === 'task');
	check('only the final answer comes back to the parent', task.data.status === 'done' && task.data.output === 'FOUND three lines' && requests[3].messages.some(m => m.role === 'tool' && m.content === 'FOUND three lines'));
	check('the tool calls of the sub-agent are not part of the conversation', parts.filter(p => p.type === 'tool').length === 1);

	events.length = 0;
	script = [{ tools: [{ id: 'tb', name: 'task', arguments: { agent: 'nope', prompt: 'x' } }] }, { content: 'ok' }];
	await api('sessions_prompt/' + id, { text: 'delegate again' });
	await idle(id);
	r = await api('sessions_messages/' + id);
	var bad = r.response[r.response.length - 1].parts.find(p => p.type === 'tool');
	check('an unknown agent is an error that lists the available ones', bad.data.status === 'error' && /Unknown agent "nope"\. Available: explore, general/.test(bad.data.error));

	// The sub-agent asks the user like any other agent
	events.length = 0;
	script = [
		{ tools: [{ id: 'tc', name: 'task', arguments: { agent: 'general', prompt: 'Create w.txt' } }] },
		{ tools: [{ id: 'cw', name: 'write', arguments: { path: 'w.txt', content: 'x' } }] },
		{ content: 'Could not write.' },
		{ content: 'Reported.' }
	];
	await api('sessions_prompt/' + id, { text: 'delegate a write' });
	var ask = await until(() => events.find(e => e.type === 'permission.ask'));
	check('a write of a sub-agent asks in the session of the user', !!ask && ask.data.tool === 'write');
	await api('permissions_reply/' + ask.data.id, { reply: 'reject' });
	await idle(id);
	check('a rejected write of a sub-agent does not happen', !Total.Fs.existsSync(Total.Path.join(PROJECT, 'w.txt')));

	// Commands of the project
	Total.Fs.mkdirSync(Total.Path.join(PROJECT, '.totem/commands'), { recursive: true });
	Total.Fs.writeFileSync(Total.Path.join(PROJECT, '.totem/commands/review.md'), '---\ndescription: Review a file\n---\nReview $ARGUMENTS carefully.\n');
	r = await api('projects_commands/' + projectid);
	check('the commands and the agents of a project are listed', r.response.commands.length === 1 && r.response.commands[0].name === 'review' && r.response.commands[0].description === 'Review a file' && r.response.agents.length === 2);

	id = await session();
	events.length = 0;
	requests.length = 0;
	script = [{ content: 'Reviewed.' }, { content: 'Again.' }];
	await api('sessions_prompt/' + id, { text: '/review a.txt' });
	await idle(id);
	check('a command sends its expanded text to the model', requests[0].messages[requests[0].messages.length - 1].content === 'Review a.txt carefully.');
	r = await api('sessions_messages/' + id);
	var shown = r.response.find(m => m.role === 'user').parts[0].data;
	check('the conversation keeps what the user typed', shown.text === '/review a.txt' && shown.expanded === 'Review a.txt carefully.');
	await api('sessions_prompt/' + id, { text: '/unknown thing' });
	await idle(id);
	check('the history sends the expanded text and an unknown command is plain text', requests[1].messages.some(m => m.role === 'user' && m.content === 'Review a.txt carefully.') && requests[1].messages[requests[1].messages.length - 1].content === '/unknown thing');
	next();
});

Test.push('cost and reasoning effort', async function(next) {

	var mock = require('./mock-openai');
	var base = 'http://127.0.0.1:8111/v1';

	await api('providers_save', { name: 'Priced', url: base, kind: 'openai', models: ['p1'], meta: { p1: { id: 'p1', reasoning: true, tools: true, price: { input: 0.001, output: 0.002 } } } });
	await new Promise(resolve => setTimeout(resolve, 200));

	var id = await session({ model: 'priced:p1', reasoning: 'low' });
	events.length = 0;
	mock.requests.length = 0;
	await api('sessions_prompt/' + id, { text: 'hello' });
	await idle(id);

	var r = await api('sessions_messages/' + id);
	var step = r.response.find(m => m.role === 'assistant').parts.find(p => p.type === 'step');
	check('the cost of a step follows the usage and the price', Math.abs(step.data.cost - 0.022) < 1e-9);
	check('the reasoning effort of the session is sent', mock.requests[0].reasoning_effort === 'low');

	mock.requests.length = 0;
	events.length = 0;
	await api('sessions_prompt/' + id, { text: 'again', reasoning: 'high' });
	await idle(id);
	r = await api('sessions_read/' + id);
	check('a prompt can change the reasoning effort for the session', mock.requests[0].reasoning_effort === 'high' && r.response.reasoning === 'high');

	mock.requests.length = 0;
	events.length = 0;
	await api('sessions_prompt/' + id, { text: 'no change' });
	await idle(id);
	check('without a value the effort of the session stays', mock.requests[0].reasoning_effort === 'high');

	var plain = await session({ model: 'priced:p1' });
	mock.requests.length = 0;
	events.length = 0;
	await api('sessions_prompt/' + plain, { text: 'default' });
	await idle(plain);
	check('an empty effort leaves the default of the model', mock.requests[0].reasoning_effort === undefined);

	// A local model costs nothing
	await api('providers_save', { name: 'Free local', url: base, kind: 'ollama', models: ['tiny:1b'], meta: { 'tiny:1b': { id: 'tiny:1b', free: true, price: { input: 0, output: 0 }, tools: false } } });
	await new Promise(resolve => setTimeout(resolve, 200));
	var free = await session({ model: 'free-local:tiny:1b' });
	events.length = 0;
	await api('sessions_prompt/' + free, { text: 'free' });
	await idle(free);
	r = await api('sessions_messages/' + free);
	step = r.response.find(m => m.role === 'assistant').parts.find(p => p.type === 'step');
	check('a free model has a cost of zero', step.data.cost === 0);
	next();
});

Test.push('MCP client', async function(next) {

	var mockpath = Total.Path.join(ROOT, 'tests/mock-mcp.js');
	Total.Fs.mkdirSync(Total.Path.join(PROJECT, '.totem'), { recursive: true });
	Total.Fs.writeFileSync(Total.Path.join(PROJECT, '.totem/mcp.json'), JSON.stringify({ servers: { mock: { command: process.execPath, args: [mockpath] }, web: { url: 'http://127.0.0.1:8111/mcp' } } }));

	// Answers every permission question of the session with a reply until the run ends
	function approver(replyfor) {
		var seen = {};
		return setInterval(function() {
			events.filter(e => e.type === 'permission.ask' && !seen[e.data.id]).forEach(function(e) {
				seen[e.data.id] = true;
				api('permissions_reply/' + e.data.id, { reply: replyfor(e.data) });
			});
		}, 30);
	}

	var id = await session();
	events.length = 0;
	requests.length = 0;
	script = [
		{ tools: [{ id: 'm1', name: 'mock__echo', arguments: { text: 'hi' } }, { id: 'm2', name: 'web__echo', arguments: { text: 'over http' } }, { id: 'm3', name: 'mock__fail', arguments: {} }] },
		{ content: 'Done.' }
	];

	var timer = approver(() => 'once');
	await api('sessions_prompt/' + id, { text: 'use the mcp tools' });
	await idle(id);
	clearInterval(timer);

	var starts = events.filter(e => e.type === 'permission.ask' && e.data.tool === 'mcp-start');
	check('every server of the project asks before it starts', starts.length === 2 && starts[0].data.patterns[0].indexOf('mock: ') === 0 && starts[1].data.patterns[0].indexOf('http://127.0.0.1:8111/mcp') !== -1);

	var names = requests[0].tools.map(t => t.function.name);
	check('the tools of the servers join the tools of Totem', names.indexOf('mock__echo') !== -1 && names.indexOf('web__echo') !== -1 && names.indexOf('read') !== -1);
	var echo = requests[0].tools.find(t => t.function.name === 'mock__echo').function;
	check('their definitions keep the schema and name the server', echo.description.indexOf('[mock]') === 0 && echo.parameters.required[0] === 'text');

	check('a tool of a server asks before it runs', events.filter(e => e.type === 'permission.ask' && e.data.tool === 'mcp:mock__echo').length === 1);

	var r = await api('sessions_messages/' + id);
	var tools = r.response.find(m => m.role === 'assistant').parts.filter(p => p.type === 'tool');
	check('a tool over stdio answers', tools[0].data.status === 'done' && tools[0].data.output === 'echo: hi');
	check('a tool over HTTP answers, also as an event stream', tools[1].data.status === 'done' && tools[1].data.output === 'echo: over http');
	check('a tool that fails is an error for the model', tools[2].data.status === 'error' && tools[2].data.error === 'it failed');
	check('the program of the server stops with the run', !MAIN.children[id]);

	// When the user refuses to start the servers, their tools do not exist
	id = await session();
	events.length = 0;
	requests.length = 0;
	script = [{ content: 'No tools.' }];
	timer = approver(() => 'reject');
	await api('sessions_prompt/' + id, { text: 'hello' });
	await idle(id);
	clearInterval(timer);
	check('refused servers add no tools', requests[0].tools.map(t => t.function.name).indexOf('mock__echo') === -1 && requests[0].tools.length === 12);

	Total.Fs.rmSync(Total.Path.join(PROJECT, '.totem/mcp.json'));
	next();
});

Test.push('Total.js knowledge: conventions and Forge', async function(next) {

	var TJS = Total.Path.join(TMP, 'tjs');
	Total.Fs.mkdirSync(Total.Path.join(TJS, 'schemas'), { recursive: true });
	Total.Fs.writeFileSync(Total.Path.join(TJS, 'package.json'), JSON.stringify({ name: 'app', dependencies: { total5: 'beta' } }));

	check('a project that depends on total5 is a Total.js project', MODS.instructions.istotaljs(TJS) === true && MODS.instructions.istotaljs(PROJECT) === false);

	// Forge comes with Totem for Total.js projects only, and the project can replace it
	check('Forge is a server of Total.js projects', MODS.mcpclient.servers(TJS).forge.url === 'https://forge.totaljs.es/mcp/');
	check('other projects do not get it', MODS.mcpclient.servers(PROJECT).forge === undefined);
	CONF.forge = false;
	check('it can be switched off in the config', MODS.mcpclient.servers(TJS).forge === undefined);
	CONF.forge = true;
	Total.Fs.mkdirSync(Total.Path.join(TJS, '.totem'), { recursive: true });
	Total.Fs.writeFileSync(Total.Path.join(TJS, '.totem/mcp.json'), JSON.stringify({ servers: { forge: { url: 'http://127.0.0.1:8111/mcp' } } }));
	check('a project replaces a built-in server by name', MODS.mcpclient.servers(TJS).forge.url === 'http://127.0.0.1:8111/mcp');
	Total.Fs.unlinkSync(Total.Path.join(TJS, '.totem/mcp.json'));

	// The skill of the conventions
	var names = MODS.instructions.skills(TJS).map(s => s.name);
	check('the conventions skill comes with Totem for Total.js projects', names.indexOf('totaljs-conventions') !== -1 && MODS.instructions.skills(PROJECT).map(s => s.name).indexOf('totaljs-conventions') === -1);
	check('the skill tells where Forge is', MODS.instructions.skill(TJS, 'totaljs-conventions').indexOf('forge__Forge_search') !== -1);
	Total.Fs.mkdirSync(Total.Path.join(TJS, '.claude/skills/totaljs-conventions'), { recursive: true });
	Total.Fs.writeFileSync(Total.Path.join(TJS, '.claude/skills/totaljs-conventions/SKILL.md'), '---\nname: totaljs-conventions\ndescription: Our own rules\n---\nOwn body\n');
	check('a skill of the project with the same name wins', MODS.instructions.skills(TJS).find(s => s.name === 'totaljs-conventions').description === 'Our own rules');
	Total.Fs.rmSync(Total.Path.join(TJS, '.claude'), { recursive: true });

	// The check of the conventions on what the tools write
	var user = { id: 'agent', sa: true, root: TJS, sessionid: 'x', projectid: projectid };
	var bad = "var fs = require('fs');\n\nNEWACTION('Bad/list', {\n\tname: 'List',\n\taction: function($) {\n\t\t$.callback([]);\n\t}\n});\n";
	var out = await ACTION('Tools|write', { path: 'schemas/bad.js', content: bad }).user(user).promise();
	check('a file that breaks the conventions comes back with the findings', /node-require/.test(out) && /name-separator/.test(out) && out.indexOf('Written schemas/bad.js') === 0);

	out = await ACTION('Tools|write', { path: 'schemas/good.js', content: "NEWACTION('Good|list', {\n\tname: 'List',\n\taction: function($) {\n\t\t$.callback([]);\n\t}\n});\n" }).user(user).promise();
	check('a file that follows them has no findings', out.indexOf('conventions') === -1);

	out = await ACTION('Tools|edit', { path: 'schemas/good.js', oldstring: '$.callback([]);', newstring: "var os = require('os');" }).user(user).promise();
	check('an edit is checked too', /node-require/.test(out));

	out = await ACTION('Tools|patch', { patch: ['*** Begin Patch', '*** Add File: schemas/patched.js', "+var path = require('path');", '*** End Patch'].join('\n') }).user(user).promise();
	check('a patch is checked too', /node-require/.test(out) && /patched\.js/.test(out));

	out = await ACTION('Tools|write', { path: 'plain.js', content: bad }).user({ id: 'agent', sa: true, root: PROJECT, sessionid: 'x', projectid: projectid }).promise();
	check('a project that is not Total.js is left alone', out.indexOf('conventions') === -1);

	CONF.conventions = false;
	out = await ACTION('Tools|write', { path: 'schemas/bad2.js', content: bad }).user(user).promise();
	check('the check can be switched off in the config', out.indexOf('conventions') === -1);
	CONF.conventions = true;

	// The prompt of a session in a Total.js project, and the question before Forge starts
	var opened = await api('projects_open', { path: TJS });
	var id = await api('sessions_create', { projectid: opened.response.id, model: 'fake' }).then(r => r.response.id);
	events.length = 0;
	requests.length = 0;
	script = [{ content: 'Hello.' }];

	var rejected = setInterval(function() {
		events.filter(e => e.type === 'permission.ask').forEach(e => api('permissions_reply/' + e.data.id, { reply: 'reject' }));
	}, 30);

	await api('sessions_prompt/' + id, { text: 'hi' });
	await idle(id);
	clearInterval(rejected);

	var system = requests[0].messages[0].content;
	check('the skills of the project include the conventions', system.indexOf('- totaljs-conventions:') !== -1);
	var ask = events.find(e => e.type === 'permission.ask' && e.data.tool === 'mcp-start');
	check('Forge asks before it starts and says where it goes', !!ask && ask.data.patterns[0].indexOf('forge: https://forge.totaljs.es/mcp/') === 0);
	check('refusing Forge adds no tools', requests[0].tools.map(t => t.function.name).filter(n => /^forge__/.test(n)).length === 0);
	next();
});

Test.push('folders and provider icons', async function(next) {

	var r = await api('folders');
	check('the folders start at the home folder, with places', r.response.path === Total.Os.homedir() && r.response.sep === Total.Path.sep && r.response.places[0].name === 'Home' && r.response.places[0].path === Total.Os.homedir() && Array.isArray(r.response.items));

	Total.Fs.mkdirSync(Total.Path.join(PROJECT, 'inner/deeper'), { recursive: true });
	r = await api('folders?path=' + encodeURIComponent(PROJECT));
	var names = r.response.items.map(i => i.name);
	check('only folders are listed, not files or hidden folders', names.indexOf('inner') !== -1 && names.indexOf('src') !== -1 && names.indexOf('a.txt') === -1 && names.indexOf('.totem') === -1);
	check('a link to a folder counts as a folder', names.indexOf('link') !== -1);
	check('the folders are sorted', JSON.stringify(names) === JSON.stringify(names.slice().sort((a, b) => a.localeCompare(b))));

	r = await api('folders?hidden=1&path=' + encodeURIComponent(PROJECT));
	check('hidden folders can be asked for', r.response.items.some(i => i.name === '.totem'));

	r = await api('folders?path=' + encodeURIComponent(Total.Path.join(PROJECT, 'inner')));
	check('a folder inside is listed', r.response.path === Total.Path.join(PROJECT, 'inner') && r.response.items.length === 1 && r.response.items[0].name === 'deeper');

	r = await api('folders?path=' + encodeURIComponent(Total.Path.join(PROJECT, 'does-not-exist')));
	check('a missing folder is an error', !!(r.err && r.err.items && r.err.items[0].error));

	// The icon of a provider, in the list and in the catalogue of models
	var base = 'http://127.0.0.1:8111/v1';
	await api('providers_save', { name: 'OpenAI', url: base, kind: 'openai', icon: 'openai', models: ['gpt-x'] });
	await api('providers_save', { name: 'Google Gemini', url: base, kind: 'openai', icon: 'gemini', models: ['gem-x'] });
	await api('providers_save', { name: 'No icon', url: base, kind: 'openai', models: ['plain-x'] });
	await new Promise(resolve => setTimeout(resolve, 300));

	r = await api('providers');
	var by = {};
	r.response.forEach(p => by[p.id] = p);
	check('a provider keeps the icon it was saved with', by['google-gemini'].icon === 'gemini');
	check('a provider whose id is an icon gets it', by['openai'].icon === 'openai');
	check('a provider without an icon has none', by['no-icon'].icon === '' && by['mock'].icon === '');

	r = await api('providers_catalog');
	var gpt = r.response.find(m => m.id === 'openai:gpt-x');
	var gem = r.response.find(m => m.id === 'google-gemini:gem-x');
	var plain = r.response.find(m => m.id === 'no-icon:plain-x');
	check('the catalogue names the provider and its icon for every model', gpt.provider === 'OpenAI' && gpt.icon === 'openai' && gem.provider === 'Google Gemini' && gem.icon === 'gemini' && plain.provider === 'No icon' && plain.icon === '');
	check('every icon of the templates exists as a file', JSON.parse(Total.Fs.readFileSync(Total.Path.join(ROOT, 'private/providers.json'), 'utf8')).filter(t => t.icon).every(t => Total.Fs.existsSync(Total.Path.join(ROOT, 'public/img/providers', t.icon + '.svg'))));
	next();
});

Test.push('command line', async function(next) {

	function cli(args) {
		return new Promise(resolve => Total.Child.execFile(process.execPath, [Total.Path.join(ROOT, 'bin/totem.js')].concat(args), { timeout: 30000 }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout: stdout, stderr: stderr })));
	}

	var base = ['--project', PROJECT, '--model', 'mock:mock', '--url', 'http://127.0.0.1:' + PORT];
	var r = await cli(['run', 'hello there'].concat(base));
	check('totem run prints the answer and exits with 0', r.code === 0 && r.stdout.indexOf('Hello from the mock model. You said: hello there') !== -1);

	r = await cli(['run', 'please read the file'].concat(base));
	check('totem run reports tool calls on stderr', r.code === 0 && /\[read\] (done|error)/.test(r.stderr) && r.stdout.indexOf('I read the file.') !== -1);

	r = await cli(['run', 'please fail'].concat(base));
	check('totem run exits with 1 on an error', r.code === 1 && r.stderr.indexOf('401') !== -1);

	r = await cli(['run']);
	check('totem run without a prompt explains the usage', r.code === 2 && r.stderr.indexOf('Missing prompt') !== -1);

	r = await cli(['config']);
	check('totem config prints the folders', r.stdout.indexOf('Data folder:') !== -1);
	next();
});

Test.push('secrets', async function(next) {

	var id = await session();
	events.length = 0;
	script = [{ tools: [{ id: 'z1', name: 'bash', arguments: { command: 'echo secret-key and sk-abcdefghijklmnopqrstuvwxyz123456' } }] }, { content: 'ok' }];
	await api('sessions_prompt/' + id, { text: 'leak it' });
	await idle(id);
	var r = await api('sessions_messages/' + id);
	var part = r.response.find(m => m.role === 'assistant').parts.find(p => p.type === 'tool');
	check('provider keys and key-like strings never reach the output', part.data.output.indexOf('secret-key') === -1 && part.data.output.indexOf('sk-abcdefghijkl') === -1 && part.data.output.indexOf('[secret]') !== -1);
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
