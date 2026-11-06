// Registers the models of the configured providers. A model is addressed as "providerid:model".
// The provider `fake` is registered by the tests.
FUNC.providers = function(callback) {
	NOSQL('providers').find().callback(function(err, response) {

		MAIN.secrets = [];
		MAIN.modelmeta = {};

		for (var item of (response || [])) {

			var key = FUNC.decryptkey(item.key);
			if (key)
				MAIN.secrets.push(key);

			if (item.disabled)
				continue;
			for (var model of item.models) {
				var config = { url: item.url, key: key, model: model };
				NEWAIMODEL(item.id + ':' + model, config, MODS.provider.openai);
				MAIN.modelmeta[item.id + ':' + model] = (item.meta && item.meta[model]) || {};
			}
		}
		callback && callback();
	});
};
