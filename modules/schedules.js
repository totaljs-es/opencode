// Scheduled prompts: a prompt that Totem sends by itself, every N minutes or every day at a time of the server, in a new session of a project.
// Nobody is there to answer, so the run is unattended: a permission question is refused and a question of the model gets "nobody is here".
// A schedule runs in Plan mode (reads only) unless it says build; in build mode the file edits need auto-accept, and commands that are not
// read-only are refused, like in any other unattended run. A schedule never starts while its previous run is still going.

exports.id = 'schedules';

var MININTERVAL = 5;

// The time (a Date) of the last moment at HH:MM that is not after `now`
function lastdaily(time, now) {
	var parts = time.split(':');
	var date = new Date(now.getTime());
	date.setHours(+parts[0], +parts[1], 0, 0);
	if (date.getTime() > now.getTime())
		date.setDate(date.getDate() - 1);
	return date;
}

// Is it time to run the schedule? `last` is the end of the previous start, or the creation of the schedule
exports.due = function(item, now) {

	if (!item.enabled)
		return false;

	var last = new Date(item.dtlast || item.dtcreated).getTime();

	if (item.kind === 'daily')
		return lastdaily(item.time, now).getTime() > last;

	return now.getTime() - last >= Math.max(MININTERVAL, item.interval || 0) * 60000;
};

// When it will run next (a Date), for the interface
exports.next = function(item, now) {

	if (!item.enabled)
		return null;

	var last = new Date(item.dtlast || item.dtcreated);

	if (item.kind === 'daily') {
		var date = lastdaily(item.time, now);
		if (date.getTime() <= last.getTime() || date.getTime() <= now.getTime())
			date.setDate(date.getDate() + 1);
		return date;
	}

	return new Date(Math.max(now.getTime(), last.getTime() + Math.max(MININTERVAL, item.interval || 0) * 60000));
};

exports.valid = function(item) {

	if (item.kind === 'daily')
		return /^([01]\d|2[0-3]):[0-5]\d$/.test(item.time || '') ? '' : '@(The time is HH:MM, for example 07:30)';

	return item.interval >= MININTERVAL ? '' : ('@(The interval is at least {0} minutes)'.format(MININTERVAL));
};

// Starts the schedule now: a new session of the project with the prompt. callback(err, session)
exports.fire = async function(item, callback) {

	if (MAIN.scheduled[item.id]) {
		callback && callback('@(This schedule is still running)');
		return;
	}

	var project = await NOSQL('projects').read().where('id', item.projectid).promise();
	var error = '';

	if (!project)
		error = '@(The project does not exist any more)';
	else if (!item.model || !F.aimodels[item.model])
		error = '@(The model of this schedule is not available)';
	else if (!Total.Fs.existsSync(project.path))
		error = '@(The folder of the project does not exist)';

	if (error) {
		await NOSQL('schedules').modify({ dtlast: NOW, laststatus: 'error', lasterror: error }).where('id', item.id).promise();
		callback && callback(error);
		return;
	}

	MAIN.scheduled[item.id] = true;

	var stamp = NOW.format('yyyy-MM-dd HH:mm');
	var session = { id: UID(), projectid: item.projectid, name: (item.name + ' - ' + stamp).substring(0, 80), named: true, model: item.model, status: 'idle', autoaccept: !!item.autoaccept && item.mode === 'build', mode: item.mode === 'build' ? 'build' : 'plan', unattended: true, scheduleid: item.id, reasoning: '', maxsteps: CONF.maxsteps, dtcreated: NOW, dtupdated: NOW };
	var message = { id: UID(), sessionid: session.id, role: 'user', dtcreated: FUNC.stamp() };
	var part = { id: UID(), messageid: message.id, sessionid: session.id, type: 'text', data: { text: item.text }, dtcreated: NOW, seq: 0 };

	await NOSQL('sessions').insert(session).promise();
	await NOSQL('messages').insert(message).promise();
	await NOSQL('parts').insert(part).promise();
	await NOSQL('schedules').modify({ dtlast: NOW, laststatus: 'running', lasterror: '', lastsession: session.id }).where('id', item.id).promise();

	MODS.agent.run(session, project, message, function(err) {
		delete MAIN.scheduled[item.id];
		NOSQL('schedules').modify({ laststatus: err ? 'error' : 'done', lasterror: err ? ('' + (err.message || err)) : '' }).where('id', item.id).callback(NOOP);
	});

	callback && callback(null, session);
};

// Called every minute: starts what is due
exports.tick = async function(now) {

	now = now || NOW;

	var items = await NOSQL('schedules').find().where('enabled', true).promise();

	for (var item of items) {
		if (!MAIN.scheduled[item.id] && exports.due(item, now))
			await exports.fire(item);
	}
};

exports.clear = function(projectid) {
	return NOSQL('schedules').remove().where('projectid', projectid).promise();
};
