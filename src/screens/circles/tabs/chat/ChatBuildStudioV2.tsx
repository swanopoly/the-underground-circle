/**
 * ChatBuildStudioV2
 *
 * Improved Chat Live Builder. Week-1 roadmap items from
 * docs/CHAT_LIVE_BUILDER_ROADMAP.md. Adds over the root-owned V1:
 *   - Copy + Download in the header toolbar
 *   - Publish-to-WordPress button (queues a wp_post via scheduleAction)
 *   - Device-frame switcher (Desktop / Tablet / Mobile) over the preview
 *   - Runtime error overlay from an injected iframe runtime via postMessage
 *
 * V1 lives in src/components/chat/ChatBuildStudio.tsx and is root-owned;
 * this file supersedes it until V1 can be chowned and removed.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { SwanBotStructuredArtifact } from '../../../../lib/swanbot';
import {
  buildCodingWorkbenchLines,
  getCodingWorkbenchMetrics,
  getCodingWorkbenchPhase,
  inferCodingWorkbenchFileName,
} from '../../../../lib/codingWorkbench';
import { scheduleAction } from '../../../../lib/scheduledActions';
import { type BuilderRevision, describeRevisionAge } from '../../../../lib/builderHistory';
import { StreamTokenizer, TOKEN_COLORS } from '../../../../lib/syntaxTokens';
import { BUILDER_TEMPLATES, BUILDER_TEMPLATE_CATEGORIES, type BuilderTemplate, templatesByCategory } from '../../../../lib/builderTemplates';
import { publishPreview } from '../../../../lib/builderPublish';
import { type A11yIssue, countByLevel, runA11yAudit } from '../../../../lib/builderA11y';
import type { FigmaReference } from '../../../../lib/figmaBuilder';

type BuildStudioView = 'code' | 'preview';
type DeviceFrame = 'desktop' | 'tablet' | 'mobile';
const SANDBOXED_PREVIEW_PERMISSIONS = 'allow-scripts';

const DEVICE_PRESETS: Record<DeviceFrame, { label: string; width: number; symbol: string }> = {
  desktop: { label: 'Desktop', width: 1280, symbol: '▭' },
  tablet:  { label: 'Tablet',  width: 834,  symbol: '▯' },
  mobile:  { label: 'Mobile',  width: 390,  symbol: '▮' },
};

const DEVICE_STORAGE_KEY = 'uc_builder_device_frame_v1';

type ChatBuildStudioProps = {
  accentColor: string;
  selectedModel: string;
  currentRunStep?: string;
  prompt?: string | null;
  tick?: number;
  artifact?: SwanBotStructuredArtifact | null;
  view: BuildStudioView;
  onViewChange: (view: BuildStudioView) => void;
  circleId?: string;
  // Live stream from build-stream edge fn. When present, renders in place of
  // the placeholder "booting context…" lines so the user sees real tokens.
  streamingText?: string;
  streamingPhase?: string | null;
  // Revision history (newest-first). The strip is hidden when empty.
  revisions?: BuilderRevision[];
  // The content currently on screen — used to mark the "current" dot.
  activeArtifactContent?: string | null;
  onRevertRevision?: (rev: BuilderRevision) => void;
  onDeleteRevision?: (revisionId: string) => void;
  onOpenBrandPack?: () => void;
  brandPackActive?: boolean;
  figmaReferences?: FigmaReference[];
  selectedFigmaRefId?: string | null;
  onSelectFigmaRef?: (id: string) => void;
  // When set, CODE tab becomes editable; on save the new content is passed
  // back up. Parent owns persistence (revisions, preview refresh).
  onArtifactEdit?: (nextContent: string) => void;
  // Regenerate-with-tweaks: fires the /build-page stream again with the
  // original prompt plus an appended tweak instruction.
  onRegenerateTweak?: (tweak: string) => void;
  // Point-and-click editing: user selects an element in the preview iframe,
  // types what to change, and we ask the model to modify only that element.
  onPointEdit?: (args: { selector: string; outerHtml: string; tweak: string }) => void;
  // Template picker: fires /build-page with a pre-canned brief.
  onPickTemplate?: (brief: string, label?: string) => void;
  // Image library modal opener + count badge
  onOpenImages?: () => void;
  imagesCount?: number;
  // Save-to-GitHub opener — button visible only when provided
  onOpenGithubSave?: () => void;
  // Deploy-to-Netlify opener — button visible only when provided
  onOpenNetlifyDeploy?: () => void;
};

interface IframeError {
  message: string;
  source?: string;
  line?: number;
  stack?: string;
}

function inferFileName(artifact: SwanBotStructuredArtifact): string {
  const explicit = typeof artifact.metadata?.fileName === 'string' ? artifact.metadata.fileName.trim() : '';
  if (explicit) return explicit;
  if (artifact.kind === 'webpage') return 'index.html';
  const language = String(artifact.metadata?.language || '').toLowerCase();
  if (language.includes('tsx') || language.includes('react')) return 'OpenSwanPanel.tsx';
  if (language.includes('typescript') || language === 'ts') return 'agent-runtime.ts';
  if (language.includes('javascript') || language === 'js') return 'agent-runtime.js';
  if (language.includes('css')) return 'styles.css';
  if (language.includes('json')) return 'config.json';
  return `${(artifact.title || 'generated-file').replace(/\s+/g, '-').toLowerCase() || 'generated-file'}.txt`;
}

// Inject a tiny runtime into the rendered HTML so the parent window sees
// runtime errors and console output via postMessage. Idempotent.
function injectStudioRuntime(html: string): string {
  if (!html) return html;
  if (html.includes('data-uc-studio-runtime')) return html;
  const runtime = `<script data-uc-studio-runtime="1">
(function(){
  function post(type, payload){ try { window.parent.postMessage(Object.assign({type:type, ucStudio:true}, payload), '*'); } catch(e){} }
  window.addEventListener('error', function(e){
    post('uc-builder-error', { message: e.message, source: e.filename, line: e.lineno, stack: e.error && e.error.stack });
  });
  window.addEventListener('unhandledrejection', function(e){
    var r = e.reason;
    post('uc-builder-error', { message: r && r.message ? r.message : String(r), stack: r && r.stack });
  });
  ['log','info','warn','error'].forEach(function(k){
    var orig = console[k].bind(console);
    console[k] = function(){
      orig.apply(null, arguments);
      try {
        var args = Array.prototype.slice.call(arguments).map(function(a){
          if (a && typeof a === 'object') { try { return JSON.stringify(a).slice(0,600); } catch(_){ return String(a).slice(0,600); } }
          return String(a).slice(0,600);
        });
        post('uc-builder-console', { level: k, args: args });
      } catch(_){}
    };
  });

  // ── Point-and-click editing ─────────────────────────────────────────────
  // When the parent enables POINT mode, we outline any element on hover and
  // intercept the next click to capture the element's HTML + a CSS selector.
  // The parent opens a drawer for the user to describe what should change.
  var pointMode = false;
  var styleEl = null;
  var hoverEl = null;
  function ensureStyle(){
    if (styleEl) return;
    styleEl = document.createElement('style');
    styleEl.setAttribute('data-uc-point-style','1');
    styleEl.textContent = '[data-uc-point-outline]{outline:2px dashed #22d3ee !important;outline-offset:2px;cursor:crosshair !important;}';
    document.documentElement.appendChild(styleEl);
  }
  function cssPath(el){
    if (!el || el.nodeType !== 1) return '';
    if (el === document.body) return 'body';
    var parts = [];
    var node = el;
    while (node && node.nodeType === 1 && parts.length < 6) {
      var seg = node.tagName.toLowerCase();
      if (node.id) { seg += '#' + node.id; parts.unshift(seg); break; }
      var parent = node.parentElement;
      if (parent) {
        var same = Array.prototype.filter.call(parent.children, function(c){ return c.tagName === node.tagName; });
        if (same.length > 1) seg += ':nth-of-type(' + (Array.prototype.indexOf.call(same, node) + 1) + ')';
      }
      parts.unshift(seg);
      node = parent;
    }
    return parts.join(' > ');
  }
  function onHover(e){
    if (!pointMode) return;
    if (hoverEl && hoverEl !== e.target) hoverEl.removeAttribute('data-uc-point-outline');
    hoverEl = e.target;
    if (hoverEl && hoverEl.setAttribute) hoverEl.setAttribute('data-uc-point-outline','1');
  }
  function onClick(e){
    if (!pointMode) return;
    e.preventDefault(); e.stopPropagation();
    var el = e.target;
    if (!el || !el.outerHTML) return;
    post('uc-builder-point-click', {
      selector: cssPath(el),
      outerHtml: String(el.outerHTML).slice(0, 4000),
      tag: el.tagName ? String(el.tagName).toLowerCase() : '',
    });
  }
  window.addEventListener('mouseover', onHover, true);
  window.addEventListener('click', onClick, true);

  window.addEventListener('message', function(ev){
    var d = ev && ev.data;
    if (!d || d.ucStudio !== true) return;
    if (d.type === 'uc-builder-point-mode') {
      pointMode = !!d.enabled;
      if (pointMode) ensureStyle();
      else if (hoverEl) { hoverEl.removeAttribute('data-uc-point-outline'); hoverEl = null; }
    }
  });
})();
</script>`;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, '<head$1>' + runtime);
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html([^>]*)>/i, '<html$1><head>' + runtime + '</head>');
  }
  return `<!DOCTYPE html><html><head>${runtime}</head><body>${html}</body></html>`;
}

function consoleLevelStyle(level: string) {
  const l = level.toLowerCase();
  if (l === 'error') return { color: '#ef4444', borderColor: '#ef4444' };
  if (l === 'warn')  return { color: '#f59e0b', borderColor: '#f59e0b' };
  if (l === 'info')  return { color: '#22d3ee', borderColor: '#22d3ee' };
  return { color: '#94a3b8', borderColor: '#334155' };
}

function renderCodeLines(content: string) {
  // Cap at 12,000 chars for perf — single-file HTML that large is already
  // past the "readable preview" threshold, and we want to avoid blowing
  // out the React tree with hundreds of thousands of span nodes.
  const tokenizer = new StreamTokenizer();
  return content.slice(0, 12000).split('\n').map((line, index) => {
    const tokens = tokenizer.tokenizeLine(line || '');
    return (
      <View key={`${index}-${line.slice(0, 40)}`} style={styles.codeRow}>
        <Text style={styles.codeLineNo}>{String(index + 1).padStart(2, '0')}</Text>
        <Text style={styles.codeLine}>
          {tokens.length === 0 ? ' ' : tokens.map((t, j) => (
            <Text key={j} style={{ color: TOKEN_COLORS[t.kind] }}>{t.text}</Text>
          ))}
        </Text>
      </View>
    );
  });
}

export default function ChatBuildStudioV2({
  accentColor,
  selectedModel,
  currentRunStep,
  prompt,
  tick = 0,
  artifact,
  view,
  onViewChange,
  circleId,
  streamingText,
  streamingPhase,
  revisions,
  activeArtifactContent,
  onRevertRevision,
  onDeleteRevision,
  onOpenBrandPack,
  brandPackActive,
  figmaReferences,
  selectedFigmaRefId,
  onSelectFigmaRef,
  onArtifactEdit,
  onRegenerateTweak,
  onPointEdit,
  onPickTemplate,
  onOpenImages,
  imagesCount,
  onOpenGithubSave,
  onOpenNetlifyDeploy,
}: ChatBuildStudioProps) {
  const isStreaming = !!streamingText && streamingText.length > 0;
  const availableFigmaRefs = figmaReferences || [];
  const selectedFigmaRef = useMemo(
    () => availableFigmaRefs.find((ref) => ref.id === selectedFigmaRefId) || availableFigmaRefs[0] || null,
    [availableFigmaRefs, selectedFigmaRefId],
  );
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [templateCategory, setTemplateCategory] = useState<BuilderTemplate['category']>('landing');
  // Share-a-preview-link
  const [shareOpen, setShareOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareExpires, setShareExpires] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  // Console drawer — surfaces the iframe's console.log/warn/error messages
  // that the injected runtime already forwards via postMessage
  const [consoleEntries, setConsoleEntries] = useState<Array<{ level: string; args: string[]; ts: number }>>([]);
  const [consoleOpen, setConsoleOpen] = useState(false);
  // A11y audit — runs fresh on every artifact change
  const a11yIssues = useMemo<A11yIssue[]>(() => {
    if (!artifact?.content || artifact.kind !== 'webpage') return [];
    return runA11yAudit(artifact.content);
  }, [artifact?.content, artifact?.kind]);
  const a11yCounts = useMemo(() => countByLevel(a11yIssues), [a11yIssues]);
  const [a11yOpen, setA11yOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const revisionCount = revisions?.length ?? 0;
  // Point-to-edit state — only meaningful in the preview tab
  const [pointMode, setPointMode] = useState(false);
  const [pointedElement, setPointedElement] = useState<{ selector: string; outerHtml: string } | null>(null);
  const [pointTweak, setPointTweak] = useState('');
  // Edit mode for the CODE tab. Buffer tracks the draft so cancel can reset
  // cleanly; we reseed the buffer whenever the underlying artifact changes.
  const [codeEditing, setCodeEditing] = useState(false);
  const [codeBuffer, setCodeBuffer] = useState<string>('');
  useEffect(() => {
    setCodeEditing(false);
    setCodeBuffer(artifact?.content || '');
  }, [artifact?.content]);
  const canPreview = Platform.OS === 'web' && artifact?.kind === 'webpage' && !!artifact.content;
  const fileName = prompt ? inferCodingWorkbenchFileName(prompt) : 'generated-file.tsx';
  const liveLines = buildCodingWorkbenchLines(prompt || '', tick);
  const livePhase = getCodingWorkbenchPhase(tick);
  const liveMetrics = getCodingWorkbenchMetrics(tick);

  const [device, setDevice] = useState<DeviceFrame>(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || !window.localStorage) return 'desktop';
    const stored = window.localStorage.getItem(DEVICE_STORAGE_KEY);
    return (stored === 'tablet' || stored === 'mobile') ? stored : 'desktop';
  });
  const [toast, setToast] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [wpFeedback, setWpFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [iframeError, setIframeError] = useState<IframeError | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const persistDevice = useCallback((d: DeviceFrame) => {
    setDevice(d);
    try { if (typeof window !== 'undefined') window.localStorage?.setItem(DEVICE_STORAGE_KEY, d); } catch {}
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2400);
  }, []);

  useEffect(() => {
    setIframeError(null);
    setConsoleEntries([]);
  }, [artifact?.content]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const listener = (event: MessageEvent) => {
      const data = event.data as any;
      if (!data || data.ucStudio !== true) return;
      if (data.type === 'uc-builder-error') {
        setIframeError({
          message: String(data.message || 'Unknown error'),
          source: data.source,
          line: data.line,
          stack: data.stack,
        });
      } else if (data.type === 'uc-builder-point-click') {
        setPointedElement({
          selector: String(data.selector || ''),
          outerHtml: String(data.outerHtml || ''),
        });
        setPointTweak('');
        // Exit point mode once we've captured a target so hover outlines
        // stop interfering with the user typing the tweak.
        setPointMode(false);
      } else if (data.type === 'uc-builder-console') {
        // Cap at 50 most-recent entries so long-running iframes can't
        // balloon parent memory from console spam.
        setConsoleEntries(prev => [
          ...prev.slice(-49),
          { level: String(data.level || 'log'), args: Array.isArray(data.args) ? data.args.map(String) : [], ts: Date.now() },
        ]);
      }
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, []);

  // Broadcast point-mode changes into the iframe runtime. Safe to call even
  // before the iframe has loaded — the listener inside the iframe will
  // receive postMessages regardless of page lifecycle state.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const frame = iframeRef.current;
    if (!frame?.contentWindow) return;
    frame.contentWindow.postMessage({ ucStudio: true, type: 'uc-builder-point-mode', enabled: pointMode }, '*');
  }, [pointMode]);

  const injectedPreview = useMemo(() => {
    if (!canPreview) return '';
    return injectStudioRuntime(artifact!.content || '');
  }, [artifact?.content, canPreview]);

  const handleCopy = useCallback(async () => {
    if (!artifact?.content) return;
    try {
      if (Platform.OS === 'web' && navigator?.clipboard) {
        await navigator.clipboard.writeText(artifact.content);
        showToast('Copied to clipboard');
      } else {
        showToast('Clipboard unavailable');
      }
    } catch {
      showToast('Copy failed');
    }
  }, [artifact?.content, showToast]);

  const handleDownload = useCallback(() => {
    if (!artifact?.content) return;
    if (Platform.OS !== 'web' || typeof document === 'undefined') {
      showToast('Download is web-only');
      return;
    }
    try {
      const file = inferFileName(artifact);
      const blob = new Blob([artifact.content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast(`Downloaded ${file}`);
    } catch {
      showToast('Download failed');
    }
  }, [artifact, showToast]);

  const handlePublishShare = useCallback(async () => {
    if (!artifact?.content) { showToast('Nothing to share yet'); return; }
    if (sharing) return;
    setSharing(true);
    setShareError(null);
    setShareUrl(null);
    setShareOpen(true);
    try {
      const result = await publishPreview({
        html: artifact.content,
        title: artifact.title || undefined,
        circleId: circleId ?? null,
      });
      setShareUrl(result.url);
      setShareExpires(result.expiresAt);
    } catch (err: any) {
      setShareError(err?.message || 'Publish failed');
    } finally {
      setSharing(false);
    }
  }, [artifact, circleId, sharing, showToast]);

  const handleCopyShareUrl = useCallback(async () => {
    if (!shareUrl) return;
    try {
      if (Platform.OS === 'web' && navigator?.clipboard) {
        await navigator.clipboard.writeText(shareUrl);
        showToast('Share URL copied');
      }
    } catch {}
  }, [shareUrl, showToast]);

  const handlePublishWp = useCallback(async () => {
    if (!artifact?.content) { setWpFeedback({ kind: 'err', text: 'Nothing to publish — build something first.' }); return; }
    if (publishing) return;
    setPublishing(true);
    setWpFeedback(null);
    try {
      await scheduleAction({
        kind: 'wp_post',
        circleId: circleId ?? null,
        payload: {
          title: artifact.title || 'Draft from OpenSwan',
          content: artifact.content,
          status: 'draft',
          source: 'chat_live_builder',
        },
      });
      setWpFeedback({ kind: 'ok', text: 'Queued — see the Outbox to watch it run.' });
      showToast('Queued · see Outbox');
    } catch (err: any) {
      const msg = err?.message || 'Publish failed';
      setWpFeedback({ kind: 'err', text: msg });
      showToast(msg);
    } finally {
      setPublishing(false);
    }
  }, [artifact, circleId, publishing, showToast]);

  // Native Fullscreen API — request on the iframe element so the page
  // itself fills the viewport, not the surrounding UC chrome. ESC exits
  // as usual. Silently no-op on native or when the browser refuses.
  const handleFullscreen = useCallback(() => {
    if (Platform.OS !== 'web') return;
    const frame: any = iframeRef.current;
    if (!frame) return;
    try {
      const req = frame.requestFullscreen || frame.webkitRequestFullscreen || frame.msRequestFullscreen;
      if (typeof req === 'function') {
        req.call(frame);
      } else {
        showToast('Fullscreen unavailable in this browser');
      }
    } catch {
      showToast('Fullscreen blocked');
    }
  }, [showToast]);

  const handleCopyError = useCallback(async () => {
    if (!iframeError) return;
    const text = `${iframeError.message}${iframeError.source ? `\nat ${iframeError.source}:${iframeError.line}` : ''}${iframeError.stack ? `\n${iframeError.stack}` : ''}`;
    try {
      if (Platform.OS === 'web' && navigator?.clipboard) {
        await navigator.clipboard.writeText(text);
        showToast('Error copied — paste into chat to ask the agent to fix');
      }
    } catch {}
  }, [iframeError, showToast]);

  const deviceWidth = DEVICE_PRESETS[device].width;
  const canUseToolbar = !!artifact?.content;

  return (
    <View style={styles.shell}>
      <View style={styles.header}>
        <View style={styles.tabs}>
          <Pressable
            onPress={() => onViewChange('code')}
            style={[styles.tab, view === 'code' && { borderColor: `${accentColor}55`, backgroundColor: `${accentColor}18` }]}
          >
            <Text style={[styles.tabText, view === 'code' && { color: accentColor }]}>CODE</Text>
          </Pressable>
          <Pressable
            onPress={() => canPreview && onViewChange('preview')}
            style={[
              styles.tab,
              view === 'preview' && canPreview && { borderColor: `${accentColor}55`, backgroundColor: `${accentColor}18` },
              !canPreview && styles.tabDisabled,
            ]}
          >
            <Text style={[styles.tabText, view === 'preview' && canPreview && { color: accentColor }, !canPreview && styles.tabTextDisabled]}>
              PREVIEW
            </Text>
          </Pressable>
        </View>

        {canUseToolbar && (
          <View style={styles.toolbar}>
            <Pressable onPress={handleCopy} style={styles.toolbarBtn}>
              <Text style={styles.toolbarBtnText}>⎘ COPY</Text>
            </Pressable>
            <Pressable onPress={handleDownload} style={styles.toolbarBtn}>
              <Text style={styles.toolbarBtnText}>⇣ FILE</Text>
            </Pressable>
            <Pressable
              onPress={handlePublishShare}
              disabled={sharing}
              style={[styles.toolbarBtnPrimary, { borderColor: `${accentColor}88`, backgroundColor: `${accentColor}18` }, sharing && { opacity: 0.5 }]}
            >
              <Text style={[styles.toolbarBtnPrimaryText, { color: accentColor }]}>
                {sharing ? 'PUBLISHING…' : '🔗 SHARE'}
              </Text>
            </Pressable>
            <Pressable
              onPress={handlePublishWp}
              disabled={publishing}
              style={[styles.toolbarBtn, publishing && { opacity: 0.5 }]}
            >
              <Text style={styles.toolbarBtnText}>
                {publishing ? 'QUEUEING…' : '⇪ WP'}
              </Text>
            </Pressable>
            {onOpenGithubSave && (
              <Pressable onPress={onOpenGithubSave} style={styles.toolbarBtn}>
                <Text style={styles.toolbarBtnText}>⎘ GITHUB</Text>
              </Pressable>
            )}
            {onOpenNetlifyDeploy && (
              <Pressable
                onPress={onOpenNetlifyDeploy}
                style={[styles.toolbarBtnPrimary, { borderColor: '#22c55e88', backgroundColor: '#22c55e18' }]}
              >
                <Text style={[styles.toolbarBtnPrimaryText, { color: '#22c55e' }]}>▲ DEPLOY</Text>
              </Pressable>
            )}
            {revisionCount > 0 && (
              <Pressable
                onPress={() => setHistoryOpen(v => !v)}
                style={[styles.toolbarBtn, historyOpen && { borderColor: `${accentColor}88`, backgroundColor: `${accentColor}18` }]}
              >
                <Text style={[styles.toolbarBtnText, historyOpen && { color: accentColor }]}>
                  ⟲ HISTORY · {revisionCount}
                </Text>
              </Pressable>
            )}
            {onOpenBrandPack && (
              <Pressable
                onPress={onOpenBrandPack}
                style={[styles.toolbarBtn, brandPackActive && { borderColor: `${accentColor}88`, backgroundColor: `${accentColor}18` }]}
              >
                <Text style={[styles.toolbarBtnText, brandPackActive && { color: accentColor }]}>
                  ✦ BRAND{brandPackActive ? ' ON' : ''}
                </Text>
              </Pressable>
            )}
            {onPickTemplate && (
              <Pressable onPress={() => setTemplatesOpen(true)} style={styles.toolbarBtn}>
                <Text style={styles.toolbarBtnText}>⎘ TEMPLATES</Text>
              </Pressable>
            )}
            {onOpenImages && (
              <Pressable
                onPress={onOpenImages}
                style={[styles.toolbarBtn, (imagesCount || 0) > 0 && { borderColor: `${accentColor}88`, backgroundColor: `${accentColor}18` }]}
              >
                <Text style={[styles.toolbarBtnText, (imagesCount || 0) > 0 && { color: accentColor }]}>
                  🖼 IMAGES{(imagesCount || 0) > 0 ? ` · ${imagesCount}` : ''}
                </Text>
              </Pressable>
            )}
          </View>
        )}
        {wpFeedback && (
          <View style={[
            styles.feedbackBar,
            wpFeedback.kind === 'ok'
              ? { borderColor: '#22c55e', backgroundColor: '#052e14' }
              : { borderColor: '#ef4444', backgroundColor: '#2a0a0a' },
          ]}>
            <Text style={[
              styles.feedbackText,
              { color: wpFeedback.kind === 'ok' ? '#bbf7d0' : '#fecaca' },
            ]}>
              {wpFeedback.kind === 'ok' ? 'WP · ' : 'WP ERROR · '}{wpFeedback.text}
            </Text>
            <Pressable onPress={() => setWpFeedback(null)} style={styles.feedbackClose} hitSlop={6}>
              <Text style={styles.feedbackCloseText}>×</Text>
            </Pressable>
          </View>
        )}
        {!canUseToolbar && (onOpenBrandPack || onPickTemplate || onOpenImages) && (
          <View style={styles.toolbar}>
            {onOpenBrandPack && (
              <Pressable
                onPress={onOpenBrandPack}
                style={[styles.toolbarBtn, brandPackActive && { borderColor: `${accentColor}88`, backgroundColor: `${accentColor}18` }]}
              >
                <Text style={[styles.toolbarBtnText, brandPackActive && { color: accentColor }]}>
                  ✦ BRAND{brandPackActive ? ' ON' : ''}
                </Text>
              </Pressable>
            )}
            {onPickTemplate && (
              <Pressable onPress={() => setTemplatesOpen(true)} style={styles.toolbarBtn}>
                <Text style={styles.toolbarBtnText}>⎘ TEMPLATES</Text>
              </Pressable>
            )}
            {onOpenImages && (
              <Pressable
                onPress={onOpenImages}
                style={[styles.toolbarBtn, (imagesCount || 0) > 0 && { borderColor: `${accentColor}88`, backgroundColor: `${accentColor}18` }]}
              >
                <Text style={[styles.toolbarBtnText, (imagesCount || 0) > 0 && { color: accentColor }]}>
                  🖼 IMAGES{(imagesCount || 0) > 0 ? ` · ${imagesCount}` : ''}
                </Text>
              </Pressable>
            )}
          </View>
        )}
      </View>

      {availableFigmaRefs.length > 0 && (
        <View style={styles.figmaPanel}>
          <View style={styles.figmaPanelHeader}>
            <View style={styles.figmaPanelTitleWrap}>
              <Text style={[styles.figmaPanelEyebrow, { color: accentColor }]}>FIGMA SOURCE DETECTED</Text>
              <Text style={styles.figmaPanelTitle}>
                {selectedFigmaRef ? selectedFigmaRef.title : 'Select a design source'}
              </Text>
            </View>
            <Text style={styles.figmaPanelMeta}>
              {availableFigmaRefs.length} source{availableFigmaRefs.length === 1 ? '' : 's'}
            </Text>
          </View>
          {selectedFigmaRef?.summary ? (
            <Text style={styles.figmaPanelSummary} numberOfLines={2}>
              {selectedFigmaRef.summary}
            </Text>
          ) : null}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.figmaRefRow}>
            {availableFigmaRefs.map((ref) => {
              const active = ref.id === (selectedFigmaRef?.id || selectedFigmaRefId);
              return (
                <Pressable
                  key={ref.id}
                  onPress={() => onSelectFigmaRef?.(ref.id)}
                  style={[
                    styles.figmaRefChip,
                    active && { borderColor: `${accentColor}88`, backgroundColor: `${accentColor}18` },
                  ]}
                >
                  <Text style={[styles.figmaRefSource, active && { color: accentColor }]}>
                    {ref.source.toUpperCase()}
                  </Text>
                  <Text style={styles.figmaRefTitle} numberOfLines={1}>{ref.title}</Text>
                  {ref.nodeId ? (
                    <Text style={styles.figmaRefMeta} numberOfLines={1}>NODE · {ref.nodeId}</Text>
                  ) : ref.fileKey ? (
                    <Text style={styles.figmaRefMeta} numberOfLines={1}>FILE · {ref.fileKey}</Text>
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      )}

      {historyOpen && revisionCount > 0 && (
        <View style={styles.historyStrip}>
          <Text style={styles.historyStripLabel}>REVISIONS · newest first · tap to revert</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.historyStripRow}>
            {revisions!.map((rev) => {
              const isActive = !!activeArtifactContent && (rev.artifact.content || '').trim() === activeArtifactContent.trim();
              const preview = (rev.brief || rev.artifact.title || 'build').slice(0, 36);
              return (
                <View
                  key={rev.id}
                  style={[
                    styles.historyChip,
                    isActive && { borderColor: `${accentColor}aa`, backgroundColor: `${accentColor}18` },
                  ]}
                >
                  <Pressable onPress={() => onRevertRevision?.(rev)} style={{ flex: 1 }}>
                    <Text style={[styles.historyChipAge, isActive && { color: accentColor }]}>{describeRevisionAge(rev.createdAt)}</Text>
                    <Text style={styles.historyChipTitle} numberOfLines={1}>{preview}</Text>
                  </Pressable>
                  {!isActive && onDeleteRevision && (
                    <Pressable onPress={() => onDeleteRevision(rev.id)} hitSlop={6} style={styles.historyDeleteBtn}>
                      <Text style={styles.historyDeleteBtnText}>×</Text>
                    </Pressable>
                  )}
                </View>
              );
            })}
          </ScrollView>
        </View>
      )}

      {view === 'preview' && canPreview ? (
        <View style={styles.previewShell}>
          <View style={styles.previewHeader}>
            <Text style={styles.previewFile}>{inferFileName(artifact!)}</Text>
            {onPointEdit && (
              <Pressable
                onPress={() => setPointMode(v => !v)}
                style={[styles.deviceBtn, pointMode && { borderColor: `${accentColor}88`, backgroundColor: `${accentColor}1a` }]}
              >
                <Text style={[styles.deviceBtnText, pointMode && { color: accentColor }]}>
                  ◎ POINT{pointMode ? ' ON' : ''}
                </Text>
              </Pressable>
            )}
            <View style={styles.deviceSwitcher}>
              {(['desktop', 'tablet', 'mobile'] as DeviceFrame[]).map(d => {
                const active = device === d;
                return (
                  <Pressable
                    key={d}
                    onPress={() => persistDevice(d)}
                    style={[styles.deviceBtn, active && { borderColor: `${accentColor}88`, backgroundColor: `${accentColor}1a` }]}
                  >
                    <Text style={[styles.deviceBtnText, active && { color: accentColor }]}>
                      {DEVICE_PRESETS[d].symbol} {DEVICE_PRESETS[d].width}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable onPress={handleFullscreen} style={styles.deviceBtn}>
              <Text style={styles.deviceBtnText}>⤢ FULL</Text>
            </Pressable>
            <Pressable
              onPress={() => setConsoleOpen(v => !v)}
              style={[styles.deviceBtn, consoleOpen && { borderColor: `${accentColor}88`, backgroundColor: `${accentColor}1a` }]}
            >
              <Text style={[styles.deviceBtnText, consoleOpen && { color: accentColor }]}>
                ⌁ CONSOLE{consoleEntries.length > 0 ? ` · ${consoleEntries.length}` : ''}
              </Text>
            </Pressable>
            {a11yIssues.length > 0 && (
              <Pressable
                onPress={() => setA11yOpen(v => !v)}
                style={[
                  styles.deviceBtn,
                  { borderColor: a11yCounts.errors > 0 ? '#ef444488' : '#f59e0b88' },
                  a11yOpen && { backgroundColor: a11yCounts.errors > 0 ? '#ef44441a' : '#f59e0b1a' },
                ]}
              >
                <Text style={[styles.deviceBtnText, { color: a11yCounts.errors > 0 ? '#ef4444' : '#f59e0b' }]}>
                  ✓ A11Y · {a11yCounts.errors > 0 ? `${a11yCounts.errors}E` : ''}{a11yCounts.warns > 0 ? ` ${a11yCounts.warns}W` : ''}
                </Text>
              </Pressable>
            )}
            <Text style={[styles.previewModel, { color: accentColor }]}>
              {selectedModel === 'auto' ? 'AUTO ROUTE' : selectedModel.toUpperCase()}
            </Text>
          </View>

          <View style={styles.previewStage}>
            <View style={[styles.deviceFrame, { width: deviceWidth, maxWidth: '100%' }]}>
              <iframe
                ref={r => { iframeRef.current = r as HTMLIFrameElement | null; }}
                srcDoc={injectedPreview}
                style={{ width: '100%', height: '100%', border: 'none', backgroundColor: '#ffffff' } as any}
                sandbox={SANDBOXED_PREVIEW_PERMISSIONS}
                title={artifact!.title || 'OpenSwan Preview'}
              />
              {iframeError && (
                <View style={styles.errorOverlay}>
                  <View style={styles.errorCard}>
                    <Text style={styles.errorBadge}>RUNTIME ERROR</Text>
                    <Text style={styles.errorMessage} numberOfLines={3}>{iframeError.message}</Text>
                    {iframeError.source && (
                      <Text style={styles.errorLocation} numberOfLines={1}>
                        at {iframeError.source}{iframeError.line ? `:${iframeError.line}` : ''}
                      </Text>
                    )}
                    <View style={styles.errorActions}>
                      <Pressable onPress={handleCopyError} style={styles.errorBtn}>
                        <Text style={styles.errorBtnText}>COPY ERROR</Text>
                      </Pressable>
                      <Pressable onPress={() => setIframeError(null)} style={styles.errorBtnGhost}>
                        <Text style={styles.errorBtnGhostText}>DISMISS</Text>
                      </Pressable>
                    </View>
                  </View>
                </View>
              )}
            </View>
          </View>

          {a11yOpen && a11yIssues.length > 0 && (
            <View style={[styles.consoleDrawer, { borderColor: a11yCounts.errors > 0 ? '#ef4444' : '#f59e0b' }]}>
              <View style={styles.consoleHeader}>
                <Text style={[styles.consoleTitle, { color: a11yCounts.errors > 0 ? '#ef4444' : '#f59e0b' }]}>
                  A11Y · {a11yCounts.errors} ERROR{a11yCounts.errors !== 1 ? 'S' : ''} · {a11yCounts.warns} WARNING{a11yCounts.warns !== 1 ? 'S' : ''}
                </Text>
                <Pressable
                  onPress={() => {
                    const tweak = 'Fix the following accessibility issues: ' + a11yIssues.map(i => `${i.rule}: ${i.message}`).join('; ');
                    onRegenerateTweak?.(tweak);
                    setA11yOpen(false);
                  }}
                  style={[styles.toolbarBtnPrimary, { borderColor: `${accentColor}88`, backgroundColor: `${accentColor}18` }]}
                >
                  <Text style={[styles.toolbarBtnPrimaryText, { color: accentColor }]}>ASK AGENT TO FIX</Text>
                </Pressable>
              </View>
              <ScrollView style={{ maxHeight: 220 }} contentContainerStyle={{ padding: 8, gap: 6 }}>
                {a11yIssues.map((issue, i) => {
                  const levelColor = issue.level === 'error' ? '#ef4444' : '#f59e0b';
                  return (
                    <View key={`${issue.rule}-${i}`} style={styles.consoleRow}>
                      <Text style={[styles.consoleLevel, { color: levelColor, borderColor: levelColor }]}>
                        {issue.level === 'error' ? 'ERR' : 'WARN'}
                      </Text>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.consoleArgs}>{issue.message}</Text>
                        <Text style={{ color: '#64748b', fontSize: 10, fontFamily: 'monospace', marginTop: 2 }} numberOfLines={1}>
                          {issue.snippet}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </ScrollView>
            </View>
          )}

          {consoleOpen && (
            <View style={styles.consoleDrawer}>
              <View style={styles.consoleHeader}>
                <Text style={styles.consoleTitle}>CONSOLE · {consoleEntries.length}</Text>
                <Pressable onPress={() => setConsoleEntries([])} style={styles.toolbarBtn}>
                  <Text style={styles.toolbarBtnText}>CLEAR</Text>
                </Pressable>
              </View>
              <ScrollView style={{ maxHeight: 180 }} contentContainerStyle={{ padding: 8, gap: 4 }}>
                {consoleEntries.length === 0 ? (
                  <Text style={styles.consoleEmpty}>No console output yet.</Text>
                ) : (
                  consoleEntries.map((entry, i) => (
                    <View key={`${entry.ts}-${i}`} style={styles.consoleRow}>
                      <Text style={[styles.consoleLevel, consoleLevelStyle(entry.level)]}>
                        {entry.level.toUpperCase().slice(0, 4)}
                      </Text>
                      <Text style={styles.consoleArgs} numberOfLines={3}>
                        {entry.args.join(' ')}
                      </Text>
                    </View>
                  ))
                )}
              </ScrollView>
            </View>
          )}

          {/* Regenerate-with-tweaks chip row — only when the artifact is
              the result of an actual build (we have a prompt to carry over). */}
          {onRegenerateTweak && prompt && (
            <View style={styles.tweakRow}>
              <Text style={styles.tweakRowLabel}>QUICK TWEAKS</Text>
              <View style={styles.tweakChips}>
                {[
                  { key: 'dark', tweak: 'Use a darker color scheme.' },
                  { key: 'bolder', tweak: 'Make typography bolder and larger.' },
                  { key: 'contact', tweak: 'Add a contact form section near the bottom.' },
                  { key: 'mobile', tweak: 'Optimize the layout for mobile-first with bigger tap targets.' },
                  { key: 'minimal', tweak: 'Simplify — remove decorative elements and use more whitespace.' },
                  { key: 'cta', tweak: 'Make the primary call-to-action more prominent.' },
                ].map(t => (
                  <Pressable
                    key={t.key}
                    onPress={() => onRegenerateTweak(t.tweak)}
                    style={styles.tweakChip}
                  >
                    <Text style={styles.tweakChipText}>{t.tweak.replace(/\.$/, '')}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          {/* Point-and-click tweak drawer — open when the iframe has
              reported a clicked element back to us. */}
          {pointedElement && onPointEdit && (
            <View style={styles.pointDrawer}>
              <View style={styles.pointDrawerHeader}>
                <Text style={styles.pointDrawerTitle}>EDIT ELEMENT · {pointedElement.selector.slice(-48)}</Text>
                <Pressable onPress={() => { setPointedElement(null); setPointTweak(''); }} hitSlop={6}>
                  <Text style={styles.pointDrawerClose}>×</Text>
                </Pressable>
              </View>
              <Text style={styles.pointDrawerPreview} numberOfLines={2}>
                {pointedElement.outerHtml.slice(0, 220)}
              </Text>
              <TextInput
                value={pointTweak}
                onChangeText={setPointTweak}
                placeholder="What should change? e.g. make it cyan and larger"
                placeholderTextColor="#475569"
                style={styles.pointDrawerInput}
                multiline
                autoFocus
                spellCheck={false}
              />
              <View style={styles.pointDrawerActions}>
                <Pressable onPress={() => { setPointedElement(null); setPointTweak(''); }} style={styles.toolbarBtn}>
                  <Text style={styles.toolbarBtnText}>CANCEL</Text>
                </Pressable>
                <Pressable
                  disabled={!pointTweak.trim()}
                  onPress={() => {
                    if (!pointTweak.trim()) return;
                    onPointEdit({
                      selector: pointedElement.selector,
                      outerHtml: pointedElement.outerHtml,
                      tweak: pointTweak.trim(),
                    });
                    setPointedElement(null);
                    setPointTweak('');
                  }}
                  style={[styles.toolbarBtnPrimary, { borderColor: `${accentColor}88`, backgroundColor: `${accentColor}18` }, !pointTweak.trim() && { opacity: 0.5 }]}
                >
                  <Text style={[styles.toolbarBtnPrimaryText, { color: accentColor }]}>APPLY ⏎</Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      ) : artifact?.content ? (
        <View style={styles.codeShell}>
          <View style={styles.codeHeader}>
            <Text style={styles.codeFile}>{inferFileName(artifact)}</Text>
            {onArtifactEdit && (
              codeEditing ? (
                <View style={{ flexDirection: 'row', gap: 4 }}>
                  <Pressable
                    onPress={() => { setCodeEditing(false); setCodeBuffer(artifact.content || ''); }}
                    style={styles.toolbarBtn}
                  >
                    <Text style={styles.toolbarBtnText}>CANCEL</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      onArtifactEdit(codeBuffer);
                      setCodeEditing(false);
                    }}
                    style={[styles.toolbarBtnPrimary, { borderColor: `${accentColor}88`, backgroundColor: `${accentColor}18` }]}
                  >
                    <Text style={[styles.toolbarBtnPrimaryText, { color: accentColor }]}>SAVE ⌘S</Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable onPress={() => setCodeEditing(true)} style={styles.toolbarBtn}>
                  <Text style={styles.toolbarBtnText}>✎ EDIT</Text>
                </Pressable>
              )
            )}
            <Text style={[styles.codeModel, { color: accentColor }]}>
              {selectedModel === 'auto' ? 'AUTO ROUTE' : selectedModel.toUpperCase()}
            </Text>
          </View>
          {codeEditing && onArtifactEdit ? (
            <TextInput
              value={codeBuffer}
              onChangeText={setCodeBuffer}
              multiline
              autoFocus
              autoCorrect={false}
              autoCapitalize="none"
              style={{
                flex: 1,
                minHeight: 0,
                color: '#d8e1ef',
                fontFamily: 'monospace',
                fontSize: 12,
                lineHeight: 18,
                backgroundColor: '#05070b',
                paddingHorizontal: 14,
                paddingVertical: 12,
                textAlignVertical: 'top',
                ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}),
              }}
              spellCheck={false}
            />
          ) : (
            <ScrollView style={styles.codeScroll} contentContainerStyle={styles.codeScrollContent}>
              {renderCodeLines(artifact.content)}
            </ScrollView>
          )}
        </View>
      ) : isStreaming ? (
        <View style={styles.liveShell}>
          <View style={styles.liveHeader}>
            <Text style={styles.liveFile}>{fileName}</Text>
            <Text style={[styles.liveModel, { color: accentColor }]}>
              {selectedModel === 'auto' ? 'AUTO ROUTE' : selectedModel.toUpperCase()}
            </Text>
          </View>
          <View style={styles.livePhaseRow}>
            <Text style={[styles.livePhaseBadge, { color: accentColor, borderColor: `${accentColor}40` }]}>
              {(streamingPhase || 'streaming').toUpperCase()}
            </Text>
            <Text style={styles.liveMetric}>{streamingText!.length.toLocaleString()} CHARS</Text>
            <Text style={styles.liveMetric}>{streamingText!.split('\n').length} LINES</Text>
          </View>
          <ScrollView
            style={styles.liveBody}
            contentContainerStyle={styles.liveBodyContent}
            ref={(ref: any) => {
              // Keep the newest tokens in view — ScrollView on web auto-scrolls to
              // the bottom when content grows because we're not using FlatList.
              if (ref && Platform.OS === 'web') {
                try { (ref as any).scrollToEnd?.({ animated: false }); } catch {}
              }
            }}
          >
            {streamingText!.split('\n').slice(-400).map((line, index, arr) => (
              <View key={`${index}-${line.slice(0, 40)}`} style={styles.codeRow}>
                <Text style={styles.codeLineNo}>{String(index + 1).padStart(2, '0')}</Text>
                <Text style={styles.codeLine}>{line || ' '}</Text>
              </View>
            ))}
            <View style={styles.codeRow}>
              <Text style={styles.codeLineNo}>
                {String(Math.min(streamingText!.split('\n').length, 400) + 1).padStart(2, '0')}
              </Text>
              <View style={[styles.cursor, { backgroundColor: accentColor }]} />
            </View>
          </ScrollView>
          <View style={styles.liveFooter}>
            <Text style={styles.liveFooterText}>{currentRunStep || 'Streaming from Anthropic…'}</Text>
            <Text style={[styles.liveFooterText, { color: accentColor }]}>BUILD STREAM · LIVE</Text>
          </View>
        </View>
      ) : (
        <View style={styles.liveShell}>
          <View style={styles.liveHeader}>
            <Text style={styles.liveFile}>{fileName}</Text>
            <Text style={[styles.liveModel, { color: accentColor }]}>
              {selectedModel === 'auto' ? 'AUTO ROUTE' : selectedModel.toUpperCase()}
            </Text>
          </View>
          <View style={styles.livePhaseRow}>
            <Text style={[styles.livePhaseBadge, { color: accentColor, borderColor: `${accentColor}40` }]}>{livePhase}</Text>
            <Text style={styles.liveMetric}>+{liveMetrics.xp} BUILD XP</Text>
            <Text style={styles.liveMetric}>{liveMetrics.files} FILES</Text>
            <Text style={styles.liveMetric}>{liveMetrics.passes} PASSES</Text>
          </View>
          <ScrollView style={styles.liveBody} contentContainerStyle={styles.liveBodyContent}>
            {liveLines.map((line, index) => (
              <View key={`${index}-${line}`} style={styles.codeRow}>
                <Text style={styles.codeLineNo}>{String(index + 1).padStart(2, '0')}</Text>
                <Text style={styles.codeLine}>{line || ' '}</Text>
              </View>
            ))}
            <View style={styles.codeRow}>
              <Text style={styles.codeLineNo}>{String(liveLines.length + 1).padStart(2, '0')}</Text>
              <View style={[styles.cursor, { backgroundColor: accentColor }]} />
            </View>
          </ScrollView>
          <View style={styles.liveFooter}>
            <Text style={styles.liveFooterText}>{currentRunStep || 'OpenSwan is building live...'}</Text>
            <Text style={[styles.liveFooterText, { color: accentColor }]}>BUILD STREAM</Text>
          </View>
        </View>
      )}

      {toast && (
        <View style={styles.toastRow}>
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      )}

      {shareOpen && (
        <Pressable style={styles.templateScrim} onPress={() => setShareOpen(false)}>
          <Pressable style={[styles.templateCard, { maxWidth: 520 }]} onPress={(e) => e.stopPropagation()}>
            <View style={styles.templateHeader}>
              <Text style={styles.templateTitle}>SHARE A PREVIEW LINK</Text>
              <Pressable onPress={() => setShareOpen(false)} hitSlop={6}>
                <Text style={styles.templateClose}>×</Text>
              </Pressable>
            </View>

            {sharing && (
              <Text style={{ color: '#94a3b8', fontSize: 12, fontFamily: 'monospace' }}>Uploading…</Text>
            )}
            {shareError && (
              <View style={{ padding: 10, borderRadius: 6, borderWidth: 1, borderColor: '#ef4444', backgroundColor: '#2a0a0a' }}>
                <Text style={{ color: '#fecaca', fontSize: 12, fontFamily: 'monospace' }}>{shareError}</Text>
              </View>
            )}
            {shareUrl && (
              <>
                <Text style={{ color: '#7f8ea3', fontSize: 11, fontFamily: 'monospace' }}>
                  Public URL · anyone with this link can view · expires{' '}
                  {shareExpires ? new Date(shareExpires).toLocaleDateString() : 'in 30 days'}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View style={{ flex: 1, paddingHorizontal: 10, paddingVertical: 10, borderRadius: 6, borderWidth: 1, borderColor: '#243246', backgroundColor: '#0a0f17' }}>
                    <Text style={{ color: '#d8e1ef', fontSize: 11, fontFamily: 'monospace' }} selectable numberOfLines={2}>
                      {shareUrl}
                    </Text>
                  </View>
                  <Pressable onPress={handleCopyShareUrl} style={[styles.toolbarBtnPrimary, { borderColor: `${accentColor}88`, backgroundColor: `${accentColor}18` }]}>
                    <Text style={[styles.toolbarBtnPrimaryText, { color: accentColor }]}>COPY</Text>
                  </Pressable>
                  {Platform.OS === 'web' && (
                    <Pressable
                      onPress={() => { try { window.open(shareUrl, '_blank', 'noopener'); } catch {} }}
                      style={styles.toolbarBtn}
                    >
                      <Text style={styles.toolbarBtnText}>OPEN</Text>
                    </Pressable>
                  )}
                </View>
              </>
            )}
          </Pressable>
        </Pressable>
      )}

      {templatesOpen && onPickTemplate && (
        <Pressable style={styles.templateScrim} onPress={() => setTemplatesOpen(false)}>
          <Pressable style={styles.templateCard} onPress={(e) => e.stopPropagation()}>
            <View style={styles.templateHeader}>
              <Text style={styles.templateTitle}>START FROM A TEMPLATE</Text>
              <Pressable onPress={() => setTemplatesOpen(false)} hitSlop={6}>
                <Text style={styles.templateClose}>×</Text>
              </Pressable>
            </View>
            <View style={styles.templateCategories}>
              {BUILDER_TEMPLATE_CATEGORIES.map(cat => {
                const active = templateCategory === cat.key;
                return (
                  <Pressable
                    key={cat.key}
                    onPress={() => setTemplateCategory(cat.key)}
                    style={[styles.templateCatBtn, active && { borderColor: `${accentColor}88`, backgroundColor: `${accentColor}18` }]}
                  >
                    <Text style={[styles.templateCatText, active && { color: accentColor }]}>{cat.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <ScrollView style={{ maxHeight: 380 }} contentContainerStyle={styles.templateGrid}>
              {templatesByCategory(templateCategory).map(tpl => (
                <Pressable
                  key={tpl.id}
                  onPress={() => {
                    onPickTemplate(tpl.brief, tpl.name);
                    setTemplatesOpen(false);
                  }}
                  style={styles.templateItem}
                >
                  <View style={styles.templateItemHead}>
                    {tpl.icon && <Text style={[styles.templateIcon, { color: accentColor }]}>{tpl.icon}</Text>}
                    <Text style={styles.templateName}>{tpl.name}</Text>
                  </View>
                  <Text style={styles.templateDesc} numberOfLines={2}>{tpl.description}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, minHeight: 0, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
  figmaPanel: {
    borderWidth: 1,
    borderColor: '#243246',
    backgroundColor: '#09111a',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  figmaPanelHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  figmaPanelTitleWrap: { flex: 1, gap: 4 },
  figmaPanelEyebrow: { fontSize: 10, fontWeight: '900', letterSpacing: 1, fontFamily: 'monospace' },
  figmaPanelTitle: { color: '#f8fafc', fontSize: 15, fontWeight: '800', letterSpacing: 0.3 },
  figmaPanelMeta: { color: '#94a3b8', fontSize: 10, fontWeight: '800', letterSpacing: 0.8, fontFamily: 'monospace' },
  figmaPanelSummary: { color: '#9fb0c6', fontSize: 12, lineHeight: 18 },
  figmaRefRow: { gap: 10, paddingRight: 8 },
  figmaRefChip: {
    width: 220,
    borderWidth: 1,
    borderColor: '#243246',
    backgroundColor: '#0c1520',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 5,
  },
  figmaRefSource: { color: '#7dd3fc', fontSize: 9, fontWeight: '900', letterSpacing: 0.9, fontFamily: 'monospace' },
  figmaRefTitle: { color: '#e2e8f0', fontSize: 12, fontWeight: '800' },
  figmaRefMeta: { color: '#6b7b90', fontSize: 10, fontFamily: 'monospace' },
  tabs: { flexDirection: 'row', gap: 8 },
  tab: {
    borderWidth: 1, borderColor: '#243246', backgroundColor: '#0a1018',
    borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6,
  },
  tabDisabled: { opacity: 0.45 },
  tabText: { color: '#94a3b8', fontSize: 9, fontWeight: '900', letterSpacing: 0.8, fontFamily: 'monospace' },
  tabTextDisabled: { color: '#475569' },

  toolbar: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  toolbarBtn: {
    borderWidth: 1, borderColor: '#243246', backgroundColor: '#0a1018',
    borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  toolbarBtnText: { color: '#94a3b8', fontSize: 9, fontWeight: '900', letterSpacing: 0.8, fontFamily: 'monospace' },
  toolbarBtnPrimary: {
    borderWidth: 1, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  toolbarBtnPrimaryText: { fontSize: 9, fontWeight: '900', letterSpacing: 0.8, fontFamily: 'monospace' },

  feedbackBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 10, marginTop: 4,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 4, borderWidth: 1,
  },
  feedbackText: { flex: 1, fontSize: 10, fontFamily: 'monospace', letterSpacing: 0.4 },
  feedbackClose: {
    width: 18, height: 18, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center',
  },
  feedbackCloseText: { color: '#cbd5e1', fontSize: 14, fontWeight: '900', lineHeight: 14 },

  previewShell: {
    flex: 1, minHeight: 0, borderWidth: 1, borderColor: '#152032',
    borderRadius: 16, overflow: 'hidden', backgroundColor: '#05070b',
  },
  previewHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: 10, paddingHorizontal: 14, paddingVertical: 10,
    backgroundColor: '#0b0f17', borderBottomWidth: 1, borderBottomColor: '#152032',
    flexWrap: 'wrap',
  },
  previewFile: { color: '#d8e1ef', fontSize: 12, fontWeight: '800', fontFamily: 'monospace', flex: 1, minWidth: 140 },
  previewModel: { fontSize: 10, fontWeight: '900', letterSpacing: 0.8, fontFamily: 'monospace' },
  deviceSwitcher: { flexDirection: 'row', gap: 4 },
  deviceBtn: {
    borderWidth: 1, borderColor: '#243246', backgroundColor: '#0a1018',
    borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  deviceBtnText: { color: '#7f8ea3', fontSize: 9, fontWeight: '800', letterSpacing: 0.5, fontFamily: 'monospace' },
  previewStage: {
    flex: 1, minHeight: 0, alignItems: 'center', justifyContent: 'flex-start',
    backgroundColor: '#05070b', padding: 12,
  },
  deviceFrame: {
    flex: 1, minHeight: 0, borderRadius: 8, overflow: 'hidden',
    borderWidth: 1, borderColor: '#1a2432', backgroundColor: '#ffffff',
    position: 'relative',
  },

  errorOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(3, 4, 8, 0.92)',
    alignItems: 'center', justifyContent: 'center', padding: 20,
  },
  errorCard: {
    width: '100%', maxWidth: 520,
    borderWidth: 1, borderColor: '#ef4444',
    borderRadius: 8, backgroundColor: '#140a0a',
    padding: 16, gap: 10,
  },
  errorBadge: { color: '#ef4444', fontSize: 10, fontWeight: '900', letterSpacing: 1.2, fontFamily: 'monospace' },
  errorMessage: { color: '#fecaca', fontSize: 13, lineHeight: 18, fontFamily: 'monospace' },
  errorLocation: { color: '#f87171', fontSize: 11, fontFamily: 'monospace' },
  errorActions: { flexDirection: 'row', gap: 6, marginTop: 4 },
  errorBtn: {
    borderWidth: 1, borderColor: '#ef4444', backgroundColor: '#2a0a0a',
    borderRadius: 4, paddingHorizontal: 10, paddingVertical: 6,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  errorBtnText: { color: '#ef4444', fontSize: 10, fontWeight: '900', letterSpacing: 0.6, fontFamily: 'monospace' },
  errorBtnGhost: {
    borderWidth: 1, borderColor: '#1a1a1a', backgroundColor: 'transparent',
    borderRadius: 4, paddingHorizontal: 10, paddingVertical: 6,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  errorBtnGhostText: { color: '#94a3b8', fontSize: 10, fontWeight: '900', letterSpacing: 0.6, fontFamily: 'monospace' },

  liveShell: {
    flex: 1, minHeight: 0, borderWidth: 1, borderColor: '#152032',
    borderRadius: 16, overflow: 'hidden', backgroundColor: '#05070b',
  },
  liveHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: 10, paddingHorizontal: 14, paddingVertical: 10,
    backgroundColor: '#0b0f17', borderBottomWidth: 1, borderBottomColor: '#152032',
  },
  liveFile: { color: '#d8e1ef', fontSize: 12, fontWeight: '800', fontFamily: 'monospace', flex: 1 },
  liveModel: { fontSize: 10, fontWeight: '900', letterSpacing: 0.8, fontFamily: 'monospace' },
  livePhaseRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 14, paddingVertical: 10,
    backgroundColor: '#07101c', borderBottomWidth: 1, borderBottomColor: '#101827',
    flexWrap: 'wrap',
  },
  livePhaseBadge: {
    fontSize: 10, fontWeight: '900', letterSpacing: 0.9, fontFamily: 'monospace',
    borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3,
    backgroundColor: '#09111f',
  },
  liveMetric: { color: '#7f8ea3', fontSize: 10, fontWeight: '800', letterSpacing: 0.5, fontFamily: 'monospace' },
  liveBody: { flex: 1, minHeight: 0 },
  liveBodyContent: { paddingHorizontal: 14, paddingVertical: 12, gap: 4 },

  codeShell: {
    flex: 1, minHeight: 0, borderWidth: 1, borderColor: '#152032',
    borderRadius: 16, overflow: 'hidden', backgroundColor: '#05070b',
  },
  codeHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: 10, paddingHorizontal: 14, paddingVertical: 10,
    backgroundColor: '#0b0f17', borderBottomWidth: 1, borderBottomColor: '#152032',
  },
  codeFile: { color: '#d8e1ef', fontSize: 12, fontWeight: '800', fontFamily: 'monospace', flex: 1 },
  codeModel: { fontSize: 10, fontWeight: '900', letterSpacing: 0.8, fontFamily: 'monospace' },
  codeScroll: { flex: 1, minHeight: 0 },
  codeScrollContent: { paddingHorizontal: 14, paddingVertical: 12, gap: 4 },
  codeEditor: {
    flex: 1, minHeight: 0,
    color: '#d8e1ef', fontFamily: 'monospace', fontSize: 12, lineHeight: 18,
    backgroundColor: '#05070b',
    paddingHorizontal: 14, paddingVertical: 12,
    textAlignVertical: 'top' as any,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  codeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  codeLineNo: { width: 32, color: '#425066', fontSize: 10, textAlign: 'right', fontFamily: 'monospace', paddingTop: 2 },
  codeLine: { color: '#d8e1ef', fontSize: 12, lineHeight: 18, fontFamily: 'monospace', flex: 1 },
  cursor: { width: 8, height: 16, borderRadius: 2 },
  liveFooter: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: '#152032', backgroundColor: '#07101c',
  },
  liveFooterText: { color: '#7f8ea3', fontSize: 10, fontWeight: '800', letterSpacing: 0.7, fontFamily: 'monospace' },

  toastRow: {
    position: 'absolute', bottom: 12, left: 12, right: 12,
    backgroundColor: '#0f172a', borderWidth: 1, borderColor: '#243246',
    borderRadius: 6, paddingHorizontal: 12, paddingVertical: 8,
    alignItems: 'center',
  },
  toastText: { color: '#cbd5e1', fontSize: 11, fontFamily: 'monospace' },

  historyStrip: {
    backgroundColor: '#050810', borderWidth: 1, borderColor: '#152032',
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, gap: 6,
  },
  historyStripLabel: {
    color: '#425066', fontSize: 9, fontWeight: '900',
    letterSpacing: 1.1, fontFamily: 'monospace',
  },
  historyStripRow: { gap: 6, paddingVertical: 2 },
  historyChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1, borderColor: '#243246', backgroundColor: '#0a1018',
    borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6,
    minWidth: 120, maxWidth: 220,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  historyChipAge: {
    color: '#7f8ea3', fontSize: 9, fontWeight: '900',
    letterSpacing: 0.6, fontFamily: 'monospace',
  },
  historyChipTitle: {
    color: '#d8e1ef', fontSize: 11, fontFamily: 'monospace', marginTop: 2,
  },
  historyDeleteBtn: {
    width: 18, height: 18, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#243246', backgroundColor: '#05070b',
  },
  historyDeleteBtnText: {
    color: '#7f8ea3', fontSize: 12, fontWeight: '800', lineHeight: 14,
  },

  tweakRow: {
    backgroundColor: '#050810', borderWidth: 1, borderColor: '#152032',
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, gap: 6,
    marginTop: 8,
  },
  tweakRowLabel: {
    color: '#425066', fontSize: 9, fontWeight: '900',
    letterSpacing: 1.1, fontFamily: 'monospace',
  },
  tweakChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tweakChip: {
    borderWidth: 1, borderColor: '#243246', backgroundColor: '#0a1018',
    borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  tweakChipText: {
    color: '#94a3b8', fontSize: 10, fontWeight: '800',
    letterSpacing: 0.3, fontFamily: 'monospace',
  },

  pointDrawer: {
    backgroundColor: '#05070b', borderWidth: 1, borderColor: '#22d3ee',
    borderRadius: 8, padding: 12, gap: 8, marginTop: 8,
  },
  pointDrawerHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  pointDrawerTitle: {
    color: '#22d3ee', fontSize: 10, fontWeight: '900',
    letterSpacing: 0.8, fontFamily: 'monospace', flex: 1,
  },
  pointDrawerClose: {
    color: '#7f8ea3', fontSize: 16, fontWeight: '900',
    paddingHorizontal: 6, paddingVertical: 2,
  },
  pointDrawerPreview: {
    color: '#7f8ea3', fontSize: 11, fontFamily: 'monospace',
    backgroundColor: '#0a0f17', borderRadius: 4,
    paddingHorizontal: 8, paddingVertical: 6,
    borderWidth: 1, borderColor: '#152032',
  },
  pointDrawerInput: {
    color: '#d8e1ef', fontSize: 13, fontFamily: 'monospace',
    minHeight: 56, padding: 10, borderRadius: 6,
    borderWidth: 1, borderColor: '#243246', backgroundColor: '#0a0f17',
    textAlignVertical: 'top' as any,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  pointDrawerActions: {
    flexDirection: 'row', gap: 6, justifyContent: 'flex-end',
  },

  templateScrim: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center', justifyContent: 'center', padding: 16,
    zIndex: 100,
  },
  templateCard: {
    width: '100%', maxWidth: 640,
    backgroundColor: '#05070b', borderWidth: 1, borderColor: '#152032',
    borderRadius: 12, padding: 14, gap: 12,
  },
  templateHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  templateTitle: {
    color: '#d8e1ef', fontSize: 11, fontWeight: '900',
    letterSpacing: 1.3, fontFamily: 'monospace',
  },
  templateClose: {
    color: '#7f8ea3', fontSize: 18, fontWeight: '900',
    paddingHorizontal: 8, paddingVertical: 4,
  },
  templateCategories: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  templateCatBtn: {
    borderWidth: 1, borderColor: '#243246', backgroundColor: '#0a1018',
    borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  templateCatText: {
    color: '#94a3b8', fontSize: 10, fontWeight: '900',
    letterSpacing: 0.6, fontFamily: 'monospace',
  },
  templateGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
  },
  templateItem: {
    width: '48%', minWidth: 220,
    borderWidth: 1, borderColor: '#243246', backgroundColor: '#0a0f17',
    borderRadius: 8, padding: 12, gap: 6,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  templateItemHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  templateIcon: { fontSize: 14, fontWeight: '900' },
  templateName: {
    color: '#d8e1ef', fontSize: 13, fontWeight: '800', fontFamily: 'monospace',
  },
  templateDesc: {
    color: '#7f8ea3', fontSize: 11, lineHeight: 15,
  },

  consoleDrawer: {
    marginTop: 8,
    backgroundColor: '#050810', borderWidth: 1, borderColor: '#152032',
    borderRadius: 8,
  },
  consoleHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 10, paddingVertical: 6,
    borderBottomWidth: 1, borderBottomColor: '#152032',
  },
  consoleTitle: {
    color: '#d8e1ef', fontSize: 10, fontWeight: '900',
    letterSpacing: 1, fontFamily: 'monospace',
  },
  consoleEmpty: {
    color: '#475569', fontSize: 11, fontFamily: 'monospace',
    textAlign: 'center', paddingVertical: 16,
  },
  consoleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  consoleLevel: {
    fontSize: 9, fontWeight: '900', fontFamily: 'monospace',
    paddingHorizontal: 5, paddingVertical: 2,
    borderRadius: 3, borderWidth: 1,
    minWidth: 38, textAlign: 'center' as const,
  },
  consoleArgs: {
    flex: 1,
    color: '#d8e1ef', fontSize: 11, fontFamily: 'monospace', lineHeight: 15,
  },
});
