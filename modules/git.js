// The git state of a project folder, for the interface. It only reads: git is run with a timeout and a minimal environment.

exports.id = 'git';

var TIMEOUT = 5000;
var MAXFILES = 200;

function run(root, args, callback) {
	var env = { PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG || 'en_US.UTF-8', GIT_OPTIONAL_LOCKS: '0' };
	Total.Child.execFile('git', args, { cwd: root, env: env, timeout: TIMEOUT, maxBuffer: 1024 * 1024 }, (err, stdout) => callback(err, stdout || ''));
}

// The meaning of the two letters of `git status --porcelain`
function kind(code) {
	if (code === '??')
		return 'untracked';
	if (code.indexOf('U') !== -1 || code === 'AA' || code === 'DD')
		return 'conflict';
	if (code.indexOf('D') !== -1)
		return 'deleted';
	if (code.indexOf('A') !== -1)
		return 'added';
	if (code.indexOf('R') !== -1)
		return 'renamed';
	return 'modified';
}

// callback({ repository, branch, files: [{ path, status, staged }], more })
exports.status = function(root, callback) {

	run(root, ['rev-parse', '--is-inside-work-tree'], function(err, inside) {

		if (err || inside.trim() !== 'true') {
			callback({ repository: false, branch: '', files: [], more: 0 });
			return;
		}

		run(root, ['branch', '--show-current'], function(err, branch) {
			run(root, ['status', '--porcelain=v1', '-z', '--untracked-files=normal'], function(err, output) {

				var entries = output.split('\0').filter(Boolean);
				var files = [];

				for (var i = 0; i < entries.length; i++) {
					var entry = entries[i];
					var code = entry.substring(0, 2);
					// A rename is followed by the old name as its own entry
					if (code.charAt(0) === 'R' || code.charAt(0) === 'C')
						i++;
					files.push({ path: entry.substring(3), status: kind(code), staged: code.charAt(0) !== ' ' && code.charAt(0) !== '?' });
				}

				callback({ repository: true, branch: (branch || '').trim() || '(detached)', files: files.slice(0, MAXFILES), more: Math.max(files.length - MAXFILES, 0) });
			});
		});
	});
};
