// Permission rules: tool + pattern -> allow | ask | deny. The project rules come first, then the defaults.

exports.id = 'permissions';

var READONLY = { read: 1, glob: 1, grep: 1, todo: 1, ask: 1, skill: 1, task: 1 };
var READONLY_COMMANDS = /^(ls|pwd|cat|head|tail|wc|echo|git (status|diff|log|show|branch)|node --check|rg|grep|find)( |$)/;

// Subject of a tool call that a rule pattern is compared with
function subject(tool, input) {
	if (tool === 'bash')
		return (input.command || '').trim();
	return input.path || input.pattern || input.url || input.command || '';
}

exports.subject = subject;

// callback(reply) where reply is 'allow' or 'deny'
exports.check = function(run, tool, input, callback) {

	var text = subject(tool, input);

	// A path outside the project is refused before any rule
	if (tool !== 'bash' && input.path && !FUNC.resolve(run.root, input.path)) {
		callback('deny', 'The path is outside the project. Use a path inside it.');
		return;
	}

	NOSQL('permissions').find().where('projectid', run.projectid).callback(function(err, rules) {

		var found = null;
		var best = -1;

		for (var rule of (rules || [])) {
			if (rule.tool !== tool && rule.tool !== '*')
				continue;
			if (rule.pattern && !FUNC.glob(rule.pattern).test(text))
				continue;
			var score = (rule.tool === tool ? 2 : 0) + (rule.pattern ? 1 : 0);
			if (score > best || (score === best && rule.action === 'deny')) {
				best = score;
				found = rule.action;
			}
		}

		if (!found) {
			if (READONLY[tool] || (tool === 'bash' && READONLY_COMMANDS.test(text)))
				found = 'allow';
			else if ((tool === 'write' || tool === 'edit' || tool === 'patch') && run.autoaccept)
				found = 'allow';
			else
				found = 'ask';
		}

		if (found !== 'ask') {
			callback(found, found === 'deny' ? 'Denied by a permission rule. Do not try again; tell the user what you wanted to do.' : null);
			return;
		}

		// Ask the user and wait for Permissions|reply
		var id = UID();
		MAIN.asks[id] = { sessionid: run.sessionid, tool: tool, text: text, callback: callback, projectid: run.projectid };
		FUNC.emit(run.sessionid, 'permission.ask', { id: id, tool: tool, input: input, patterns: [text] });
	});
};

// The user answered: reply is 'once', 'always' or 'reject'
exports.reply = function(id, reply) {

	var ask = MAIN.asks[id];
	if (!ask || ask.kind === 'question')
		return false;

	delete MAIN.asks[id];

	if (reply === 'always')
		NOSQL('permissions').insert({ id: UID(), projectid: ask.projectid, tool: ask.tool, pattern: ask.text, action: 'allow', dtcreated: NOW });

	FUNC.emit(ask.sessionid, 'permission.replied', { id: id, reply: reply });
	ask.callback(reply === 'reject' ? 'deny' : 'allow', reply === 'reject' ? 'The user rejected this action. Do not try it again; explain what you wanted to change and ask how to proceed.' : null);
	return true;
};

// The user answered a question of the ask tool
exports.answer = function(id, answer) {

	var ask = MAIN.asks[id];
	if (!ask || ask.kind !== 'question')
		return false;

	delete MAIN.asks[id];
	FUNC.emit(ask.sessionid, 'question.replied', { id: id });
	ask.callback(answer);
	return true;
};

// Rejects every pending permission question and closes every question of a session (abort or removal)
exports.cancel = function(sessionid) {
	for (var id in MAIN.asks) {
		var ask = MAIN.asks[id];
		if (ask.sessionid !== sessionid)
			continue;
		if (ask.kind === 'question')
			exports.answer(id, '(no answer: the run was stopped)');
		else
			exports.reply(id, 'reject');
	}
};
