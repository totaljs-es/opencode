exports.install = function() {

	// Account and application
	ROUTE('+API    ?    -account                    --> Account|read');

	// Projects
	ROUTE('+API    ?    -projects                   --> Projects|list');
	ROUTE('+API    ?    +projects_open              --> Projects|open');
	ROUTE('+API    ?    -projects_remove/{id}       --> Projects|remove');
	ROUTE('+API    ?    -projects_files/{id}        --> Projects|files');

	// Sessions
	ROUTE('+API    ?    -sessions                   --> Sessions|list');
	ROUTE('+API    ?    +sessions_create            --> Sessions|create');
	ROUTE('+API    ?    -sessions_read/{id}         --> Sessions|read');
	ROUTE('+API    ?    -sessions_remove/{id}       --> Sessions|remove');
	ROUTE('+API    ?    -sessions_messages/{id}     --> Sessions|messages');
	ROUTE('+API    ?    +sessions_prompt/{id}       --> Sessions|prompt', 1024 * 1024);
	ROUTE('+API    ?    -sessions_abort/{id}        --> Sessions|abort');

	// Permissions
	ROUTE('+API    ?    +permissions_reply/{id}     --> Permissions|reply');
	ROUTE('+API    ?    -permissions                --> Permissions|list');
	ROUTE('+API    ?    -permissions_remove/{id}    --> Permissions|remove');

	// Providers
	ROUTE('+API    ?    -providers                  --> Providers|list');
	ROUTE('+API    ?    +providers_save             --> Providers|save');
	ROUTE('+API    ?    -providers_remove/{id}      --> Providers|remove');
	ROUTE('+API    ?    -providers_models           --> Providers|models');

	// Events
	ROUTE('+SOCKET ?', socket);
};

function socket($) {

	MAIN.ws = $;
	$.autodestroy(() => MAIN.ws = null);

	$.on('open', function(client) {
		client.sessions = {};
	});

	$.on('message', function(client, msg) {
		if (msg.type === 'subscribe' && msg.sessionid)
			client.sessions[msg.sessionid] = true;
		else if (msg.type === 'unsubscribe' && msg.sessionid)
			delete client.sessions[msg.sessionid];
	});
}
