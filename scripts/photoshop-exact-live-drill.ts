/**
 * Manual, Chrome-free live drill for the canonical Photoshop 600x600 exact
 * program.
 *
 * Default invocation is a strict dry run: it compiles/fingerprints the exact
 * program and performs no network or bridge call. Live execution requires both
 * `--live` and the exact fingerprint printed by dry mode:
 *
 *   npx tsx scripts/photoshop-exact-live-drill.ts
 *   UC_PHOTOSHOP_DRILL_CONFIRM=sha256:... \
 *     npx tsx scripts/photoshop-exact-live-drill.ts --live
 *
 * The live transport is fixed to 127.0.0.1:7778. It sends no Origin header,
 * keeps the pairing challenge/token inside one closure, and never retries a
 * create request after the mutation dispatch boundary is crossed.
 */

import http from 'node:http';
import {
  PHOTOSHOP_EXACT_DRILL_BRIDGE_HOST,
  PHOTOSHOP_EXACT_DRILL_BRIDGE_PORT,
  PHOTOSHOP_EXACT_DRILL_CONFIRM_ENV,
  isValidPhotoshopExactDrillPairingSecret,
  runPhotoshopExactDrill,
  validatePhotoshopExactDrillCall,
  type PhotoshopExactDrillCall,
  type PhotoshopExactDrillTransport,
} from './photoshop-exact-drill-core';

const MAX_RESPONSE_BYTES = 128 * 1024;

type RawResponse = {
  status: number;
  json: Record<string, unknown> | null;
};

function requestTimeoutMs(call: PhotoshopExactDrillCall): number {
  if (call.tool === 'desktop.photoshop_create_document') return 35_000;
  if (call.tool === 'desktop.photoshop_document_status') return 15_000;
  if (call.tool === 'desktop.wait_for_app') return 15_000;
  return 8_000;
}

/**
 * One bounded HTTP exchange. No Origin header is ever supplied. Errors are
 * collapsed to fixed codes rather than exposing socket text or response bodies.
 */
function rawLoopbackRequest(input: {
  method: 'GET' | 'POST';
  path: string;
  body?: Record<string, unknown>;
  token?: string;
  timeoutMs: number;
}): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const payload = input.method === 'POST' ? JSON.stringify(input.body || {}) : '';
    let timedOut = false;
    let responseTooLarge = false;
    const request = http.request(
      {
        hostname: PHOTOSHOP_EXACT_DRILL_BRIDGE_HOST,
        port: PHOTOSHOP_EXACT_DRILL_BRIDGE_PORT,
        method: input.method,
        path: input.path,
        headers: {
          ...(input.method === 'POST'
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
              }
            : {}),
          ...(input.token ? { 'X-UC-Desktop-Token': input.token } : {}),
          // Intentionally no Origin header. Pairing is a loopback CLI flow,
          // not a browser-origin request.
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let total = 0;
        response.on('data', (chunk: Buffer | string) => {
          if (responseTooLarge) return;
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          total += buffer.length;
          if (total > MAX_RESPONSE_BYTES) {
            responseTooLarge = true;
            response.destroy();
            return;
          }
          chunks.push(buffer);
        });
        response.on('end', () => {
          if (responseTooLarge) {
            reject(new Error('bridge_response_too_large'));
            return;
          }
          const raw = Buffer.concat(chunks).toString('utf8');
          let json: Record<string, unknown> | null = null;
          try {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              json = parsed as Record<string, unknown>;
            }
          } catch {
            json = null;
          }
          resolve({ status: response.statusCode || 0, json });
        });
        response.on('error', () => {
          reject(new Error(responseTooLarge ? 'bridge_response_too_large' : 'bridge_response_error'));
        });
      },
    );
    request.setTimeout(input.timeoutMs, () => {
      timedOut = true;
      request.destroy();
    });
    request.on('error', () => {
      reject(new Error(timedOut ? 'bridge_timeout' : 'bridge_transport_error'));
    });
    if (payload) request.write(payload);
    request.end();
  });
}

function createLoopbackBridgeTransport(): PhotoshopExactDrillTransport {
  // Security boundary: both values exist only inside this factory closure.
  // Neither is returned, logged, placed in a receipt, or attached to an error.
  let pairedToken = '';

  const pair = async (): Promise<Record<string, unknown>> => {
    const first = await rawLoopbackRequest({
      method: 'POST',
      path: '/desktop/pair',
      body: {},
      timeoutMs: 8_000,
    });
    const challenge = typeof first.json?.challenge === 'string'
      ? first.json.challenge
      : '';
    if (
      (first.status !== 200 && first.status !== 428)
      || first.json?.code !== 'pairing_challenge_required'
      || !isValidPhotoshopExactDrillPairingSecret(challenge)
    ) {
      throw new Error('pairing_challenge_unavailable');
    }

    const second = await rawLoopbackRequest({
      method: 'POST',
      path: '/desktop/pair',
      body: { pairingChallenge: challenge },
      timeoutMs: 8_000,
    });
    const token = typeof second.json?.token === 'string' ? second.json.token : '';
    if (second.status !== 200 || second.json?.ok !== true || !isValidPhotoshopExactDrillPairingSecret(token)) {
      throw new Error('pairing_exchange_failed');
    }
    pairedToken = token;
    return { ok: true };
  };

  return {
    async request(call: PhotoshopExactDrillCall): Promise<unknown> {
      const invalid = validatePhotoshopExactDrillCall(call);
      if (invalid) throw new Error(`drill_call_refused:${invalid}`);
      if (call.tool === 'bridge.pair') return pair();

      const isHealth = call.tool === 'bridge.health';
      if (!isHealth && !pairedToken) throw new Error('bridge_not_paired');
      const response = await rawLoopbackRequest({
        method: call.method,
        path: call.path,
        body: call.body,
        token: isHealth ? undefined : pairedToken,
        timeoutMs: requestTimeoutMs(call),
      });
      if (response.status < 200 || response.status >= 300) {
        // Do not expose the raw body. In particular, never auto-pair/replay a
        // rejected create: the core has already latched mutationDispatched.
        return { ok: false, errorCode: `bridge_http_${response.status || 0}` };
      }
      if (!response.json) return { ok: false, errorCode: 'bridge_invalid_json' };
      return response.json;
    },
    dispose(): void {
      // Strings cannot be zeroed in place; dropping the only retained closure
      // reference is the best-effort cleanup available in JavaScript.
      pairedToken = '';
    },
  };
}

async function main(): Promise<void> {
  const result = await runPhotoshopExactDrill({
    argv: process.argv.slice(2),
    env: process.env,
    // Lazy by contract: dry/refused modes return before this factory runs.
    transportFactory: () => createLoopbackBridgeTransport(),
  });

  if (result.receipt.status === 'dry_run') {
    console.log('Photoshop exact drill — DRY RUN (zero bridge/network/app calls)\n');
    console.log(`Task: ${result.manifest.task}`);
    console.log(`Authorization: ${result.manifest.authorizationMode}`);
    console.log(`Program: ${result.manifest.steps.map((step) => step.tool).join(' -> ')}`);
    console.log(`Fingerprint: ${result.manifest.fingerprint}`);
    console.log('\nTo run the one live 600x600 unsaved-document drill:');
    console.log(`${PHOTOSHOP_EXACT_DRILL_CONFIRM_ENV}=${result.manifest.fingerprint} npx tsx scripts/photoshop-exact-live-drill.ts --live`);
    console.log('\nReceipt:');
  } else if (result.receipt.status === 'gate_refused') {
    console.error('Photoshop exact drill — LIVE GATE REFUSED (zero bridge/network/app calls)');
    console.error(`Run dry mode first, then set ${PHOTOSHOP_EXACT_DRILL_CONFIRM_ENV} to the printed fingerprint and add --live.`);
  } else if (result.receipt.status === 'completed') {
    console.log('Photoshop exact drill — LIVE PASS');
  } else {
    console.error(`Photoshop exact drill — ${result.receipt.status.toUpperCase()}`);
  }

  // The receipt contains only bounded structural trace/proof fields. Pairing
  // challenge, token, headers, and raw response bodies never enter it.
  console.log(JSON.stringify(result.receipt, null, 2));
  process.exitCode = result.exitCode;
}

main().catch(() => {
  // Fail closed without echoing arbitrary error content.
  console.error('Photoshop exact drill — initialization failed before a verified terminal receipt.');
  process.exitCode = 3;
});
