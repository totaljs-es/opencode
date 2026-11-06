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
	check('every tool has a definition', defs.length === 11);
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
	check('the provider received the key and the tools', mock.requests.length === 2 && mock.requests[0].tools.length === 11 && mock.requests[0].model === 'mock');

	events.length = 0;
	await api('sessions_prompt/' + id, { text: 'please fail' });
	await until(() => events.some(e => e.type === 'session.status' && e.data.status === 'error'));
	check('a provider error ends the run with a visible error', events.some(e => e.type === 'error' && /401/.test(e.data.message)));
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
