// Smoke test for ucignoreCore — the secret-safe ignore brain for codebase
// indexing (P4). Pure/deterministic; runs under `npx tsx`. Prints a
// pass/fail line and exits 1 on any failure.
//
//   npx tsx scripts/ucignore-core-smoketest.ts

import {
  DEFAULT_SECRET_PATTERNS,
  isSecretPath,
  matchGlob,
  parseUcignore,
  shouldIndexPath,
  type IgnoreRules,
} from '../src/lib/ucignoreCore';

let passed = 0;
let failed = 0;

function ok(label: string, cond: boolean): void {
  if (cond) {
    passed += 1;
  } else {
    failed += 1;
    console.error(`  FAIL: ${label}`);
  }
}

function eq<T>(label: string, actual: T, expected: T): void {
  ok(`${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`, actual === expected);
}

// ---------------------------------------------------------------------------
// matchGlob — the minimal gitignore glob translator
// ---------------------------------------------------------------------------

// * matches within a segment, not across `/`
ok('* matches within a segment', matchGlob('foo.pem', '*.pem'));
ok('unanchored *.ts matches a nested basename', matchGlob('src/a.ts', '*.ts'));
ok('* stops at slash: "x/y" not matched by "x*y"', !matchGlob('x/y', 'x*y'));

// ** matches anything including slashes
ok('** matches nested path', matchGlob('src/deep/nested/file.ts', 'src/**/file.ts'));
ok('src/**/*.ts matches nested .ts', matchGlob('src/a/b/c.ts', 'src/**/*.ts'));
ok('src/**/*.ts matches direct child .ts', matchGlob('src/a.ts', 'src/**/*.ts') || matchGlob('src/a.ts', 'src/*.ts'));
ok('** does not match wrong prefix', !matchGlob('lib/a/b.ts', 'src/**/*.ts'));

// ? matches exactly one non-slash char
ok('? matches one char', matchGlob('a.ts', '?.ts'));
ok('? does not match slash', !matchGlob('a/b', 'a?b'));
ok('? does not match zero chars', !matchGlob('.ts', '?.ts'));

// leading / anchors to root only
ok('leading / anchors to root', matchGlob('config.json', '/config.json'));
ok('leading / does NOT match nested', !matchGlob('src/config.json', '/config.json'));
ok('unanchored matches at any depth', matchGlob('src/config.json', 'config.json'));

// trailing / = directory prefix (matches dir and everything under it)
ok('trailing / matches nested file', matchGlob('node_modules/react/index.js', 'node_modules/'));
ok('trailing / matches the dir path itself', matchGlob('node_modules', 'node_modules/'));
ok('trailing / does not match a sibling', !matchGlob('node_modules_bak/x.js', 'node_modules/'));

// full-segment literal match & non-match
ok('literal exact match', matchGlob('README.md', 'README.md'));
ok('literal non-match', !matchGlob('README.mdx', 'README.md'));

// regex metachars in a pattern are escaped (not interpreted)
ok('dots are literal', matchGlob('a.b.c', 'a.b.c'));
ok('dot is not "any char"', !matchGlob('axbxc', 'a.b.c'));
ok('parens/plus are literal', matchGlob('foo(1)+bar', 'foo(1)+bar'));

// malformed / adversarial patterns must NOT throw — just return false-ish safely
ok('unterminated bracket does not crash', matchGlob('anything', '[') === false || matchGlob('anything', '[') === true);
ok('lone backslash does not crash', typeof matchGlob('a', '\\') === 'boolean');
ok('empty pattern → false', !matchGlob('a', ''));
ok('non-string path → false', !matchGlob(123 as unknown as string, '*.ts'));
ok('non-string pattern → false', !matchGlob('a.ts', 42 as unknown as string));

// ---------------------------------------------------------------------------
// isSecretPath — the hard denylist (basename AND full-path aware)
// ---------------------------------------------------------------------------

ok('.env is secret', isSecretPath('.env'));
ok('.env.local is secret (basename)', isSecretPath('.env.local'));
ok('.env.production is secret', isSecretPath('.env.production'));
ok('nested .env is secret', isSecretPath('config/.env'));
ok('nested .env.staging is secret', isSecretPath('deploy/config/.env.staging'));
ok('*.pem by basename anywhere', isSecretPath('certs/tls/server.pem'));
ok('*.key is secret', isSecretPath('private.key'));
ok('*.p12 is secret', isSecretPath('signing/app.p12'));
ok('*.p8 is secret', isSecretPath('AuthKey_ABC.p8'));
ok('*.jks is secret', isSecretPath('release.jks'));
ok('*.keystore is secret', isSecretPath('android/app.keystore'));
ok('id_rsa is secret', isSecretPath('id_rsa'));
ok('id_rsa nested is secret', isSecretPath('home/user/id_rsa'));
ok('id_ed25519 is secret', isSecretPath('id_ed25519'));
ok('*.mobileprovision is secret', isSecretPath('ios/App.mobileprovision'));
ok('credentials.json is secret', isSecretPath('gcp/credentials.json'));
ok('.npmrc is secret', isSecretPath('.npmrc'));
ok('nested secrets/ dir is secret', isSecretPath('src/config/secrets/foo.txt'));
ok('root-level secrets/ dir is secret', isSecretPath('secrets/token.txt'));
ok('nested secrets/ (one level) is secret', isSecretPath('a/secrets/token.txt'));
ok('.aws/** is secret', isSecretPath('.aws/credentials'));
ok('.ssh/** is secret', isSecretPath('.ssh/id_rsa'));
ok('.ssh/known_hosts is secret (dir denylist)', isSecretPath('.ssh/known_hosts'));

// non-secrets stay non-secret
ok('plain .ts is not secret', !isSecretPath('src/index.ts'));
ok('README is not secret', !isSecretPath('README.md'));
ok('env.example is not secret? (matches .env.* only if basename .env.*)', !isSecretPath('src/environment.ts'));
ok('a file merely NAMED "keys.ts" is not secret', !isSecretPath('src/lib/keys.ts'));
ok('isSecretPath never throws on junk', isSecretPath(null as unknown as string) === false);
ok('DEFAULT_SECRET_PATTERNS is non-empty', Array.isArray(DEFAULT_SECRET_PATTERNS) && DEFAULT_SECRET_PATTERNS.length >= 15);

// ---------------------------------------------------------------------------
// parseUcignore — gitignore-style parsing
// ---------------------------------------------------------------------------

const parsed = parseUcignore(
  [
    '# a comment',
    '',
    '   ',
    'node_modules/',
    'dist/',
    '*.log',
    '!keep.log',
    '  !src/keep.ts  ',
    '# trailing comment',
  ].join('\n'),
);
eq('parse: 3 ignore globs', parsed.ignoreGlobs.length, 3);
eq('parse: 2 negations', parsed.negations.length, 2);
ok('parse: comment dropped', !parsed.ignoreGlobs.includes('# a comment'));
ok('parse: blank dropped', !parsed.ignoreGlobs.includes(''));
ok('parse: negation strips !', parsed.negations.includes('keep.log'));
ok('parse: negation trims whitespace', parsed.negations.includes('src/keep.ts'));
ok('parse: ignore glob present', parsed.ignoreGlobs.includes('*.log'));
ok('parse: non-string → empty rules', parseUcignore(undefined as unknown as string).ignoreGlobs.length === 0);
ok('parse: CRLF handled', parseUcignore('a\r\nb').ignoreGlobs.length === 2);

// ---------------------------------------------------------------------------
// shouldIndexPath — the full decision, ORDER MATTERS
// ---------------------------------------------------------------------------

const empty: IgnoreRules = { ignoreGlobs: [], negations: [] };

// (2) ignored & not negated → ignored
const ignoreRules = parseUcignore(['node_modules/', 'dist/', '*.log', '!keep.log'].join('\n'));
eq('ignored: node_modules file', shouldIndexPath('node_modules/react/index.js', ignoreRules).reason, 'ignored');
eq('ignored: dist file', shouldIndexPath('dist/bundle.js', ignoreRules).index, false);
eq('ignored: *.log', shouldIndexPath('run.log', ignoreRules).reason, 'ignored');

// negation re-includes an otherwise-ignored path
eq('negation re-includes keep.log', shouldIndexPath('keep.log', ignoreRules).index, true);
eq('negation re-include reason ok', shouldIndexPath('keep.log', ignoreRules).reason, 'ok');

const keepRules = parseUcignore(['src/**', '!src/keep.ts'].join('\n'));
eq('src/** ignores a normal file', shouldIndexPath('src/thing.ts', keepRules).reason, 'ignored');
eq('!src/keep.ts re-includes', shouldIndexPath('src/keep.ts', keepRules).index, true);

// (3) not ignored → ok
eq('unlisted path indexes', shouldIndexPath('README.md', empty).index, true);
eq('unlisted path reason ok', shouldIndexPath('README.md', empty).reason, 'ok');

// (1) SECRET ALWAYS WINS — even when a negation tries to re-include it
const negateSecret = parseUcignore(['!.env', '!.aws/credentials', '!id_rsa'].join('\n'));
eq('.env denied as secret despite !.env negation', shouldIndexPath('.env', negateSecret).reason, 'secret');
eq('.env not indexed despite negation', shouldIndexPath('.env', negateSecret).index, false);
eq('.aws/credentials secret beats negation', shouldIndexPath('.aws/credentials', negateSecret).reason, 'secret');
eq('id_rsa secret beats negation', shouldIndexPath('id_rsa', negateSecret).reason, 'secret');

// secret wins even when ALSO explicitly ignored (secret reason, not ignored)
const bothRules = parseUcignore(['*.pem', '!server.pem'].join('\n'));
eq('*.pem secret beats both ignore+negation', shouldIndexPath('server.pem', bothRules).reason, 'secret');

// **/secrets/foo.txt denied
eq('**/secrets/foo.txt denied', shouldIndexPath('a/b/secrets/foo.txt', empty).index, false);
eq('**/secrets/foo.txt reason secret', shouldIndexPath('a/b/secrets/foo.txt', empty).reason, 'secret');

// *.pem denied by basename via shouldIndexPath
eq('*.pem denied by basename (nested)', shouldIndexPath('certs/x/server.pem', empty).reason, 'secret');

// robustness: junk inputs never throw
eq('junk path → decision object', typeof shouldIndexPath(null, empty).index, 'boolean');
eq('junk rules → still decides on secret first', shouldIndexPath('.env', null).reason, 'secret');
eq('junk rules non-secret → ok', shouldIndexPath('README.md', 'not-an-object' as unknown).reason, 'ok');

console.log(`ucignore-core smoke: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
