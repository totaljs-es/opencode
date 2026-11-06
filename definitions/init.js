ON('ready', function() {

	// A secret for the keys of the providers, created once and saved with the data
	if (!CONF.secret) {
		var file = PATH.databases('secret.txt');
		if (Total.Fs.existsSync(file))
			CONF.secret = Total.Fs.readFileSync(file, 'utf8').trim();
		else {
			CONF.secret = GUID(40);
			Total.Fs.writeFileSync(file, CONF.secret, { mode: 384 });
		}
	}

	MAIN.base = Total.Fs.readFileSync(PATH.private('prompts/base.txt'), 'utf8');

	FUNC.providers();

	COMPONENTATOR('ui', 'exec,locale,page,viewbox,navlayout,form,importer,input,box,validate,loading,intranetcss,notify,message,errorhandler,empty,menu,autofill,enter,approve,shortcuts,search,searchinput,directory,icons,listing,clipboard,virtualwire', true);
});
