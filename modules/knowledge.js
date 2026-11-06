// The documentation of Forge for the request of the user. When the Forge server is connected, its search runs with the text of the
// prompt and the best pages are read and kept for the system prompt. A small model does not call tools well, but it writes well
// from a page that is already in front of it. The pages are shown in the conversation, so the user sees what was used.

exports.id = 'knowledge';

var MINLENGTH = 12;

// Words that say nothing about the topic, in Spanish and English: the search of Forge works with words
var STOP = ('quiero quisiera necesito puedo puedes hacer haz crear crea escribe escribir un una unos unas el la los las de del en con para por como cual que y o a al lo es me mi tu su se no si ' +
	'i want would like need make write create build the an and or to of in on for with how do does can could you please my me is are it this that there some a').split(' ').reduce((map, word) => (map[word] = 1, map), {});

// The pages of Forge are in English: the words of the topic that people write in Spanish are translated
var ES = { componente: 'component', componentes: 'component', formulario: 'form', formularios: 'form', ruta: 'route', rutas: 'route', 'acción': 'action', accion: 'action', esquema: 'schema', pantalla: 'page', 'botón': 'button', boton: 'button', tabla: 'table', lista: 'list', vista: 'view', vistas: 'view', 'validación': 'validation', 'autenticación': 'authentication', 'sesión': 'session', archivo: 'file', archivos: 'file', subir: 'upload', estilos: 'css', 'diseño': 'design' };

// The words of the prompt that matter, and the product of Forge that the prompt is about
function route(text) {

	var words = text.toLowerCase().replace(/[^a-z0-9áéíóúñü._-]+/g, ' ').split(' ').filter(word => word.length > 2 && !STOP[word]).map(word => ES[word] || word);
	var product = '';

	// Someone who wants to make a component is looking for the recipe that writes one
	if (words.indexOf('component') !== -1 && /\b(hacer|haz|crear|crea|escribe|escribir|make|create|write|build|new|nuevo|nueva)\b/i.test(text) && words.indexOf('custom') === -1)
		words.unshift('custom');

	if (/jcomponent|ui-component|ui-bind|\bcomponent\(|\bcomponentator|\bplugin\(|tangular/i.test(text))
		product = 'jcomponent';
	else if (/total\.?js|total5|newaction|newschema|\broute\(|\bdata\.|nosql|filestorage|restbuilder|schema/i.test(text))
		product = 'total5';

	return { query: (words.join(' ') || text).substring(0, 200), product: product };
}

exports.route = route;

function parse(text) {
	try {
		return JSON.parse(text);
	} catch (e) {
		return null;
	}
}

// callback([{ title, url }]) with the pages that were added to run.knowledge (an empty list when there is nothing to add)
exports.prefetch = function(run, text, callback) {

	var pages = CONF.forgepages == null ? 2 : CONF.forgepages;

	run.knowledge = '';

	if (!pages || !run.mcp || !run.mcp.tools.forge__Forge_search || !run.mcp.tools.forge__Forge_page || (text || '').trim().length < MINLENGTH || /^\//.test(text.trim())) {
		callback([]);
		return;
	}

	var asked = route(text.trim());

	function search(input, next) {
		MODS.mcpclient.call(run, 'forge__Forge_search', { input: input }, function(err, output) {
			var json = err ? null : parse(output);
			next((json && json.results) || []);
		}, 8000);
	}

	var input = { query: asked.query, limit: 6 };

	if (asked.product)
		input.product = asked.product;

	search(input, function(results) {

		// A search that is limited to a product and finds nothing is repeated without the limit
		if (!results.length && asked.product) {
			delete input.product;
			search(input, next);
			return;
		}

		next(results);
	});

	function next(results) {

		if (!results.length) {
			callback([]);
			return;
		}

		var chosen = results.slice(0, pages);
		var found = [];
		var blocks = [];

		chosen.wait(function(item, next) {

			MODS.mcpclient.call(run, 'forge__Forge_page', { input: { section: item.section, slug: item.slug, max_chars: CONF.forgechars || 3500 } }, function(err, content) {

				var page = err ? null : parse(content);

				if (page && page.markdown) {
					found.push({ title: item.title, url: item.url || page.url || '' });
					blocks.push('### {0} ({1})\n{2}'.format(item.title, item.url || page.url || '', page.markdown));
				}

				next();
			}, 8000);

		}, function() {

			if (!blocks.length) {
				callback([]);
				return;
			}

			// The other results of the search are listed, so that the model can read them with the page tool
			var more = results.slice(pages).map(r => '- {0} ({1} {2}): {3}'.format(r.title, r.section, r.slug, (r.description || '').substring(0, 120)));

			run.knowledge = 'Pages of Forge (https://forge.totaljs.es) that match the request of the user. Follow them: they are the documentation of Total.js 5 and jComponent 20.\n\n' + blocks.join('\n\n') + (more.length ? ('\n\nOther pages that may help (read one with forge__Forge_page, arguments { input: { section, slug } }):\n' + more.join('\n')) : '');

			callback(found);
		});
	}
};
