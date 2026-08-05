import type { LocalComputerAwarenessIntent } from './localComputerAwarenessIntent';

function intentKey(intent: LocalComputerAwarenessIntent): string {
  return JSON.stringify({
    kind: intent.kind,
    appQuery: intent.appQuery || null,
    menuPath: intent.menuPath || null,
    targetLabel: intent.targetLabel || null,
    combo: intent.combo || null,
    reason: intent.reason || null,
  });
}

function uniqueIntentCandidates(candidates: LocalComputerAwarenessIntent[]): LocalComputerAwarenessIntent[] {
  const seen = new Set<string>();
  const out: LocalComputerAwarenessIntent[] = [];
  for (const candidate of candidates) {
    const key = intentKey(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
  }
  return out;
}

export function isInDesignIntent(intent: LocalComputerAwarenessIntent): boolean {
  return /\bindesign\b/i.test(`${intent.appQuery || ''} ${intent.reason || ''}`) ||
    Boolean(intent.kind === 'open_file_search_match' && intent.extensions?.some((ext) => ext.toLowerCase() === 'indd'));
}

function targetLabelAlternates(label: string): string[] {
  const normalized = label.toLowerCase().replace(/\s+/g, ' ').trim();
  const explicit: Array<[RegExp, string[]]> = [
    [/\bdisclaimer|legal|fine print|terms\b/, ['Disclaimer', 'Disclaimers', 'Legal', 'Legal Copy', 'Fine Print', 'Terms']],
    [/\boffer|apr|finance|lease|payment|rebate|incentive\b/, ['Offer', 'Offers', 'APR', 'Finance', 'Lease', 'Payment', 'Incentive']],
    [/\bprice|sale price|msrp\b/, ['Price', 'Sale Price', 'MSRP', 'Pricing']],
    [/\bvehicle|model|year|trim|stock|vin\b/, ['Vehicle', 'Vehicle Info', 'Model', 'Stock', 'VIN']],
    [/\bdealer|phone|website|url\b/, ['Dealer Info', 'Dealer', 'Phone', 'Website', 'URL']],
    [/\bcta|button\b/, ['CTA', 'Call To Action', 'Button']],
    [/\bheadline\b/, ['Headline', 'Title', 'Header']],
    [/\bsubheadline\b/, ['Subheadline', 'Subhead', 'Subtitle']],
    [/\bchange all\b/, ['Change All', 'Change All...', 'Change', 'Replace All']],
    [/\bgenerate\b/, ['Generate', 'Generate...', 'Create']],
    [/\bexport\b/, ['Export', 'Export...', 'Save']],
    [/\bpackage\b/, ['Package...', 'Package', 'Continue']],
    [/\brelink\b/, ['Relink', 'Relink...', 'Link', 'Update Link']],
    [/\bselect data source\b/, ['Select Data Source...', 'Select Data Source', 'Choose Data Source']],
    [/\bpreview\b/, ['Preview', 'Preview Multiple Record Layout', 'Preview Record']],
    [/\bcreate merged document\b/, ['Create Merged Document...', 'Create Merged Document', 'Create']],
    [/\bupdate all links\b/, ['Update All Links', 'Update Link', 'Update Modified Links']],
    [/\bupdate link\b/, ['Update Link', 'Update All Links', 'Update Modified Links']],
    [/\bedit original\b/, ['Edit Original', 'Original', 'Open Original']],
    [/\breveal in finder\b/, ['Reveal in Finder', 'Reveal', 'Show in Finder']],
    [/\bgo to link\b/, ['Go to Link', 'Go To Link']],
    [/\blink info\b/, ['Link Info', 'Info']],
    [/\bnew layer\b/, ['New Layer...', 'New Layer', 'Create New Layer', 'New']],
    [/\blayer options\b/, ['Layer Options...', 'Layer Options', 'Options']],
    [/\bshow layer\b/, ['Show Layer', 'Show', 'Visible']],
    [/\bhide layer\b/, ['Hide Layer', 'Hide', 'Visible']],
    [/\block layer\b/, ['Lock Layer', 'Lock']],
    [/\bunlock layer\b/, ['Unlock Layer', 'Unlock']],
    [/\bnew color swatch\b/, ['New Color Swatch...', 'New Swatch...', 'New Color Swatch', 'New Swatch']],
    [/\brgb\b/, ['RGB', 'RGB Color', 'Color Mode: RGB']],
    [/\bfill\b/, ['Fill', 'Fill Color']],
    [/\bstroke\b/, ['Stroke', 'Stroke Color']],
    [/\btext\b/, ['Text', 'Text Color', 'Formatting Affects Text']],
    [/\bno text wrap\b/, ['No Text Wrap', 'None']],
    [/\bwrap around bounding box\b/, ['Wrap Around Bounding Box', 'Bounding Box']],
    [/\bwrap around object shape\b/, ['Wrap Around Object Shape', 'Object Shape']],
    [/\bjump object\b/, ['Jump Object', 'Jump']],
    [/\bjump to next column\b/, ['Jump to Next Column', 'Next Column']],
    [/\bapply parent\b/, ['Apply Parent to Pages...', 'Apply Parent to Pages', 'Apply Parent']],
    [/\bcreate guides\b/, ['Create Guides...', 'Create Guides', 'OK']],
    [/\bhorizontal align center\b|\balign center\b/, ['Horizontal Align Center', 'Align Horizontal Centers', 'Align Center']],
    [/\bvertical align center\b|\balign middle\b/, ['Vertical Align Center', 'Align Vertical Centers', 'Align Middle']],
    [/\bhorizontal align left\b|\balign left\b/, ['Horizontal Align Left', 'Align Left Edges', 'Align Left']],
    [/\bhorizontal align right\b|\balign right\b/, ['Horizontal Align Right', 'Align Right Edges', 'Align Right']],
    [/\bvertical align top\b|\balign top\b/, ['Vertical Align Top', 'Align Top Edges', 'Align Top']],
    [/\bvertical align bottom\b|\balign bottom\b/, ['Vertical Align Bottom', 'Align Bottom Edges', 'Align Bottom']],
    [/\balign to page\b/, ['Align to Page', 'Page']],
    [/\balign to spread\b/, ['Align to Spread', 'Spread']],
    [/\balign to margin\b/, ['Align to Margin', 'Margin']],
    [/\bok\b/, ['OK', 'Ok', 'Done']],
    [/\bdone\b/, ['Done', 'OK', 'Close']],
  ];
  for (const [pattern, alternates] of explicit) {
    if (pattern.test(normalized)) return alternates;
  }
  return [label];
}

function fieldLabelAlternates(label: string): string[] {
  const normalized = label.toLowerCase().replace(/\s+/g, ' ').trim();
  if (/\bfind\b/.test(normalized)) return ['Find what', 'Find What:', 'Find:', 'Find Text', 'Search'];
  if (/\bchange|replace\b/.test(normalized)) return ['Change to', 'Change To:', 'Replace with', 'Replace With:', 'Change'];
  if (/\bpages?\b/.test(normalized)) return ['Pages', 'Number of Pages', 'Page Count'];
  if (/\bcolumns?\b/.test(normalized)) return ['Columns', 'Number of Columns'];
  if (/\brange\b/.test(normalized)) return ['Range', 'Pages', 'Page Range'];
  if (/\bname\b/.test(normalized)) return ['Name', 'Layer Name', 'Swatch Name'];
  if (/\bswatch name\b/.test(normalized)) return ['Swatch Name', 'Name'];
  if (/\bred\b/.test(normalized)) return ['Red', 'R'];
  if (/\bgreen\b/.test(normalized)) return ['Green', 'G'];
  if (/\bblue\b/.test(normalized)) return ['Blue', 'B'];
  if (/\bbleed top\b/.test(normalized)) return ['Bleed Top', 'Top'];
  if (/\bbleed bottom\b/.test(normalized)) return ['Bleed Bottom', 'Bottom'];
  if (/\bbleed inside\b/.test(normalized)) return ['Bleed Inside', 'Inside', 'Left'];
  if (/\bbleed outside\b/.test(normalized)) return ['Bleed Outside', 'Outside', 'Right'];
  if (/^top$/.test(normalized)) return ['Top', 'Top Margin'];
  if (/^bottom$/.test(normalized)) return ['Bottom', 'Bottom Margin'];
  if (/^inside$/.test(normalized)) return ['Inside', 'Inside Margin', 'Left'];
  if (/^outside$/.test(normalized)) return ['Outside', 'Outside Margin', 'Right'];
  if (/\bapply parent\b/.test(normalized)) return ['Apply Parent', 'Parent', 'Master'];
  if (/\bto pages\b/.test(normalized)) return ['To Pages', 'Pages', 'Page Range'];
  if (/\brows?\b/.test(normalized)) return ['Rows', 'Number of Rows'];
  if (/^(?:w|width)\b/.test(normalized)) return ['W', 'W:', 'Width', 'Width:'];
  if (/^(?:h|height)\b/.test(normalized)) return ['H', 'H:', 'Height', 'Height:'];
  return [label];
}

function menuPathAlternates(menuPath: string[]): string[][] {
  const key = menuPath.join(' > ').toLowerCase();
  const alternates: string[][] = [menuPath];
  if (/edit > find\/change/.test(key)) alternates.push(['Edit', 'Find/Change'], ['Edit', 'Find/Change...']);
  if (/file > export/.test(key)) alternates.push(['File', 'Export'], ['File', 'Export...']);
  if (/file > place/.test(key)) alternates.push(['File', 'Place'], ['File', 'Place...']);
  if (/file > package/.test(key)) alternates.push(['File', 'Package'], ['File', 'Package...']);
  if (/object > object layer options/.test(key)) alternates.push(['Object', 'Object Layer Options'], ['Object', 'Object Layer Options...']);
  if (/layout > pages > duplicate/.test(key)) alternates.push(['Layout', 'Pages', 'Duplicate Spread'], ['Layout', 'Pages', 'Duplicate Page']);
  if (/edit > duplicate/.test(key)) alternates.push(['Edit', 'Duplicate']);
  if (/edit > paste in place/.test(key)) alternates.push(['Edit', 'Paste in Place']);
  if (/file > document setup/.test(key)) alternates.push(['File', 'Document Setup'], ['File', 'Document Setup...']);
  if (/file > adobe pdf presets/.test(key)) alternates.push(menuPath.map((part) => part.replace(/\.\.\.$/, '')), menuPath);
  if (/layout > margins and columns/.test(key)) alternates.push(['Layout', 'Margins and Columns'], ['Layout', 'Margins and Columns...']);
  if (/layout > create guides/.test(key)) alternates.push(['Layout', 'Create Guides'], ['Layout', 'Create Guides...']);
  if (/layout > pages > apply parent/.test(key)) alternates.push(['Layout', 'Pages', 'Apply Parent to Pages'], ['Layout', 'Pages', 'Apply Parent to Pages...']);
  if (/object > group/.test(key)) alternates.push(['Object', 'Group']);
  if (/object > ungroup/.test(key)) alternates.push(['Object', 'Ungroup']);
  if (/object > lock/.test(key)) alternates.push(['Object', 'Lock']);
  if (/object > unlock all on spread/.test(key)) alternates.push(['Object', 'Unlock All on Spread'], ['Object', 'Unlock']);
  if (/type > change case/.test(key)) alternates.push(menuPath.map((part) => part === 'UPPERCASE' ? 'Uppercase' : part));
  if (/window > contextual task bar/.test(key)) alternates.push(['Window', 'Contextual Task Bar'], ['Window', 'Contextual Tasks']);
  if (/window > output > preflight/.test(key)) alternates.push(['Window', 'Output', 'Preflight'], ['Window', 'Preflight']);
  if (/window > utilities > data merge/.test(key)) alternates.push(['Window', 'Utilities', 'Data Merge'], ['Window', 'Data Merge']);
  if (/window > object & layout > align/.test(key)) alternates.push(['Window', 'Object & Layout', 'Align'], ['Window', 'Align']);
  if (/window > object & layout > transform/.test(key)) alternates.push(['Window', 'Object & Layout', 'Transform'], ['Window', 'Transform']);
  if (/window > styles > paragraph styles/.test(key)) alternates.push(['Window', 'Styles', 'Paragraph Styles'], ['Window', 'Paragraph Styles']);
  if (/window > styles > character styles/.test(key)) alternates.push(['Window', 'Styles', 'Character Styles'], ['Window', 'Character Styles']);
  if (/window > styles > object styles/.test(key)) alternates.push(['Window', 'Styles', 'Object Styles'], ['Window', 'Object Styles']);
  if (/window > links/.test(key)) alternates.push(['Window', 'Links']);
  if (/window > layers/.test(key)) alternates.push(['Window', 'Layers']);
  if (/window > color > swatches/.test(key)) alternates.push(['Window', 'Color', 'Swatches'], ['Window', 'Swatches']);
  if (/window > text wrap/.test(key)) alternates.push(['Window', 'Text Wrap']);
  return Array.from(new Map(alternates.map((path) => [path.join(' > '), path])).values());
}

export function buildInDesignRecoveryCandidatesForIntent(intent: LocalComputerAwarenessIntent): LocalComputerAwarenessIntent[] {
  if (!isInDesignIntent(intent)) return [];
  const base: LocalComputerAwarenessIntent = {
    ...intent,
    appQuery: intent.appQuery || 'InDesign',
    reason: `${intent.reason || 'local-indesign-action'}-recovery-retry`,
  };
  const candidates: LocalComputerAwarenessIntent[] = [base];
  if (intent.kind === 'menu_click' && intent.menuPath?.length) {
    for (const menuPath of menuPathAlternates(intent.menuPath)) {
      candidates.push({ ...base, menuPath, reason: 'local-indesign-menu-recovery' });
    }
  }
  if (intent.kind === 'semantic_click' && intent.targetLabel) {
    for (const targetLabel of targetLabelAlternates(intent.targetLabel)) {
      candidates.push({ ...base, targetLabel, reason: 'local-indesign-target-recovery' });
    }
  }
  if (intent.kind === 'set_field_text' && intent.targetLabel) {
    for (const targetLabel of fieldLabelAlternates(intent.targetLabel)) {
      candidates.push({ ...base, targetLabel, reason: 'local-indesign-field-recovery' });
    }
  }
  return uniqueIntentCandidates(candidates).slice(0, 8);
}
