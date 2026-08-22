#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const repositoryRoot = process.cwd();
const sourcePath = path.resolve(repositoryRoot, 'public/404.html');
const destinationDirectory = path.resolve(repositoryRoot, 'dist');
const destinationPath = path.resolve(destinationDirectory, '404.html');

if (!fs.existsSync(sourcePath)) {
  throw new Error('[copy-web-static-files] public/404.html is missing');
}
if (!fs.existsSync(destinationDirectory) || !fs.statSync(destinationDirectory).isDirectory()) {
  throw new Error('[copy-web-static-files] dist is missing; run the Expo web export first');
}

fs.copyFileSync(sourcePath, destinationPath);
console.log('[copy-web-static-files] copied public/404.html to dist/404.html');
