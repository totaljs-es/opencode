// The interface speaks the language of the person: the choice made in Settings (a cookie) or else the language of the browser, else English.
// Texts are written in English inside the translation marker and translated with the native resources (resources/<language>.resource, see scripts/translations.js).
MAIN.languages = JSON.parse(Total.Fs.readFileSync(PATH.private('languages.json'), 'utf8'));
MAIN.languageids = new Set(MAIN.languages.map(language => language.id));
MAIN.defaultlanguage = 'en';

LOCALIZE(function($) {

	var chosen = $.cookie ? $.cookie('totemlang') : '';

	if (chosen && MAIN.languageids.has(chosen))
		return chosen;

	// The languages of the browser in order of preference: "es-ES,es;q=0.9,en;q=0.8"
	var list = (($.headers && $.headers['accept-language']) || '').split(',');

	for (var item of list) {
		var id = item.split(';')[0].trim().toLowerCase().split('-')[0];
		if (MAIN.languageids.has(id))
			return id;
	}

	return MAIN.defaultlanguage;
});
