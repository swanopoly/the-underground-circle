#!/usr/bin/env node

function decodePayload(raw) {
  const json = Buffer.from(String(raw || ''), 'base64').toString('utf8');
  return JSON.parse(json);
}

function getPage(stagehand) {
  if (stagehand?.context?.activePage) {
    const page = stagehand.context.activePage();
    if (page) return page;
  }
  if (stagehand?.context?.pages) {
    const pages = stagehand.context.pages();
    if (Array.isArray(pages) && pages[0]) return pages[0];
  }
  return null;
}

async function pageUrl(page) {
  if (!page) return undefined;
  try {
    if (typeof page.url === 'function') return await page.url();
    if (typeof page.url === 'string') return page.url;
  } catch {}
  return undefined;
}

async function run() {
  const payload = decodePayload(process.argv[2]);
  const { Stagehand } = await import('@browserbasehq/stagehand');

  const config = {
    env: 'BROWSERBASE',
    apiKey: payload.apiKey,
    verbose: 0,
    keepAlive: true,
    ...(payload.sessionId
      ? { browserbaseSessionID: payload.sessionId }
      : {
          browserbaseSessionCreateParams: {
            projectId: payload.projectId,
            ...(payload.region ? { region: payload.region } : {}),
          },
        }),
  };

  const stagehand = new Stagehand(config);
  await stagehand.init();

  const page = getPage(stagehand);
  if (!page) {
    throw new Error('Stagehand did not expose an active page');
  }

  if (payload.mode === 'init') {
    console.log(JSON.stringify({
      ok: true,
      sessionId: stagehand.sessionId || payload.sessionId || null,
      currentUrl: await pageUrl(page),
    }));
    return;
  }

  if (payload.mode === 'screenshot') {
    const bytes = await page.screenshot({ type: 'png' });
    console.log(JSON.stringify({
      ok: true,
      sessionId: stagehand.sessionId || payload.sessionId || null,
      currentUrl: await pageUrl(page),
      screenshot: Buffer.from(bytes).toString('base64'),
    }));
    return;
  }

  const action = payload.action || {};
  switch (action.type) {
    case 'navigate':
      await page.goto(action.target || '');
      break;
    case 'click':
      await stagehand.act(action.description || `Click ${action.target || 'the target element'}`);
      break;
    case 'fill':
      await stagehand.act(action.description || `Fill ${action.target || 'the field'} with ${action.value || ''}`);
      break;
    case 'select':
      await stagehand.act(action.description || `Select ${action.value || ''} for ${action.target || 'the dropdown'}`);
      break;
    case 'press_key':
      if (typeof page.keyPress === 'function') {
        await page.keyPress(action.value || action.target || '');
      } else {
        await stagehand.act(action.description || `Press the ${action.value || action.target || 'requested'} key`);
      }
      break;
    case 'scroll':
      await stagehand.act(action.description || `Scroll ${action.value === 'up' ? 'up' : 'down'} one page`);
      break;
    case 'wait': {
      const ms = Math.min(parseInt(action.value || '1000', 10) || 1000, 10000);
      await new Promise((resolve) => setTimeout(resolve, ms));
      break;
    }
    case 'screenshot':
      break;
    default:
      throw new Error(`Unsupported Stagehand action type: ${action.type || 'unknown'}`);
  }

  console.log(JSON.stringify({
    ok: true,
    sessionId: stagehand.sessionId || payload.sessionId || null,
    currentUrl: await pageUrl(page),
  }));
}

run().catch((error) => {
  console.log(JSON.stringify({
    ok: false,
    error: error?.message || String(error),
  }));
  process.exit(1);
});
