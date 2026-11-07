// The conventions of Total.js 5 as a check of what the tools write. The check is a copy of tools/check.js of the conventions
// repository (private/conventions/SOURCE.md). It only looks at files of a Total.js 5 project, so any other project is left alone.

exports.id = 'conventions';

var checker = null;

function load() {
	if (!checker)
		checker = REQUIRE(PATH.private('conventions/check.js'));
	return checker;
}

// The findings about a file that a tool has just written, as text for the model; an empty text when there is nothing to say
exports.review = function(path, content) {

	if (CONF.conventions === false)
		return '';

	try {
		var result = load().hook({ tool_name: 'Write', tool_input: { file_path: path, content: content } });
		return result.message ? ('\n\n' + result.message) : '';
	} catch (e) {
		return '';
	}
};

// The code that the model shows in an answer, checked like the files that the tools write: [{ block, line, rule, severity, message }].
// Syntax, the rules of the conventions (tabs, ES5, names with |, texts with @()...) and the functions in capital letters that Total.js 5 does not have.
// A sketch with a line of "..." is not code to check. Only js and html blocks count.
var VM = null;

function syntaxof(code) {

	// Server-side template tokens outside of a string are not JavaScript until they are rendered
	if (/@\{/.test(code) || /[^'"`(\w]@\(/.test(code))
		return '';

	try {
		VM = VM || REQUIRE('node:vm');
		new VM.Script('(async function(){' + code + '\n})', { filename: 'answer' });
		return '';
	} catch (e) {
		return e.message;
	}
}

var SERVERCODE = /\b(NEWACTION|NEWSCHEMA|ROUTE|NOSQL|DATA|CRON|AUTH|FUNC|MAIN|MODS|RESTBuilder|UID|CONF)\b|exports\.install/;
var INTERFACE = /\b(COMPONENT|PLUGIN|COMPONENTATOR|SETTER)\(/;

exports.answer = function(text) {

	if (CONF.conventions === false || !text)
		return [];

	var found = [];
	var known = null;
	var regex = /```([A-Za-z0-9_+-]*)[^\n]*\n([\s\S]*?)```/g;
	var match;
	var number = 0;

	while ((match = regex.exec(text))) {

		var lang = match[1].toLowerCase();
		var js = lang === 'js' || lang === 'javascript';

		if (!js && lang !== 'html')
			continue;

		number++;
		var code = match[2].replace(/\s+$/, '') + '\n';

		if (/^\s*(\.\.\.|…|\/\/\s*\.\.\.)\s*$/m.test(code))
			continue;

		var add = function(line, rule, severity, message) {
			found.push({ block: number, line: line, rule: rule, severity: severity, message: message });
		};

		try {
			load().text(code, { file: 'answer', type: js ? 'js' : 'html' }).forEach(f => add(f.line, f.rule, f.severity, f.message));
		} catch (e) {}

		if (js) {

			var error = syntaxof(code);
			error && add(1, 'syntax', 'error', error);

			// A function of capital letters that Total.js 5 does not have (an invented one)
			if (SERVERCODE.test(code) && !INTERFACE.test(code)) {
				known = known || Object.keys(global).filter(key => /^[A-Z][A-Za-z0-9_]*$/.test(key));
				var declared = {};
				(code.match(/\b(?:function|var|let|const)\s+([A-Z][A-Z0-9_]+)\b/g) || []).forEach(d => declared[d.split(/\s+/)[1]] = true);
				var seen = {};
				(code.match(/(^|[^.\w$])[A-Z][A-Z0-9_]{2,}\(/gm) || []).forEach(function(call) {
					var name = call.replace(/^[^A-Z]*/, '').replace('(', '');
					if (!seen[name] && known.indexOf(name) === -1 && !declared[name]) {
						seen[name] = true;
						add(1, 'unknown-function', 'error', name + '() does not exist in Total.js 5: do not invent functions, use the recipes and pages above or say that you do not know');
					}
				});
			}
		}
	}

	return found;
};

// The message that asks the model to correct its answer (a request of its own, not stored: only this run has it)
exports.complaint = function(findings) {
	return 'Totem checked the code of your answer against the conventions of Total.js 5 and found this:\n' +
		findings.slice(0, 8).map(f => '- code block {0}, line {1}: {2} ({3}) {4}'.format(f.block, f.line, f.rule, f.severity, f.message)).join('\n') +
		(findings.length > 8 ? '\n- and {0} more'.format(findings.length - 8) : '') +
		'\n\nAnswer again with the same explanation and the corrected code. Indent with TABS. Use only functions that exist in Total.js 5. Do not add anything else.';
};
