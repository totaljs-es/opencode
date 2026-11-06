exports.install = function() {
	ROUTE('+GET /', index);
	ROUTE('-GET /', login);
	ROUTE('-API ? +login --> Account|login');
	ROUTE('+API ? -logout --> Account|logout');
};

function index($) {
	$.view('index');
}

function login($) {

	// Without a token the server is local and the login page is not needed
	if (!CONF.token) {
		$.redirect('/');
		return;
	}

	$.view('login');
}
