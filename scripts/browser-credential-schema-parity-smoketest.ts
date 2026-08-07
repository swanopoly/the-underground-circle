/**
 * Source-contract and runtime-boundary regression test for
 * browser.fill_credential_field's credential source XOR.
 *
 * Run: npx tsx scripts/browser-credential-schema-parity-smoketest.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import Ajv from 'ajv';
import ts from 'typescript';

process.env.EXPO_PUBLIC_SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL
  || 'https://credential-schema-parity.invalid.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
  || 'credential-schema-parity-anon-key';

const NATIVE_STUBS = new Set(['react-native', '@react-native-async-storage/async-storage']);
const STUB_URL = new URL('./native-module-stub.mjs', import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (NATIVE_STUBS.has(specifier)) return { url: STUB_URL, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

type JsonObject = Record<string, unknown>;

function propertyName(node: ts.PropertyName): string {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) {
    return node.text;
  }
  throw new Error(`Unsupported computed property in edge schema: ${node.getText()}`);
}

function literalValue(node: ts.Expression): unknown {
  let expression = node;
  while (
    ts.isAsExpression(expression)
    || ts.isTypeAssertionExpression(expression)
    || ts.isParenthesizedExpression(expression)
    || ts.isSatisfiesExpression(expression)
  ) {
    expression = expression.expression;
  }
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return expression.text;
  }
  if (ts.isNumericLiteral(expression)) return Number(expression.text.replaceAll('_', ''));
  if (expression.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (expression.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (expression.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isArrayLiteralExpression(expression)) {
    return expression.elements.map((element) => literalValue(element as ts.Expression));
  }
  if (ts.isObjectLiteralExpression(expression)) {
    const result: JsonObject = {};
    for (const property of expression.properties) {
      if (!ts.isPropertyAssignment(property)) {
        throw new Error(`Unsupported edge schema member: ${property.getText()}`);
      }
      result[propertyName(property.name)] = literalValue(property.initializer);
    }
    return result;
  }
  throw new Error(`Unsupported edge schema expression: ${expression.getText()}`);
}

function edgeCredentialSchema(): JsonObject {
  const sourceText = readFileSync('supabase/functions/swanbot-v2-ai/index.ts', 'utf8');
  const sourceFile = ts.createSourceFile(
    'supabase/functions/swanbot-v2-ai/index.ts',
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let schema: JsonObject | null = null;
  const visit = (node: ts.Node): void => {
    if (schema || !ts.isObjectLiteralExpression(node)) {
      if (!schema) ts.forEachChild(node, visit);
      return;
    }
    const nameProperty = node.properties.find(
      (property): property is ts.PropertyAssignment => (
        ts.isPropertyAssignment(property)
        && propertyName(property.name) === 'name'
      ),
    );
    const name = nameProperty && (
      ts.isStringLiteral(nameProperty.initializer)
      || ts.isNoSubstitutionTemplateLiteral(nameProperty.initializer)
    )
      ? nameProperty.initializer.text
      : null;
    if (name === 'browser.fill_credential_field') {
      const schemaProperty = node.properties.find(
        (property): property is ts.PropertyAssignment => (
          ts.isPropertyAssignment(property)
          && propertyName(property.name) === 'input_schema'
        ),
      );
      assert(schemaProperty, 'edge credential tool carries input_schema');
      schema = literalValue(schemaProperty.initializer) as JsonObject;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  assert(schema, 'edge credential schema was found');
  return schema;
}

function normalizedContract(schema: JsonObject): JsonObject {
  const properties = schema.properties as Record<string, JsonObject>;
  return {
    type: schema.type,
    properties: Object.fromEntries(
      Object.keys(properties).sort().map((key) => {
        const property = properties[key];
        return [key, {
          type: property.type,
          ...(property.enum ? { enum: property.enum } : {}),
          ...(property.minLength !== undefined ? { minLength: property.minLength } : {}),
          ...(property.minimum !== undefined ? { minimum: property.minimum } : {}),
          ...(property.maximum !== undefined ? { maximum: property.maximum } : {}),
        }];
      }),
    ),
    required: schema.required,
    oneOf: schema.oneOf,
    additionalProperties: schema.additionalProperties,
  };
}

async function main(): Promise<void> {
  const runtime = await import('../src/lib/openswanToolRuntime');
  const appDefinition = runtime.listOpenSwanToolsForSurface('main_chat')
    .find((definition) => definition.name === 'browser.fill_credential_field');
  assert(appDefinition?.inputSchema, 'app credential tool carries inputSchema');

  const appSchema = appDefinition.inputSchema as JsonObject;
  const edgeSchema = edgeCredentialSchema();
  assert.deepEqual(
    normalizedContract(edgeSchema),
    normalizedContract(appSchema),
    'app and edge advertise the same credential source contract',
  );

  const ajv = new Ajv({ allErrors: true, strict: false });
  for (const [surface, schema] of [['app', appSchema], ['edge', edgeSchema]] as const) {
    const validate = ajv.compile(schema);
    const cases: Array<[string, JsonObject, boolean]> = [
      ['circle vault source', { credentialId: 'credential-123', credentialField: 'password' }, true],
      ['1Password source', { item: 'WordPress Admin', credentialField: 'username' }, true],
      ['no source', { credentialField: 'password' }, false],
      ['both sources', { credentialId: 'credential-123', item: 'WordPress Admin', credentialField: 'password' }, false],
      ['empty credentialId', { credentialId: '', credentialField: 'password' }, false],
      ['empty item', { item: '', credentialField: 'password' }, false],
      ['missing credentialField', { credentialId: 'credential-123' }, false],
      ['unknown credentialField', { credentialId: 'credential-123', credentialField: 'otp' }, false],
      ['unknown property', { credentialId: 'credential-123', credentialField: 'password', secret: 'never' }, false],
      ['non-integer disambiguator', { item: 'WordPress Admin', credentialField: 'username', nth: 0.5 }, false],
    ];
    for (const [name, payload, expected] of cases) {
      assert.equal(validate(payload), expected, `${surface} schema: ${name}`);
    }
  }

  assert.deepEqual(
    runtime.resolveOpenSwanBrowserCredentialSource({ credentialId: '  credential-123  ' }),
    { ok: true, kind: 'circle_vault', credentialId: 'credential-123', item: '' },
    'runtime resolves and normalizes the circle-vault source',
  );
  assert.deepEqual(
    runtime.resolveOpenSwanBrowserCredentialSource({ item: '  WordPress Admin  ' }),
    { ok: true, kind: 'one_password', credentialId: '', item: 'WordPress Admin' },
    'runtime resolves and normalizes the 1Password source',
  );
  for (const [name, payload, message] of [
    ['neither source', {}, 'Pass exactly one credential source'],
    ['both sources', { credentialId: 'credential-123', item: 'WordPress Admin' }, 'not both'],
    ['both keys with one blank', { credentialId: 'credential-123', item: '' }, 'not both'],
    ['blank credentialId', { credentialId: '   ' }, 'credentialId must be a non-empty'],
    ['non-string item', { item: 42 }, 'item must be a non-empty'],
  ] as const) {
    const decision = runtime.resolveOpenSwanBrowserCredentialSource(payload);
    assert.equal(decision.ok, false, `runtime rejects ${name}`);
    assert.match((decision as { message: string }).message, new RegExp(message), `runtime explains ${name}`);
  }

  const context = { circleId: 'circle-schema-parity', userId: 'user-schema-parity' };
  for (const [name, payload] of [
    ['neither source', { credentialField: 'password' }],
    ['both sources', { credentialId: 'credential-123', item: 'WordPress Admin', credentialField: 'password' }],
  ] as const) {
    const result = await runtime.executeOpenSwanRuntimeTool(
      'browser.fill_credential_field',
      payload as never,
      context,
    );
    assert.equal(result.ok, false, `runtime boundary rejects ${name}`);
    assert.match(result.resultsText, /exactly one credential source/i, `runtime boundary explains ${name}`);
    assert.match(result.resultsText, /Nothing was filled\.$/, `runtime boundary proves no fill for ${name}`);
    assert.equal('approvalRequest' in result, false, `runtime boundary rejects ${name} before approval lookup`);
  }

  for (const [name, payload] of [
    ['valid 1Password source', { item: 'WordPress Admin', credentialField: 'password' }],
    ['valid circle vault source', { credentialId: 'credential-123', credentialField: 'username' }],
  ] as const) {
    const result = await runtime.executeOpenSwanRuntimeTool(
      'browser.fill_credential_field',
      payload as never,
      context,
    );
    assert.equal(result.ok, false, `runtime boundary disables ${name}`);
    assert.match(
      result.resultsText,
      /exact browser process, context, page, opaque URL, and field fingerprint/i,
      `runtime boundary requires exact target identity for ${name}`,
    );
    assert.match(
      result.resultsText,
      /no secret was fetched and nothing was filled/i,
      `runtime boundary proves no secret access or fill for ${name}`,
    );
    assert.equal('approvalRequest' in result, false, `runtime boundary disables ${name} before approval lookup`);
  }

  const runtimeSource = readFileSync('src/lib/openswanToolRuntime.ts', 'utf8');
  const wrapperStart = runtimeSource.indexOf('export async function executeOpenSwanRuntimeTool');
  const approvalStart = runtimeSource.indexOf('const constraintGate = await maybeBlockToolByConstraint', wrapperStart);
  const sourceGuard = runtimeSource.indexOf("if (tool === 'browser.fill_credential_field')", wrapperStart);
  assert(wrapperStart >= 0 && sourceGuard > wrapperStart && sourceGuard < approvalStart,
    'runtime source guard runs before constraint/approval lookup');
  const innerStart = runtimeSource.indexOf("case 'browser.fill_credential_field':", wrapperStart);
  const innerEnd = runtimeSource.indexOf("case 'browser.select_option':", innerStart);
  const innerSource = runtimeSource.slice(innerStart, innerEnd);
  assert(
    innerStart >= 0
      && innerEnd > innerStart
      && innerSource.indexOf('disabled at the inner dispatcher') < innerSource.indexOf('getCredentials'),
    'inner dispatcher blocks before any saved-secret lookup',
  );

  console.log('browser credential schema parity smoke passed (app + edge XOR, runtime fail-closed)');
}

void main();
