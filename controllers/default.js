exports.install = function() {
	ROUTE('+GET /', index);
	ROUTE('-GET /', login);
	ROUTE('+GET /attachments/{id}/', attachment);
	ROUTE('-API ? +login --> Account|login');
	ROUTE('+API ? -logout --> Account|logout');
};

function index($) {
	$.view('index');
}

// A file that was attached to a prompt. Images keep their type; text files are always served as plain text so that a browser never runs them.
async function attachment($) {

	var meta = await NOSQL('attachments').read().where('id', $.params.id).promise();
	var buffer = meta && MODS.attachments.buffer(meta.id);

	if (!buffer) {
		$.fallback(404);
		return;
	}

	$.binary(buffer, meta.kind === 'image' ? meta.mime : 'text/plain; charset=utf-8');
}

function login($) {

	// Without a token the server is local and the login page is not needed
	if (!CONF.token) {
		$.redirect('/');
		return;
	}

	$.view('login');
}
