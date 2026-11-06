// Downloads a web page as text for the fetch tool: http(s) only, limited size, time and redirects.

exports.id = 'fetcher';

var MAXBYTES = 1024 * 1024;
var MAXREDIRECTS = 3;

function totext(html) {
	return html
		.replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, ' ')
		.replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)[^>]*>/gi, '\n')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, '\'')
		.replace(/[ \t]+/g, ' ')
		.replace(/\n\s*\n+/g, '\n\n')
		.trim();
}

exports.totext = totext;

// callback(err, text)
exports.get = function(address, callback, redirects) {

	var url;

	try {
		url = new URL(address);
	} catch (e) {
		callback('@(Invalid URL)');
		return;
	}

	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		callback('@(Only http and https URLs are allowed)');
		return;
	}

	var lib = url.protocol === 'https:' ? Total.Https : Total.Http;
	var done = false;

	function finish(err, text) {
		if (!done) {
			done = true;
			callback(err, text);
		}
	}

	var req = lib.request({ protocol: url.protocol, hostname: url.hostname, port: url.port, path: url.pathname + url.search, method: 'GET', headers: { 'user-agent': 'Total.js Totem', accept: 'text/html,text/plain,application/json,*/*;q=0.5' }, timeout: 15000 }, function(res) {

		if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
			res.resume();
			if ((redirects || 0) >= MAXREDIRECTS) {
				finish('@(Too many redirects)');
				return;
			}
			done = true;
			exports.get(new URL(res.headers.location, url).toString(), callback, (redirects || 0) + 1);
			return;
		}

		if (res.statusCode >= 400) {
			res.resume();
			finish('HTTP ' + res.statusCode);
			return;
		}

		var chunks = [];
		var size = 0;

		res.on('data', function(chunk) {
			size += chunk.length;
			if (size <= MAXBYTES)
				chunks.push(chunk);
			else
				res.destroy();
		});

		res.on('close', function() {
			var body = Buffer.concat(chunks).toString('utf8');
			var type = res.headers['content-type'] || '';
			finish(null, /html/i.test(type) ? totext(body) : body);
		});
	});

	req.on('timeout', () => req.destroy(new Error('Timeout')));
	req.on('error', err => finish(err.message));
	req.end();
};
