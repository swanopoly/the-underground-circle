const APP_CAPABILITY_LABEL_RE = /\bAPP_CAPABILITY_(?:RESULT_JSON|SUMMARY)\b/i;

function clean(value, max = 4000) {
  return String(value || '').replace(/\r/g, '').trim().slice(0, max);
}

function preview(value, max = 180) {
  const text = clean(value, max * 2).replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function textFromContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (!part || typeof part !== 'object') return '';
      return part.text || part.output_text || part.input_text || '';
    })
    .filter(Boolean)
    .join('\n');
}

function textFromRecord(record) {
  if (!record || typeof record !== 'object') return { role: '', text: '' };
  const payload = record.payload || {};
  if (record.type === 'event_msg' && payload.type === 'agent_message') {
    return { role: 'assistant', text: clean(payload.message, 8000) };
  }
  if (record.type === 'event_msg' && payload.type === 'user_message') {
    return { role: 'user', text: clean(payload.message, 8000) };
  }
  if (record.type === 'response_item' && payload.type === 'message') {
    return {
      role: payload.role || '',
      text: clean(textFromContent(payload.content), 8000),
    };
  }
  if (record.type === 'response_item' && payload.type === 'function_call_output') {
    return { role: 'tool', text: clean(payload.output, 8000) };
  }
  return { role: '', text: '' };
}

function sectionLineValue(text, label) {
  const match = clean(text, 8000).match(new RegExp(`^\\s*${label}\\s*:?\\s*(.*)$`, 'im'));
  return match ? clean(match[1], 1000) : '';
}

function isNoneLike(value) {
  return /^(none|n\/a|na|not needed|no user action needed|nothing needed|no blockers?|not applicable)$/i.test(clean(value, 500));
}

function classifyAppCapabilityResultText(text) {
  const value = clean(text, 8000);
  if (!APP_CAPABILITY_LABEL_RE.test(value)) return null;
  const userActionNeeded = sectionLineValue(value, 'USER_ACTION_NEEDED');
  const verification = sectionLineValue(value, 'VERIFICATION');
  const explicitStatus = sectionLineValue(value, 'APP_CAPABILITY_STATUS');
  const verificationBlocked = verification
    && /\b(fail(?:ed|ure)?|blocked|blocker|error|not run|could not|cannot|unable|missing|needs? user|permission|license|login|credential|mfa|captcha)\b/i.test(verification);
  const blocked = /^blocked$/i.test(explicitStatus)
    || /"status"\s*:\s*"blocked"/i.test(value)
    || verificationBlocked
    || (userActionNeeded && !isNoneLike(userActionNeeded));
  if (blocked) return 'blocked';
  const verified = /\b(pass(?:ed)?|verified|success|succeeded|clean|ok|green)\b/i.test(verification)
    || /\b(pass(?:ed)?|verified|success|succeeded|clean|ok|green)\b/i.test(value);
  const hasRetryPlan = /\bRETRY_PLAN\s*:?/i.test(value) || /"retryPlan"\s*:\s*"[^"]+"/i.test(value);
  if (verified && hasRetryPlan) return 'ready_to_retry';
  return 'incomplete';
}

function summarizeCodexJsonl(content) {
  const lines = clean(content, 512 * 1024).split('\n').filter(Boolean);
  let model = '';
  let sessionMarker = '';
  let messageCount = 0;
  let lastUserMessage = '';
  let lastAssistantMessage = '';
  let lastAgentMessage = '';
  let appCapabilityResultText = '';
  let appCapabilityResultStatus = null;

  for (const line of lines) {
    let record = null;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    model = record.model || record.payload?.model || model;
    const { role, text } = textFromRecord(record);
    if (!text) continue;
    const marker = text.match(/\[UC-CODEX:([^\]]+)\]/);
    if (marker?.[1]) sessionMarker = marker[1];
    if (role === 'user') {
      lastUserMessage = text;
      messageCount += 1;
    } else if (role === 'assistant') {
      lastAssistantMessage = text;
      lastAgentMessage = text;
      messageCount += 1;
    }
    if (APP_CAPABILITY_LABEL_RE.test(text)) {
      appCapabilityResultText = text;
      appCapabilityResultStatus = classifyAppCapabilityResultText(text);
    }
  }

  return {
    model,
    sessionMarker,
    messageCount,
    lastUserMessage,
    lastAssistantMessage,
    lastAgentMessage,
    appCapabilityResultText,
    appCapabilityResultStatus,
  };
}

function buildCodexSessionRecentActions(summary, fallback = []) {
  const actions = Array.isArray(fallback) ? fallback.slice(-4) : [];
  if (summary.appCapabilityResultStatus) {
    actions.push(`App capability result: ${summary.appCapabilityResultStatus}`);
  }
  if (summary.lastAgentMessage) {
    actions.push(`Agent: ${preview(summary.lastAgentMessage, 160)}`);
  } else if (summary.lastUserMessage) {
    actions.push(`Prompt: ${preview(summary.lastUserMessage, 160)}`);
  }
  return actions.filter(Boolean).slice(-6);
}

module.exports = {
  APP_CAPABILITY_LABEL_RE,
  buildCodexSessionRecentActions,
  classifyAppCapabilityResultText,
  summarizeCodexJsonl,
  textFromRecord,
};
