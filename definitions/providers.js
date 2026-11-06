// Registers the models of the configured providers. A model is addressed as "providerid:model".
// The provider `fake` is registered by the tests.
FUNC.providers = function(callback) {
	NOSQL('providers').find().callback(function(err, response) {
		for (var item of (response || [])) {
			if (item.disabled)
				continue;
			for (var model of item.models) {
				var config = { url: item.url, key: FUNC.decryptkey(item.key), model: model };
				NEWAIMODEL(item.id + ':' + model, config, MODS.provider.openai);
			}
		}
		callback && callback();
	});
};
