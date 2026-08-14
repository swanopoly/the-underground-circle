import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lock = require(path.join(root, 'package-lock.json'));
const packages = lock.packages || {};

assert.equal(packages['node_modules/uuid']?.version, '11.1.1', 'Jayson/xcode resolve the reviewed UUID override');
assert.equal(
  packages['node_modules/rpc-websockets/node_modules/uuid']?.version,
  '14.0.1',
  'the newer rpc-websockets UUID stays on its declared major',
);

const uuid = require('uuid');
assert.match(uuid.v4(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
assert.throws(
  () => uuid.v5('bounds-check', uuid.v5.DNS, new Uint8Array(4), 0),
  RangeError,
  'UUID v5 rejects an undersized caller buffer',
);

const jayson = require('jayson');
const request = jayson.Client.browser(() => {}).request('openswan.health', { exact: true });
assert.equal(request.jsonrpc, '2.0');
assert.equal(request.method, 'openswan.health');
assert.equal(typeof request.id, 'string');

const xcode = require('xcode');
const project = xcode.project('/tmp/openswan-compat-placeholder.pbxproj');
project.hash = { project: { objects: {} } };
assert.match(project.generateUuid(), /^[A-F0-9]{24}$/);

console.log('dependency override compatibility smoke passed (UUID, Jayson, xcode, rpc-websockets isolation)');
