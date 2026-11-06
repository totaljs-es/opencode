// Totem browser helpers

// Events from the server go to the chat plugin
ON('message', function(msg) {
	if (msg && msg.type && PLUGINS.chat && PLUGINS.chat.event)
		PLUGINS.chat.event(msg);
});

// Subscriptions are lost when the socket reconnects: the chat subscribes again
ON('online', function(is) {
	if (is && PLUGINS.chat && PLUGINS.chat.online)
		PLUGINS.chat.online();
});

// Tokens used by the model in a session, from the steps of its messages
Thelpers.tokens = function(items) {
	var total = 0;
	var cost = 0;
	(items || []).forEach(function(m) {
		(m.parts || []).forEach(function(p) {
			if (p.type === 'step' && p.data && p.data.tokens)
				total += (p.data.tokens.input || 0) + (p.data.tokens.output || 0);
			if (p.type === 'step' && p.data && p.data.cost)
				cost += p.data.cost;
		});
	});
	return total ? (total.format(0) + ' tokens' + (cost ? (' · $' + (cost < 0.01 ? cost.toFixed(4) : cost.toFixed(2))) : '')) : '';
};

Thelpers.shortpath = function(path) {
	if (!path)
		return '';
	var arr = path.split('/');
	return arr.length > 3 ? ('.../' + arr.slice(-2).join('/')) : path;
};

Thelpers.json = function(value) {
	if (value == null)
		return '';
	return Thelpers.encode(typeof(value) === 'string' ? value : JSON.stringify(value, null, 2));
};

// A unified patch as lines with a class per kind of line
Thelpers.diffhtml = function(patch) {
	if (!patch)
		return '';
	return patch.split('\n').map(function(line) {
		var type = line.charAt(0) === '+' ? 'add' : (line.charAt(0) === '-' ? 'del' : (line.indexOf('@@') === 0 ? 'hunk' : ''));
		return '<span' + (type ? (' class="' + type + '"') : '') + '>' + Thelpers.encode(line || ' ') + '</span>';
	}).join('');
};

// Theme: "auto" follows the system, "light" and "dark" are the choice of the user. The class ui-dark of the body is the one of IntranetCSS.
var THEME = {};

THEME.mode = function() {
	try {
		return localStorage.getItem('totemtheme') || 'auto';
	} catch (e) {
		return 'auto';
	}
};

THEME.apply = function(mode) {

	mode = mode || THEME.mode();

	try {
		localStorage.setItem('totemtheme', mode);
	} catch (e) {}

	var dark = mode === 'dark' || (mode === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
	APPEARANCE({ color: dark ? '#66B639' : '#3F8F2A', dark: dark });
	SET('common.theme', mode);
};

ON('ready', function() {

	THEME.apply();

	if (window.matchMedia) {
		window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function() {
			if (THEME.mode() === 'auto')
				THEME.apply('auto');
		});
	}
});

// The icon of a provider (public/img/providers). A provider without one gets its initial.
var PROVICONS = { openai: 1, anthropic: 1, gemini: 1, mistral: 1, ollama: 1, deepseek: 1, openrouter: 1, lmstudio: 1 };

Thelpers.provicon = function(icon, name, large) {
	var css = 'prov' + (large ? ' prov-large' : '');
	if (icon && PROVICONS[icon])
		return '<span class="' + css + '" style="--i:url(/img/providers/' + icon + '.svg)"></span>';
	return '<span class="' + css + ' mono">' + Thelpers.encode((name || '?').substring(0, 1).toUpperCase()) + '</span>';
};
