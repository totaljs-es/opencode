#!/usr/bin/env node
'use strict';

// Smoke test of the Docker image. A tooling script that runs with plain Node.js: it is not part of the application.
//
//   node scripts/docker-smoke.js [image] [folder]     (default image: totem:test, build it first with `docker build -t totem:test .`;
//                                                      folder: where the temporary files go, it must be shared with Docker (Colima or Docker Desktop share the home folder, not /tmp))
//
// 1. Without an access token the container refuses to start.
// 2. With a token (a Docker secret) and a mounted project it serves, refuses a request without the token, opens the mounted project,
//    lists its files and runs a command in an interactive shell inside the container (the pseudo-terminal needs python3).
// It uses a temporary folder and a container that it removes at the end. It never touches the data of a real installation.

var Child = require('child_process');
var Fs = require('fs');
var Http = require('http');
var Os = require('os');
var Path = require('path');

var IMAGE = process.argv[2] || 'totem:test';
var BASE = process.argv[3] || Os.tmpdir();
var TOKEN = 'smoke-' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
var NAME = 'totem-smoke-' + process.pid;
var failed = 0;

function check(name, ok, detail) {
	console.log((ok ? '[OK] ' : '[FAIL] ') + name + (ok || !detail ? '' : ' (' + detail + ')'));
	if (!ok)
		failed++;
}

function docker(args, options) {
	return Child.spawnSync('docker', args, Object.assign({ encoding: 'utf8' }, options || {}));
}

function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function request(port, schema, data, token) {
	return new Promise(function(resolve, reject) {
		var body = JSON.stringify({ schema: schema, data: data || {} });
		var headers = { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) };
		if (token)
			headers['x-token'] = token;
		var req = Http.request({ hostname: '127.0.0.1', port: port, path: '/api/', method: 'POST', headers: headers }, function(res) {
			var text = '';
			res.on('data', chunk => text += chunk);
			res.on('end', function() {
				var json = null;
				try {
					json = JSON.parse(text);
				} catch (e) {}
				resolve({ status: res.statusCode, json: json, text: text });
			});
		});
		req.on('error', reject);
		req.end(body);
	});
}

async function until(fn, ms) {
	var started = Date.now();
	while (Date.now() - started < (ms || 30000)) {
		var value = await fn();
		if (value)
			return value;
		await sleep(500);
	}
	return null;
}

async function main() {

	if (docker(['image', 'inspect', IMAGE]).status !== 0) {
		console.error('The image ' + IMAGE + ' does not exist. Build it with: docker build -t ' + IMAGE + ' .');
		process.exit(2);
	}

	// 1. No token: it must stop by itself and say why
	var run = docker(['run', '--rm', '--name', NAME + '-notoken', IMAGE], { timeout: 60000 });
	check('without a token the container refuses to start', run.status !== 0 && /no access token/.test((run.stdout || '') + (run.stderr || '')), 'exit ' + run.status);

	// 2. With a token and a mounted project
	var dir = Fs.mkdtempSync(Path.join(BASE, 'totem-smoke-'));
	var project = Path.join(dir, 'project');
	Fs.mkdirSync(project);
	Fs.writeFileSync(Path.join(project, 'hello.txt'), 'hello from the host\n');
	Fs.writeFileSync(Path.join(dir, 'token.txt'), TOKEN + '\n');
	Fs.mkdirSync(Path.join(dir, 'data'));

	// The container user (node, uid 1000) must be able to write where the host user mounts
	Fs.chmodSync(project, 0o777);
	Fs.chmodSync(Path.join(dir, 'data'), 0o777);

	var started = docker(['run', '-d', '--name', NAME, '-p', '127.0.0.1::8000',
		'-v', Path.join(dir, 'token.txt') + ':/run/secrets/totem_token:ro',
		'-v', project + ':/workspace/project',
		'-v', Path.join(dir, 'data') + ':/data', IMAGE]);

	if (started.status !== 0) {
		check('the container starts with a token', false, started.stderr);
		return cleanup(dir);
	}

	try {

		var port = +docker(['port', NAME, '8000/tcp']).stdout.trim().split(':').pop();
		var up = await until(async function() {
			try {
				return (await request(port, 'projects_files/none', {}, TOKEN)).status > 0;
			} catch (e) {
				return false;
			}
		});

		check('the container serves with a token', !!up, docker(['logs', '--tail', '20', NAME]).stdout);

		if (!up)
			return cleanup(dir);

		var denied = await request(port, 'projects_git/none');
		check('a request without the token is refused', denied.status === 401 || (denied.json && !Array.isArray(denied.json)) || /invalid|unauthorized/i.test(denied.text), denied.status + ' ' + denied.text.substring(0, 80));

		var opened = await request(port, 'projects_open', { path: '/workspace/project' }, TOKEN);
		var id = opened.json && opened.json.id;
		check('the mounted project opens', !!id, opened.text.substring(0, 120));

		if (id) {
			var files = await request(port, 'projects_files/' + id, {}, TOKEN);
			check('the files of the mounted project are listed', /hello\.txt/.test(files.text), files.text.substring(0, 120));

			var created = await request(port, 'sessions_create', { projectid: id, model: 'none' }, TOKEN);
			var sessionid = created.json && created.json.id;
			check('a session is created', !!sessionid, created.text.substring(0, 120));

			if (sessionid) {
				var terminal = await request(port, 'sessions_terminal/' + sessionid, { start: true, columns: 80, rows: 24 }, TOKEN);
				check('the interactive shell starts in the container', terminal.json && terminal.json.status === 'running', terminal.text.substring(0, 120));
				var keys = Buffer.from('pwd; cat hello.txt; id -u\n').toString('base64');
				await request(port, 'sessions_terminalinput/' + sessionid, { data: keys }, TOKEN);
				var output = await until(async function() {
					var r = await request(port, 'sessions_terminal/' + sessionid, {}, TOKEN);
					return r.json && /hello from the host/.test(r.json.output) ? r.json.output : null;
				}, 15000);
				check('the shell runs in the mounted project', !!output && /\/workspace\/project/.test(output), output || '');
				check('the container does not run as root', !!output && /\n1000\r?\n/.test(output) && !/\n0\r?\n/.test(output.split('id -u').pop()), '');
			}
		}
	} finally {
		cleanup(dir);
	}
}

function cleanup(dir) {
	docker(['rm', '-f', NAME]);
	Fs.rmSync(dir, { recursive: true, force: true });
}

main().then(function() {
	console.log(failed ? ('\n' + failed + ' check(s) failed') : '\nAll checks passed');
	process.exit(failed ? 1 : 0);
}).catch(function(err) {
	console.error(err);
	docker(['rm', '-f', NAME]);
	process.exit(1);
});
