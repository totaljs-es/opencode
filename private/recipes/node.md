---
title: Files and Node.js modules: Total.Fs, Total.Path, Total.Crypto
keywords: file, files, fs, path, read, readfile, write, writefile, crypto, os, hash, require, node, module, archivo, archivos, leer, escribir, folder, directory
strong: total.fs, fs, require, total.path, total.crypto
---
Application code does not `require()` the modules of Node.js: they are in `Total` (case-sensitive): `Total.Fs`, `Total.Path`, `Total.Crypto`, `Total.Os`, `Total.Child`.

```js
var text = Total.Fs.readFileSync(PATH.root('data.txt'), 'utf8');
Total.Fs.writeFileSync(PATH.root('out.txt'), text.toUpperCase(), 'utf8');
var name = Total.Path.basename('/a/b/file.txt');
var hash = Total.Crypto.createHash('sha256').update(text).digest('hex');
```

`PATH.root('x')`, `PATH.public('x')`, `PATH.databases('x')`, `PATH.private('x')` build paths of the application.
