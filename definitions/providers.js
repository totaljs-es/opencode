// Registers the models of the configured providers. A model is addressed as "providerid:model".
// The provider `fake` is registered by the tests.
// The icon of a provider: the one it was saved with, or its id when public/img/providers has that icon
FUNC.providericon = function(item) {
	var icons = FUNC.providericons || (FUNC.providericons = (function() {
		var map = {};
		try {
			Total.Fs.readdirSync(PATH.public('img/providers')).forEach(file => /\.svg$/.test(file) && (map[file.replace(/\.svg$/, '')] = 1));
		} catch (e) {}
		return map;
	})());
	var icon = item.icon || item.id;
	return icons[icon] ? icon : '';
};

FUNC.providers = function(callback) {
	NOSQL('providers').find().callback(function(err, response) {

		MAIN.secrets = [];
		MAIN.modelmeta = {};
		MAIN.modelprov = {};

		for (var item of (response || [])) {

			var key = FUNC.decryptkey(item.key);
			if (key)
				MAIN.secrets.push(key);

			if (item.disabled)
				continue;
			for (var model of item.models) {
				var config = { url: item.url, key: key, model: model };
				NEWAIMODEL(item.id + ':' + model, config, MODS.provider.byKind(item.kind));
				MAIN.modelmeta[item.id + ':' + model] = (item.meta && item.meta[model]) || {};
				MAIN.modelprov[item.id + ':' + model] = { id: item.id, name: item.name, icon: FUNC.providericon(item) };
			}
		}
		callback && callback();
	});
};
