// Worktrees: a session can work in its own git worktree, a second checkout of the project on its own branch, so that sessions that run in
// parallel do not change the same files. The worktree lives in .totem/worktrees/<id> of the project (kept out of git status through
// .git/info/exclude, never through a file of the project) and the branch is totem/<id>. Totem never deletes a branch or a worktree by
// itself: Discard (the user) and a removed session (the user) are the only ways, and the interface says what would be lost.

exports.id = 'worktrees';

var TIMEOUT = 20000;

function run(root, args, callback) {
	var env = { PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG || 'en_US.UTF-8', GIT_OPTIONAL_LOCKS: '0' };
	Total.Child.execFile('git', args, { cwd: root, env: env, timeout: TIMEOUT, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => callback(err ? ((stderr || '').trim() || err.message) : null, (stdout || '').trim()));
}

// The author of the commits that Totem makes in a worktree when the repository has none configured
function identity(root, callback) {
	run(root, ['config', 'user.email'], function(err, email) {
		callback(err || !email ? ['-c', 'user.name=Totem', '-c', 'user.email=totem@localhost'] : []);
	});
}

// callback(err, { path, branch, base })
exports.create = function(root, id, callback) {

	var name = id.substring(0, 8);
	var branch = 'totem/' + name;
	var relative = '.totem/worktrees/' + name;
	var path = Total.Path.join(root, relative);

	run(root, ['rev-parse', '--verify', 'HEAD'], function(err) {

		if (err) {
			callback('@(A worktree needs a git repository with at least one commit)');
			return;
		}

		run(root, ['branch', '--show-current'], function(err, base) {
			run(root, ['worktree', 'add', '-b', branch, path], function(err) {

				if (err) {
					callback(err);
					return;
				}

				// Out of git status without touching a file of the project
				run(root, ['rev-parse', '--git-path', 'info/exclude'], function(err, file) {
					if (!err && file) {
						var full = Total.Path.resolve(root, file);
						try {
							var text = Total.Fs.existsSync(full) ? Total.Fs.readFileSync(full, 'utf8') : '';
							if (text.indexOf('/.totem/worktrees/') === -1) {
								Total.Fs.mkdirSync(Total.Path.dirname(full), { recursive: true });
								Total.Fs.appendFileSync(full, (text && !text.endsWith('\n') ? '\n' : '') + '/.totem/worktrees/\n');
							}
						} catch (e) {}
					}
					callback(null, { path: path, branch: branch, base: base || '' });
				});
			});
		});
	});
};

// callback({ branch, base, ahead, changes }): the commits of the branch that the base does not have and the files that are not committed
exports.state = function(root, worktree, callback) {

	if (!Total.Fs.existsSync(worktree.path)) {
		callback({ branch: worktree.branch, base: worktree.base, ahead: 0, changes: 0, missing: true });
		return;
	}

	run(worktree.path, ['status', '--porcelain'], function(err, status) {
		run(root, ['rev-list', '--count', (worktree.base || 'HEAD') + '..' + worktree.branch], function(err2, ahead) {
			callback({ branch: worktree.branch, base: worktree.base, ahead: err2 ? 0 : (+ahead || 0), changes: err || !status ? 0 : status.split('\n').length });
		});
	});
};

// Commits what the session left in the worktree (if anything) and merges the branch into the branch that is checked out in the project.
// A conflict is undone: the project stays as it was. callback(err, message)
exports.merge = function(root, worktree, name, callback) {

	run(root, ['status', '--porcelain', '--untracked-files=no'], function(err, status) {

		if (err || status) {
			callback('@(The project has changes that are not committed: commit or stash them first)');
			return;
		}

		identity(worktree.path, function(who) {
			run(worktree.path, ['add', '-A'], function() {
				run(worktree.path, ['status', '--porcelain'], function(err, dirty) {

					function merge() {
						run(root, who.concat(['merge', '--no-ff', '-m', 'Merge ' + worktree.branch + ' (' + name + ')', worktree.branch]), function(err, output) {
							if (err) {
								run(root, ['merge', '--abort'], () => callback('@(The merge has conflicts and was undone. Merge the branch yourself:) ' + worktree.branch));
								return;
							}
							callback(null, output);
						});
					}

					if (!dirty) {
						merge();
						return;
					}

					run(worktree.path, who.concat(['commit', '-q', '-m', 'Totem: ' + name]), function(err) {
						err ? callback(err) : merge();
					});
				});
			});
		});
	});
};

// Removes the worktree and its branch (the user chose to discard the work)
exports.remove = function(root, worktree, callback) {
	run(root, ['worktree', 'remove', '--force', worktree.path], function(err) {
		// A worktree whose folder is gone is only a note of git
		run(root, ['worktree', 'prune'], function() {
			run(root, ['branch', '-D', worktree.branch], function() {
				callback(err && Total.Fs.existsSync(worktree.path) ? err : null);
			});
		});
	});
};
