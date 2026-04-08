/**
 * WordPress Chat Commands
 *
 * Slash commands for managing WordPress from chat.
 * Auto-loads stored credentials so the user doesn't have to paste them every time.
 */

import {
  getActiveWordPressCredentials,
  listWordPressPosts,
  getWordPressPost,
  publishToWordPress,
  updateWordPressPost,
  deleteWordPressPost,
  listWordPressPages,
  publishWordPressPage,
  fetchWordPressCategories,
  fetchWordPressTags,
  createWordPressCategory,
  createWordPressTag,
  getWordPressSiteInfo,
  uploadWordPressMedia,
  wpBlock,
  type WordPressPostStatus,
} from './siteAutomation';
import { getSwanBotResponse, type SwanBotContext } from './swanbot';

// ── Types ───────────────────────────────────────────────────────────────────

export interface WpCommandResult {
  success: boolean;
  message: string;
}

// ── Credential loader ───────────────────────────────────────────────────────

async function getCreds(): Promise<{ siteUrl: string; username: string; appPassword: string } | null> {
  const creds = await getActiveWordPressCredentials();
  if (!creds) return null;
  return creds;
}

function noCreds(): WpCommandResult {
  return { success: false, message: 'No WordPress site connected. Go to **Integrations > WordPress** to add your site.' };
}

// ── Featured image generation ───────────────────────────────────────────────

const GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY || '';

async function generateFeaturedImage(title: string): Promise<{ blob: Blob; fileName: string } | null> {
  if (!GEMINI_API_KEY) return null;
  try {
    const prompt = `Create a professional, high-quality blog featured image for an article titled: "${title}". Modern, clean, visually striking. No text in the image.`;
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
        }),
      },
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    for (const part of parts) {
      if (part.inlineData?.mimeType?.startsWith('image/')) {
        const binary = atob(part.inlineData.data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const ext = part.inlineData.mimeType.includes('png') ? 'png' : 'jpg';
        const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
        return { blob: new Blob([bytes], { type: part.inlineData.mimeType }), fileName: `${slug}-featured.${ext}` };
      }
    }
    return null;
  } catch (e) {
    console.warn('[WP] Featured image generation failed:', e);
    return null;
  }
}

async function uploadFeaturedImage(
  siteUrl: string, username: string, appPassword: string,
  title: string, imageUrl?: string,
): Promise<number | undefined> {
  // If a URL is provided, use it directly via publishToWordPress's built-in handler
  if (imageUrl) {
    try {
      const imgResp = await fetch(imageUrl);
      if (!imgResp.ok) return undefined;
      const blob = await imgResp.blob();
      const ext = imageUrl.split('.').pop()?.split('?')[0] || 'jpg';
      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
      const result = await uploadWordPressMedia(siteUrl, username, appPassword, blob, `${slug}-featured.${ext}`, title);
      return result.success ? result.mediaId : undefined;
    } catch { return undefined; }
  }

  // Otherwise, generate one with AI
  const generated = await generateFeaturedImage(title);
  if (!generated) return undefined;
  const result = await uploadWordPressMedia(siteUrl, username, appPassword, generated.blob, generated.fileName, title);
  return result.success ? result.mediaId : undefined;
}

// ── Parse "title | image_url" syntax ────────────────────────────────────────

function splitImageUrl(input: string): [string, string | undefined] {
  const pipeIdx = input.lastIndexOf('|');
  if (pipeIdx === -1) return [input.trim(), undefined];
  const afterPipe = input.slice(pipeIdx + 1).trim();
  if (afterPipe.startsWith('http://') || afterPipe.startsWith('https://')) {
    return [input.slice(0, pipeIdx).trim(), afterPipe];
  }
  return [input.trim(), undefined];
}

// ── Main Dispatcher ─────────────────────────────────────────────────────────

export async function executeWpCommand(
  input: string,
  context: { circleId: string; userId: string; userName?: string },
): Promise<WpCommandResult> {
  const trimmed = input.trim();
  const lower = trimmed.toLowerCase();

  // Strip /wp prefix
  const cmd = lower.startsWith('/wp ') ? lower.slice(4).trim() : lower.replace(/^\/wp$/, 'help');

  if (cmd === 'help') return handleHelp();
  if (cmd === 'status' || cmd === 'info') return handleStatus();
  if (cmd.startsWith('list') || cmd === 'posts') return handleList(cmd);
  if (cmd.startsWith('pages')) return handlePages();
  if (cmd.startsWith('get ')) return handleGet(cmd.slice(4).trim());
  if (cmd.startsWith('delete ') || cmd.startsWith('trash ')) return handleDelete(cmd.replace(/^(delete|trash)\s+/, '').trim());
  if (cmd.startsWith('publish ')) return handlePublish(cmd.slice(8).trim());
  if (cmd.startsWith('draft ')) return handleDraft(trimmed.slice(trimmed.toLowerCase().indexOf('draft ') + 6).trim(), context);
  if (cmd.startsWith('schedule ')) return handleSchedule(trimmed.slice(trimmed.toLowerCase().indexOf('schedule ') + 9).trim(), context);
  if (cmd.startsWith('edit ')) return handleEdit(cmd.slice(5).trim());
  if (cmd.startsWith('image ') || cmd.startsWith('featured ')) return handleSetImage(cmd.replace(/^(image|featured)\s+/, '').trim());
  if (cmd.startsWith('categories') || cmd === 'cats') return handleCategories();
  if (cmd.startsWith('tags')) return handleTags();
  if (cmd.startsWith('write ') || cmd.startsWith('create ')) return handleAIWrite(trimmed.slice(trimmed.indexOf(' ') + 1).trim(), context);

  return { success: false, message: `Unknown WordPress command: "${cmd}". Type \`/wp help\` for available commands.` };
}

// ── Handlers ────────────────────────────────────────────────────────────────

async function handleHelp(): Promise<WpCommandResult> {
  return {
    success: true,
    message: `**WordPress Commands**

| Command | Description |
|---------|-------------|
| \`/wp status\` | Site info and connection status |
| \`/wp list\` | List recent posts |
| \`/wp list drafts\` | List draft posts |
| \`/wp pages\` | List all pages |
| \`/wp get <id>\` | Get post details by ID |
| \`/wp draft <title>\` | Create a draft post (AI writes content) |
| \`/wp write <topic>\` | AI writes and drafts a full blog post |
| \`/wp publish <id>\` | Publish a draft post |
| \`/wp schedule <date> <title>\` | Schedule a post for future |
| \`/wp edit <id> title: New Title\` | Edit a post |
| \`/wp delete <id>\` | Move post to trash |
| \`/wp image <id> <url>\` | Set featured image from URL |
| \`/wp categories\` | List categories |
| \`/wp tags\` | List tags |

**Adding featured images:**
- \`/wp draft My Post | https://example.com/img.jpg\` — draft with featured image
- \`/wp write My Topic | https://example.com/img.jpg\` — AI write with featured image
- \`/wp image 42 https://example.com/img.jpg\` — set image on existing post`,
  };
}

async function handleStatus(): Promise<WpCommandResult> {
  const creds = await getCreds();
  if (!creds) return noCreds();

  const info = await getWordPressSiteInfo(creds.siteUrl);
  const { posts, total } = await listWordPressPosts(creds.siteUrl, creds.username, creds.appPassword, { perPage: 1 });
  const cats = await fetchWordPressCategories(creds.siteUrl, creds.username, creds.appPassword);
  const tags = await fetchWordPressTags(creds.siteUrl, creds.username, creds.appPassword);

  return {
    success: true,
    message: `**WordPress Connected**

| | |
|---|---|
| **Site** | ${info?.name || 'Unknown'} |
| **URL** | ${creds.siteUrl} |
| **User** | ${creds.username} |
| **Total Posts** | ${total} |
| **Categories** | ${cats.length} |
| **Tags** | ${tags.length} |
| **Timezone** | ${info?.timezone_string || 'UTC'} |
| **Latest Post** | ${posts[0]?.title || 'None'} |`,
  };
}

async function handleList(cmd: string): Promise<WpCommandResult> {
  const creds = await getCreds();
  if (!creds) return noCreds();

  const status = cmd.includes('draft') ? 'draft' : cmd.includes('pending') ? 'pending' : cmd.includes('all') ? 'any' : undefined;
  const search = cmd.replace(/^list\s*/, '').replace(/drafts?|pending|all|posts?/g, '').trim() || undefined;

  const { posts, total } = await listWordPressPosts(creds.siteUrl, creds.username, creds.appPassword, {
    status, search, perPage: 15,
  });

  if (posts.length === 0) {
    return { success: true, message: `No ${status || ''} posts found${search ? ` matching "${search}"` : ''}.` };
  }

  const rows = posts.map(p => {
    const date = new Date(p.date).toLocaleDateString();
    const statusBadge = p.status === 'publish' ? 'LIVE' : p.status === 'draft' ? 'DRAFT' : p.status.toUpperCase();
    return `| ${p.id} | ${p.title.slice(0, 40)} | ${statusBadge} | ${date} |`;
  });

  return {
    success: true,
    message: `**WordPress Posts** (${total} total)\n\n| ID | Title | Status | Date |\n|---|---|---|---|\n${rows.join('\n')}`,
  };
}

async function handlePages(): Promise<WpCommandResult> {
  const creds = await getCreds();
  if (!creds) return noCreds();

  const pages = await listWordPressPages(creds.siteUrl, creds.username, creds.appPassword);
  if (pages.length === 0) return { success: true, message: 'No pages found.' };

  const rows = pages.map(p => `| ${p.id} | ${p.title.slice(0, 40)} | ${p.status.toUpperCase()} | ${p.link} |`);
  return {
    success: true,
    message: `**WordPress Pages** (${pages.length})\n\n| ID | Title | Status | URL |\n|---|---|---|---|\n${rows.join('\n')}`,
  };
}

async function handleGet(idStr: string): Promise<WpCommandResult> {
  const creds = await getCreds();
  if (!creds) return noCreds();

  const id = parseInt(idStr, 10);
  if (isNaN(id)) return { success: false, message: 'Usage: `/wp get <post_id>`' };

  const post = await getWordPressPost(creds.siteUrl, creds.username, creds.appPassword, id);
  if (!post) return { success: false, message: `Post #${id} not found.` };

  return {
    success: true,
    message: `**${post.title}** (ID: ${post.id})

| | |
|---|---|
| **Status** | ${post.status.toUpperCase()} |
| **Date** | ${new Date(post.date).toLocaleString()} |
| **Modified** | ${new Date(post.modified).toLocaleString()} |
| **URL** | ${post.link} |
| **Slug** | ${post.slug} |
| **Categories** | ${post.categories.join(', ') || 'None'} |
| **Tags** | ${post.tags.join(', ') || 'None'} |
| **Excerpt** | ${post.excerpt.slice(0, 200) || '(none)'} |`,
  };
}

async function handleDelete(idStr: string): Promise<WpCommandResult> {
  const creds = await getCreds();
  if (!creds) return noCreds();

  const id = parseInt(idStr, 10);
  if (isNaN(id)) return { success: false, message: 'Usage: `/wp delete <post_id>`' };

  const result = await deleteWordPressPost(creds.siteUrl, creds.username, creds.appPassword, id);
  if (!result.success) return { success: false, message: `Failed to delete post #${id}: ${result.error}` };
  return { success: true, message: `Post #${id} moved to trash.` };
}

async function handlePublish(idStr: string): Promise<WpCommandResult> {
  const creds = await getCreds();
  if (!creds) return noCreds();

  const id = parseInt(idStr, 10);
  if (isNaN(id)) return { success: false, message: 'Usage: `/wp publish <post_id>`' };

  const result = await updateWordPressPost(creds.siteUrl, creds.username, creds.appPassword, id, { status: 'publish' });
  if (!result.success) return { success: false, message: `Failed to publish: ${result.error}` };
  return { success: true, message: `Post #${id} is now **LIVE** at ${result.postUrl}` };
}

async function handleDraft(rawTitle: string, context: { circleId: string; userId: string; userName?: string }): Promise<WpCommandResult> {
  const creds = await getCreds();
  if (!creds) return noCreds();
  if (!rawTitle) return { success: false, message: 'Usage: `/wp draft <title>` or `/wp draft <title> | <image_url>`' };

  // Parse optional image URL: title | https://...
  const [title, imageUrl] = splitImageUrl(rawTitle);

  // Use AI to generate content
  const aiContext: SwanBotContext = { userId: context.userId, circleId: context.circleId, userName: context.userName };
  const content = await getSwanBotResponse(
    `Write a blog post titled "${title}". Write it in HTML suitable for WordPress. Include proper headings (h2, h3), paragraphs, and formatting. Write at least 500 words. Return ONLY the HTML content, no explanation.`,
    aiContext,
  );

  // Upload featured image if provided
  const featuredMediaId = imageUrl ? await uploadFeaturedImage(creds.siteUrl, creds.username, creds.appPassword, title, imageUrl) : undefined;

  const result = await publishToWordPress({
    siteUrl: creds.siteUrl, username: creds.username, appPassword: creds.appPassword,
    title, content, status: 'draft',
    featuredImageUrl: featuredMediaId ? undefined : imageUrl, // If upload worked, we set it manually below
  });

  if (!result.success) return { success: false, message: `Draft creation failed: ${result.error}` };

  // Set featured image if uploaded separately
  if (featuredMediaId && result.postId) {
    await updateWordPressPost(creds.siteUrl, creds.username, creds.appPassword, result.postId, { featured_media: featuredMediaId } as any);
  }

  return { success: true, message: `Draft created: **${title}** (ID: ${result.postId})${featuredMediaId ? '\nFeatured image attached.' : imageUrl ? '\nFeatured image upload failed — post created without it.' : ''}\n\nUse \`/wp publish ${result.postId}\` when ready to go live.` };
}

async function handleSchedule(input: string, context: { circleId: string; userId: string; userName?: string }): Promise<WpCommandResult> {
  const creds = await getCreds();
  if (!creds) return noCreds();

  // Parse: /wp schedule 2026-04-15 My Post Title | https://img.com/photo.jpg
  const match = input.match(/^(\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?)\s+(.+)$/);
  if (!match) return { success: false, message: 'Usage: `/wp schedule <YYYY-MM-DD> <title>`\nExample: `/wp schedule 2026-04-15 My Awesome Post | https://img.com/photo.jpg`' };

  const [, dateStr, rawTitle] = match;
  const [title, imageUrl] = splitImageUrl(rawTitle);
  const scheduleDate = new Date(dateStr);
  if (isNaN(scheduleDate.getTime()) || scheduleDate <= new Date()) {
    return { success: false, message: 'Schedule date must be in the future.' };
  }

  const aiContext: SwanBotContext = { userId: context.userId, circleId: context.circleId, userName: context.userName };
  const content = await getSwanBotResponse(
    `Write a blog post titled "${title}". Write it in HTML suitable for WordPress. Include proper headings, paragraphs, formatting. At least 500 words. Return ONLY HTML.`,
    aiContext,
  );

  const featuredMediaId = imageUrl ? await uploadFeaturedImage(creds.siteUrl, creds.username, creds.appPassword, title, imageUrl) : undefined;

  const result = await publishToWordPress({
    siteUrl: creds.siteUrl, username: creds.username, appPassword: creds.appPassword,
    title, content, status: 'draft',
    featuredImageUrl: featuredMediaId ? undefined : imageUrl,
  });

  if (!result.success) return { success: false, message: `Failed: ${result.error}` };

  if (featuredMediaId && result.postId) {
    await updateWordPressPost(creds.siteUrl, creds.username, creds.appPassword, result.postId, { featured_media: featuredMediaId } as any);
  }

  // Schedule it
  await updateWordPressPost(creds.siteUrl, creds.username, creds.appPassword, result.postId!, {
    status: 'future' as WordPressPostStatus,
  });

  return {
    success: true,
    message: `Post scheduled: **${title}** (ID: ${result.postId})${featuredMediaId ? '\nFeatured image attached.' : ''}\nGoes live: ${scheduleDate.toLocaleString()}\n\nUse \`/wp get ${result.postId}\` to check status.`,
  };
}

async function handleSetImage(input: string): Promise<WpCommandResult> {
  const creds = await getCreds();
  if (!creds) return noCreds();

  // Parse: /wp image 42 https://example.com/img.jpg
  const match = input.match(/^(\d+)\s+(https?:\/\/.+)$/);
  if (!match) return { success: false, message: 'Usage: `/wp image <post_id> <image_url>`\nExample: `/wp image 42 https://example.com/photo.jpg`' };

  const [, idStr, url] = match;
  const postId = parseInt(idStr, 10);

  const mediaId = await uploadFeaturedImage(creds.siteUrl, creds.username, creds.appPassword, `post-${postId}`, url);
  if (!mediaId) return { success: false, message: `Failed to upload image from: ${url.slice(0, 80)}` };

  const result = await updateWordPressPost(creds.siteUrl, creds.username, creds.appPassword, postId, { featured_media: mediaId } as any);
  if (!result.success) return { success: false, message: `Image uploaded but failed to set on post: ${result.error}` };

  return { success: true, message: `Featured image set on post #${postId}.` };
}

async function handleEdit(input: string): Promise<WpCommandResult> {
  const creds = await getCreds();
  if (!creds) return noCreds();

  // Parse: /wp edit 123 title: New Title
  const match = input.match(/^(\d+)\s+(\w+):\s*(.+)$/);
  if (!match) return { success: false, message: 'Usage: `/wp edit <id> <field>: <value>`\nFields: title, status, excerpt\nExample: `/wp edit 42 title: My Updated Title`' };

  const [, idStr, field, value] = match;
  const id = parseInt(idStr, 10);
  const updates: Record<string, string> = {};
  if (field === 'title') updates.title = value;
  else if (field === 'status') updates.status = value as any;
  else if (field === 'excerpt') updates.excerpt = value;
  else return { success: false, message: `Unknown field "${field}". Use: title, status, excerpt` };

  const result = await updateWordPressPost(creds.siteUrl, creds.username, creds.appPassword, id, updates);
  if (!result.success) return { success: false, message: `Edit failed: ${result.error}` };
  return { success: true, message: `Post #${id} updated. ${field} = "${value}"` };
}

async function handleCategories(): Promise<WpCommandResult> {
  const creds = await getCreds();
  if (!creds) return noCreds();

  const cats = await fetchWordPressCategories(creds.siteUrl, creds.username, creds.appPassword);
  if (cats.length === 0) return { success: true, message: 'No categories found.' };

  const rows = cats.map(c => `| ${c.id} | ${c.name} | ${c.slug} | ${c.count} |`);
  return { success: true, message: `**Categories**\n\n| ID | Name | Slug | Posts |\n|---|---|---|---|\n${rows.join('\n')}` };
}

async function handleTags(): Promise<WpCommandResult> {
  const creds = await getCreds();
  if (!creds) return noCreds();

  const tags = await fetchWordPressTags(creds.siteUrl, creds.username, creds.appPassword);
  if (tags.length === 0) return { success: true, message: 'No tags found.' };

  const rows = tags.map(t => `| ${t.id} | ${t.name} | ${t.slug} | ${t.count} |`);
  return { success: true, message: `**Tags**\n\n| ID | Name | Slug | Posts |\n|---|---|---|---|\n${rows.join('\n')}` };
}

async function handleAIWrite(rawTopic: string, context: { circleId: string; userId: string; userName?: string }): Promise<WpCommandResult> {
  const creds = await getCreds();
  if (!creds) return noCreds();
  if (!rawTopic) return { success: false, message: 'Usage: `/wp write <topic>` or `/wp write <topic> | <image_url>`' };

  const [topic, imageUrl] = splitImageUrl(rawTopic);

  // AI generates full blog post with SEO
  const aiContext: SwanBotContext = { userId: context.userId, circleId: context.circleId, userName: context.userName };
  const aiResponse = await getSwanBotResponse(
    `You are a professional blog writer. Write a complete, high-quality blog post about: "${topic}"

Requirements:
- Compelling title (return it on the first line prefixed with TITLE: )
- SEO-optimized meta description (return on second line prefixed with META: )
- 3-5 suggested tags (return on third line prefixed with TAGS: comma,separated)
- Full HTML content after a blank line — at least 800 words
- Use h2, h3 headings, paragraphs, bullet lists, bold text
- Engaging intro, detailed body, strong conclusion with CTA
- Professional but conversational tone`,
    aiContext,
  );

  // Parse AI response
  const lines = aiResponse.split('\n');
  let title = topic;
  let metaDesc = '';
  let tagNames: string[] = [];
  let contentStart = 0;

  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    if (lines[i].startsWith('TITLE:')) { title = lines[i].slice(6).trim(); contentStart = i + 1; }
    else if (lines[i].startsWith('META:')) { metaDesc = lines[i].slice(5).trim(); contentStart = i + 1; }
    else if (lines[i].startsWith('TAGS:')) { tagNames = lines[i].slice(5).split(',').map(t => t.trim()).filter(Boolean); contentStart = i + 1; }
    else if (lines[i].trim() === '' && contentStart > 0) { contentStart = i + 1; break; }
  }

  const content = lines.slice(contentStart).join('\n').trim();

  // Create tags if they don't exist
  const existingTags = await fetchWordPressTags(creds.siteUrl, creds.username, creds.appPassword);
  const tagIds: number[] = [];
  for (const name of tagNames.slice(0, 5)) {
    const existing = existingTags.find(t => t.name.toLowerCase() === name.toLowerCase());
    if (existing) { tagIds.push(existing.id); }
    else {
      const created = await createWordPressTag(creds.siteUrl, creds.username, creds.appPassword, name);
      if (created) tagIds.push(created.id);
    }
  }

  // Upload featured image if provided
  const featuredMediaId = imageUrl ? await uploadFeaturedImage(creds.siteUrl, creds.username, creds.appPassword, title, imageUrl) : undefined;

  // Publish as draft with SEO meta
  const meta: Record<string, string> = {};
  if (metaDesc) {
    meta._yoast_wpseo_metadesc = metaDesc;
    meta.rank_math_description = metaDesc;
  }

  const result = await publishToWordPress({
    siteUrl: creds.siteUrl, username: creds.username, appPassword: creds.appPassword,
    title, content, status: 'draft', tags: tagIds, meta,
    featuredImageUrl: featuredMediaId ? undefined : imageUrl,
  });

  if (!result.success) return { success: false, message: `Failed to create post: ${result.error}` };

  // Set featured image if uploaded separately
  if (featuredMediaId && result.postId) {
    await updateWordPressPost(creds.siteUrl, creds.username, creds.appPassword, result.postId, { featured_media: featuredMediaId } as any);
  }

  return {
    success: true,
    message: `**AI Blog Post Created** (Draft)

| | |
|---|---|
| **Title** | ${title} |
| **ID** | ${result.postId} |
| **Status** | DRAFT |
| **Featured Image** | ${featuredMediaId ? 'Attached' : imageUrl ? 'Upload failed' : 'None — use `/wp image ${result.postId} <url>`'} |
| **Tags** | ${tagNames.join(', ') || 'None'} |
| **SEO Meta** | ${metaDesc.slice(0, 80) || 'None'}... |
| **Words** | ~${content.split(/\s+/).length} |

Use \`/wp publish ${result.postId}\` to go live, or \`/wp get ${result.postId}\` to review.`,
  };
}
