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
