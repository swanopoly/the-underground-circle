import { normalizeDesktopFileSearchQuery } from './fileSearchQuery';

export type LocalComputerAwarenessKind =
  | 'browser_tabs'
  | 'window_state'
  | 'running_apps'
  | 'clipboard'
  | 'screen_state'
  | 'launch_app'
  | 'focus_app'
  | 'open_url'
  | 'open_path'
  | 'open_file_search_match'
  | 'clipboard_write'
  | 'clipboard_clear'
  | 'shortcuts_list'
  | 'shortcut_run'
  | 'file_list'
  | 'file_read'
  | 'file_search'
  | 'file_stat'
  | 'file_rename'
  | 'file_copy'
  | 'file_trash'
  | 'file_mkdir'
  | 'file_write_text'
  | 'a11y_tree'
  | 'window_manage'
  | 'semantic_click'
  | 'menu_click'
  | 'type_text'
  | 'paste_text'
  | 'set_field_text'
  | 'indesign_find_change'
  | 'indesign_batch_find_change'
  | 'indesign_document_status'
  | 'indesign_text_inventory'
  | 'indesign_set_layer_state'
  | 'indesign_batch_update_text_layers'
  | 'indesign_update_text_layer'
  | 'indesign_relink_asset'
  | 'indesign_package_document'
  | 'indesign_export_proof'
  | 'photoshop_document_status'
  | 'photoshop_layer_inventory'
  | 'photoshop_set_layer_state'
  | 'photoshop_update_text_layer'
  | 'photoshop_place_asset'
  | 'photoshop_export_proof'
  | 'press_keys'
  | 'wait'
  | 'wait_for_app'
  | 'mouse_move'
  | 'mouse_click'
  | 'mouse_down'
  | 'mouse_up'
  | 'mouse_drag'
  | 'mouse_scroll';

export type LocalComputerAwarenessIntent = {
  route: boolean;
  kind: LocalComputerAwarenessKind | null;
  browsers?: string[];
  appQuery?: string;
  url?: string;
  path?: string;
  text?: string;
  combo?: string;
  query?: string;
  rootPath?: string;
  extensions?: string[];
  shortcutName?: string;
  targetLabel?: string;
  layerStateAction?: 'show' | 'hide' | 'lock' | 'unlock';
  replacements?: Array<{ findText: string; changeText: string }>;
  fieldUpdates?: Array<{ fieldName: string; replacementText: string }>;
  assetPath?: string;
  linkQuery?: string;
  outputPath?: string;
  outputFolderPath?: string;
  includeIdml?: boolean;
  includePdf?: boolean;
  format?: 'pdf' | 'png' | 'jpg' | 'jpeg';
  menuPath?: string[];
  windowAction?: 'focus' | 'raise' | 'minimize' | 'unminimize' | 'zoom' | 'resize';
  mouseButton?: 'left' | 'right';
  clickCount?: number;
  x?: number;
  y?: number;
  fromX?: number;
  fromY?: number;
  toX?: number;
  toY?: number;
  width?: number;
  height?: number;
  deltaX?: number;
  deltaY?: number;
  durationMs?: number;
  reason: string;
};

const CHROME_RE = /\b(chrome|google chrome)\b/i;
const SAFARI_RE = /\bsafari\b/i;
const BRAVE_RE = /\bbrave\b/i;
const EDGE_RE = /\b(edge|microsoft edge)\b/i;
const ARC_RE = /\barc\b/i;
const OPERA_RE = /\bopera\b/i;
const VIVALDI_RE = /\bvivaldi\b/i;

const BROWSER_TAB_RE = /\b(tabs?|browser tabs?|open tabs?|current tabs?)\b/i;
const TAB_AWARENESS_RE = /\b(can you|are you able to|tell me|show me|list|see|view|what|which|all)\b[\s\S]{0,120}\b(tabs?|browser tabs?|open tabs?|current tabs?)\b/i;
const WINDOW_STATE_RE = /\b(active window|focused window|frontmost|window state|open windows?|what(?:'s| is) on my screen|screen state|desktop state)\b/i;
const RUNNING_APPS_RE = /\b(running apps?|open apps?|apps? (?:are|is) open|what apps?|which apps?)\b/i;
const CLIPBOARD_RE = /\b(clipboard|pasteboard|copied text|what did i copy)\b/i;
const CLIPBOARD_WRITE_RE = /^\s*(?:please\s+)?(?:copy|put|write|save)\s+([\s\S]{1,4000}?)\s+(?:to|in|on)\s+(?:my\s+)?(?:clipboard|pasteboard)\s*[.!?]?\s*$/i;
const CLIPBOARD_WRITE_AFTER_RE = /^\s*(?:please\s+)?(?:copy|put|write|save)\s+(?:to|in|on)\s+(?:my\s+)?(?:clipboard|pasteboard)\s*:?\s+([\s\S]{1,4000})$/i;
const CLIPBOARD_SET_TO_RE = /^\s*(?:please\s+)?(?:set|write|save)\s+(?:my\s+)?(?:clipboard|pasteboard)\s+(?:to|as)\s+([\s\S]{1,4000})$/i;
const CLIPBOARD_CLEAR_RE = /\b(clear|empty|wipe)\b[\s\S]{0,80}\b(?:clipboard|pasteboard)\b/i;
const SCREEN_STATE_RE = /\b(?:(?:take|capture|grab)\s+(?:a\s+|the\s+|my\s+)?(?:(?:selection|selected\s+area|area|region|window|full\s*screen|screen)\s+)?(?:screen\s*shot|screenshot|screen)|(?:see|view|show|display)\s+(?:my\s+)?screen|what(?:'s| is)\s+on\s+my\s+screen|screen state|desktop state|(?:open|show|launch)\s+(?:the\s+)?screenshot\s+(?:toolbar|tool|app))\b/i;
const A11Y_TREE_RE = /\b(accessibility tree|a11y tree|ui tree|interface tree|ui elements?|screen elements?|clickable elements?|buttons?|controls?)\b/i;
const A11Y_APP_RE = /\b(?:for|in|inside)\s+([A-Za-z0-9 .\-_()]{2,80})(?:\s+(?:app|application|window))?\s*[.!?]?$/i;
const SHORTCUTS_LIST_RE = /\b(?:list|show|what|which)\b[\s\S]{0,80}\b(?:apple\s+|macos\s+|mac\s+)?shortcuts?\b/i;
const SHORTCUT_RUN_RE = /^\s*(?:please\s+)?(?:confirm\s+)?(?:run|start|trigger|execute)\s+(?:the\s+)?(?:(?:apple|macos|mac)\s+)?shortcut\s+(.+?)\s*[.!?]?\s*$/i;
const FILE_LIST_RE = /^\s*(?:please\s+)?(?:list|show)\s+(?:the\s+)?(?:files?|folders?|contents|items)\s+(?:in|inside|at|under)\s+(.+?)\s*[.!?]?\s*$/i;
const FILE_READ_RE = /^\s*(?:please\s+)?(?:read|show|preview|inspect|summari[sz]e)\s+(?:the\s+)?(?:file\s+)?(.+?)\s*[.!?]?\s*$/i;
const FILE_SEARCH_IN_FOR_RE = /^\s*(?:please\s+)?(?:search|find|locate)\s+(?:files?|folders?)?\s*(?:in|inside|under)\s+(.+?)\s+(?:for|matching|named|containing)\s+(.+?)\s*[.!?]?\s*$/i;
const FILE_SEARCH_FOR_IN_RE = /^\s*(?:please\s+)?(?:search|find|locate)\s+(?:files?|folders?)?\s*(?:for\s+)?(.+?)\s+(?:in|inside|under)\s+(.+?)\s*[.!?]?\s*$/i;
const FILE_SEARCH_FOR_ON_RE = /^\s*(?:(?:can|could)\s+you\s+)?(?:please\s+)?(?:search|find|locate|look\s+for)\s+(?:the\s+)?(?:file\s+|image\s+|photo\s+|picture\s+|document\s+)?(.+?)\s+(?:on|in|inside|under)\s+(?:my\s+)?(desktop|downloads?|documents?|pictures?|photos?|computer|mac|laptop|home folder|home directory|files?)\s*[.!?]?\s*$/i;
const FILE_FIND_AND_OPEN_RE = /^\s*(?:please\s+)?(?:find|locate|search\s+for)\s+(?:and\s+)?open\s+(?:the\s+)?(?:file\s+|image\s+|photo\s+|picture\s+|document\s+)?(.+?)\s+(?:on|in|inside|under)\s+(?:my\s+)?(.+?)\s*[.!?]?\s*$/i;
const GOOGLE_DRIVE_ROOT_RE = /^(?:google[_\s-]*drive|gdrive|my\s+drive)$/i;
const GOOGLE_DRIVE_FILE_SEARCH_RE = /^\s*(?:please\s+)?(?:search|find|locate|look\s+for)\s+(?:the\s+)?(?:file\s+|document\s+|layout\s+)?["'`]?([\s\S]{1,240}?)["'`]?\s+(?:in|inside|on|under)\s+(?:my\s+)?(?:google\s+drive|gdrive|my\s+drive)\s*[.!?]?\s*$/i;
const GOOGLE_DRIVE_INDESIGN_WORKFLOW_RE = /^\s*(?:please\s+)?(?:find|locate|search(?:\s+for)?|open|load)\s+(?:the\s+)?(?:indesign\s+)?(?:file\s+|document\s+|layout\s+)?["'`]?([\s\S]{1,240}?)["'`]?\s+(?:in|inside|on|under|from)\s+(?:my\s+)?(?:google\s+drive|gdrive|my\s+drive)\s+(?:(?:and|then)\s+)?(?:(?:open|load)\s+(?:it|the\s+file|the\s+document|the\s+layout)?\s+)?(?:in|inside|with|on)\s+(?:adobe\s+)?indesign(?:\s+\d{4})?(?:\s*(?:and|then|,)\s*([\s\S]{1,2000}))?\s*$/i;
const PHOTOSHOP_FILE_SEARCH_WORKFLOW_RE = /^\s*(?:please\s+)?(?:open|find|locate|search(?:\s+for)?|look\s+for)\s+(?:the\s+)?(?:file|image|photo|picture|document)?\s*["'`]?([\s\S]{1,260}?)["'`]?\s+(?:(?:that(?:['\u2019]s| is|s)?|which(?:['\u2019]s| is)?|located)\s+)?(?:on|in|inside|under|from)\s+(?:my\s+)?(?:the\s+)?(desktop|downloads?|documents?|pictures?|photos?|computer|mac|laptop|home folder|home directory|files?)\b[\s\S]*\b(?:in|inside|with|using)\s+(?:adobe\s+)?photoshop\b/i;
const PHOTOSHOP_FILE_WORKFLOW_RENAME_RE = /\brename\s+(?:it|this|that|the\s+(?:file|image|photo|picture|document))?\s*(?:to|as)?\s*["'`]?([^"'`\n\r]{1,120}?)(?=\s+(?:and|then|,)\s*(?:save|export)|\s*$)/i;
const PHOTOSHOP_FILE_WORKFLOW_SAVE_NAMED_FILE_RE = /\b(?:save|export)\s+(?:it|this|that|the\s+(?:file|image|photo|picture|document))?\s+(?:as|to)\s+["'`]?([^"'`\n\r]{1,240}\.(?:png|jpg|jpeg))["'`]?/i;
const PHOTOSHOP_FILE_WORKFLOW_SAVE_FORMAT_RE = /\b(?:save|export)\s+(?:it|this|that|the\s+(?:file|image|photo|picture|document))?\s+(?:as|to)\s+(?:a\s+|an\s+)?(png|jpe?g)\b/i;
const FILE_STAT_RE = /\b(exists?|metadata|info|details|size|modified|created|stat)\b(?=[\s\S]{0,180}\b(file|folder|image|photo|picture|document|desktop|downloads?|documents?)\b)|\b(file|folder|image|photo|picture|document)\b(?=[\s\S]{0,180}\b(exists?|metadata|info|details|size|modified|created|stat)\b)/i;
const FILE_RENAME_RE = /\b(rename|change)\b(?=[\s\S]{0,220}\b(to|as)\b)(?=[\s\S]{0,220}\b(file|folder|image|photo|picture|document|desktop|downloads?|documents?)\b)/i;
const FILE_COPY_RE = /\b(copy|duplicate|make a copy)\b(?=[\s\S]{0,220}\b(to|as)\b)(?=[\s\S]{0,220}\b(file|folder|image|photo|picture|document|desktop|downloads?|documents?)\b)/i;
const FILE_TRASH_RE = /\b(delete|remove|trash)\b(?=[\s\S]{0,220}\b(file|folder|image|photo|picture|document|desktop|downloads?|documents?)\b)|\bmove\b(?=[\s\S]{0,220}\btrash\b)(?=[\s\S]{0,220}\b(file|folder|image|photo|picture|document|desktop|downloads?|documents?)\b)/i;
const FILE_MKDIR_RE = /\b(create|make|new)\b[\s\S]{0,80}\b(folder|directory)\b/i;
const FILE_WRITE_TEXT_RE = /\b(write|save|create|make|append)\b[\s\S]{0,120}\b(file|text file|note|notes|txt|markdown|md)\b/i;
const MOUSE_DRAG_RE = /^\s*(?:please\s+)?drag(?:\s+(?:the\s+)?(?:mouse|cursor))?\s+(?:from\s+)?(\d{1,5})\s*,\s*(\d{1,5})\s+(?:to|into|onto)\s+(\d{1,5})\s*,\s*(\d{1,5})\s*[.!?]?\s*$/i;
const MOUSE_MOVE_RE = /^\s*(?:please\s+)?(?:move|hover|position)\s+(?:the\s+)?(?:mouse|cursor)(?:\s+(?:to|at|over))?\s+(\d{1,5})\s*,\s*(\d{1,5})\s*[.!?]?\s*$/i;
const MOUSE_CLICK_RE = /^\s*(?:please\s+)?(?:(right|left)\s+)?(?:(double|single)\s+)?click(?:\s+(?:the\s+)?(?:mouse|cursor))?(?:\s+(?:at|on))?\s+(\d{1,5})\s*,\s*(\d{1,5})\s*[.!?]?\s*$/i;
const MOUSE_DOWN_RE = /^\s*(?:please\s+)?(?:(right|left)\s+)?(?:mouse\s+down|hold(?:\s+(?:the\s+)?(?:mouse|cursor))?(?:\s+down)?)(?:\s+(?:at|on))?\s+(\d{1,5})\s*,\s*(\d{1,5})\s*[.!?]?\s*$/i;
const MOUSE_UP_RE = /^\s*(?:please\s+)?(?:(right|left)\s+)?(?:mouse\s+up|release(?:\s+(?:the\s+)?(?:mouse|cursor))?)(?:(?:\s+(?:at|on))?\s+(\d{1,5})\s*,\s*(\d{1,5}))?\s*[.!?]?\s*$/i;
const MOUSE_SCROLL_RE = /^\s*(?:please\s+)?scroll\s+(up|down|left|right)(?:\s+(?:by\s+)?(\d{1,5}))?(?:\s+(?:at|on)\s+(\d{1,5})\s*,\s*(\d{1,5}))?\s*[.!?]?\s*$/i;
const DURATION_AMOUNT_PATTERN = String.raw`(?:\d{1,4}(?:\.\d{1,2})?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|a|an|half)`;
const TYPE_TEXT_IN_APP_RE = /^\s*(?:please\s+)?(?:type|enter)\s+([\s\S]{1,4000}?)\s+(?:in|into|on)\s+(.+?)(?:\s+(?:app|application|window))?\s*[.!?]?\s*$/i;
const TYPE_TEXT_FRONTMOST_RE = /^\s*(?:please\s+)?(?:type|enter)\s+([\s\S]{1,4000}?)\s+(?:in|into|on)\s+(?:the\s+)?(?:current|active|frontmost)\s+(?:app|application|window|field|text\s*box|textbox)\s*[.!?]?\s*$/i;
const PASTE_TEXT_IN_APP_RE = /^\s*(?:please\s+)?paste\s+([\s\S]{1,20000}?)\s+(?:in|into|on)\s+(.+?)(?:\s+(?:app|application|window))?\s*[.!?]?\s*$/i;
const PASTE_TEXT_FRONTMOST_RE = /^\s*(?:please\s+)?paste\s+([\s\S]{1,20000}?)\s+(?:in|into|on)\s+(?:the\s+)?(?:current|active|frontmost)\s+(?:app|application|window|field|text\s*box|textbox)\s*[.!?]?\s*$/i;
const SET_FIELD_TEXT_IN_APP_RE = /^\s*(?:please\s+)?(?:fill|set|change|update|put|enter|type|paste)\s+(?:the\s+)?(.+?)(?:\s+(?:field|text\s*field|text\s*box|textbox|input|box))?\s+(?:to|as|with)\s+([\s\S]{1,20000}?)\s+(?:in|inside|on)\s+(.+?)(?:\s+(?:app|application|window))?\s*[.!?]?\s*$/i;
const SET_FIELD_TEXT_FRONTMOST_RE = /^\s*(?:please\s+)?(?:fill|set|change|update|put|enter|type|paste)\s+(?:the\s+)?(.+?)(?:\s+(?:field|text\s*field|text\s*box|textbox|input|box))?\s+(?:to|as|with)\s+([\s\S]{1,20000}?)\s+(?:in|inside|on)\s+(?:the\s+)?(?:current|active|frontmost)\s+(?:app|application|window)\s*[.!?]?\s*$/i;
const BARE_SET_FIELD_TEXT_RE = /^\s*(?:please\s+)?(?:fill|set|change|update|put|enter|type|paste)\s+(?:the\s+)?(.+?)(?:\s+(?:field|text\s*field|text\s*box|textbox|input|box))?\s+(?:to|as|with)\s+([\s\S]{1,20000}?)\s*[.!?]?\s*$/i;
const BARE_TYPE_RE = /^\s*(?:please\s+)?(?:type|enter)\s+([\s\S]{1,4000}?)\s*[.!?]?\s*$/i;
const BARE_PASTE_RE = /^\s*(?:please\s+)?paste\s+([\s\S]{1,20000}?)\s*[.!?]?\s*$/i;
const BARE_FIND_TEXT_RE = /^\s*(?:please\s+)?(?:find|search)(?:\s+for)?\s+([\s\S]{1,2000}?)\s*[.!?]?\s*$/i;
const BARE_BROWSER_SEARCH_RE = /^\s*(?:please\s+)?(?:search|google)\s+(?:(?:the\s+)?(?:web|internet|google)\s+)?(?:for\s+)?([\s\S]{1,2000}?)\s*[.!?]?\s*$/i;
const BARE_REPLACE_ALL_TEXT_RE = /^\s*(?:please\s+)?(?:replace|overwrite)(?:\s+(?:all|the|current)\s+(?:text|content|contents|document|field|selection|selected\s+text))?\s+(?:with|to)\s+([\s\S]{1,20000}?)\s*[.!?]?\s*$/i;
const BARE_CLEAR_TEXT_RE = /^\s*(?:please\s+)?(?:clear|empty|erase)\s+(?:the\s+)?(?:text|content|contents|document|field|current\s+field|selection|selected\s+text)\s*[.!?]?\s*$/i;
const BARE_SAVE_AS_NAMED_FILE_RE = /^\s*(?:please\s+)?(?:save)(?:\s+(?:it|this|the\s+)?(?:current\s+)?(?:image|photo|picture|document|file|project|work))?\s+as\s+["'`]?([^"'`\n\r]{1,240}\.[a-z0-9]{1,12})["'`]?\s*[.!?]?\s*$/i;
const PHOTOSHOP_SAVE_FOR_WEB_FILE_RE = /^\s*(?:please\s+)?(?:save|export)(?:(?:\s+(?:the\s+)?(?:image|photo|picture|file|document))?)\s+(?:for\s+web|web\s+optimized|optimized\s+for\s+web)(?:\s+(?:as|to)\s+["'`]?([^"'`\n\r]{1,240}\.[a-z0-9]{1,12})["'`]?)?\s*[.!?]?\s*$/i;
const PHOTOSHOP_EXPORT_AS_FILE_RE = /^\s*(?:please\s+)?(?:export)(?:\s+(?:the\s+)?(?:image|photo|picture|file|document))?\s+(?:as|to)\s+["'`]?([^"'`\n\r]{1,240}\.(?:png|jpg|jpeg|gif|webp|tif|tiff|psd|pdf))["'`]?\s*[.!?]?\s*$/i;
const PHOTOSHOP_EXPORT_PROOF_RE = /^\s*(?:please\s+)?(?:export|make|create|save)\s+(?:a\s+)?(?:photoshop\s+)?(?:raster\s+)?(?:proof|preview|proof\s+image|review\s+image)\s+(?:as|to)\s+["'`]?([^"'`\n\r]{1,240}\.(?:png|jpg|jpeg))["'`]?\s*[.!?]?\s*$/i;
const PHOTOSHOP_RESIZE_IMAGE_RE = /^\s*(?:please\s+)?(?:(?:resize|change|set)\s+(?:the\s+)?(?:image|photo|picture|document|file)\s+(?:size\s+)?(?:to|as)|(?:image\s+size)\s+(?:to|as))\s+(\d{2,5})\s*(?:x|by)\s*(\d{2,5})(?:\s*(?:px|pixels?))?\s*[.!?]?\s*$/i;
const PHOTOSHOP_CANVAS_SIZE_RE = /^\s*(?:please\s+)?(?:(?:resize|change|set)\s+(?:the\s+)?canvas\s+(?:size\s+)?(?:to|as)|(?:canvas\s+size)\s+(?:to|as))\s+(\d{2,5})\s*(?:x|by)\s*(\d{2,5})(?:\s*(?:px|pixels?))?\s*[.!?]?\s*$/i;
const PHOTOSHOP_RESOLUTION_RE = /^\s*(?:please\s+)?(?:set|change|make|convert)\s+(?:the\s+)?(?:image\s+)?resolution\s+(?:to|as)\s+(\d{2,4})(?:\s*(?:dpi|ppi))?\s*[.!?]?\s*$/i;
const PHOTOSHOP_DOCUMENT_STATUS_RE = /\b(?:photoshop|psd|image document)\b(?=[\s\S]{0,140}\b(?:status|state|preflight|inspect|audit|dimensions?|resolution|color mode|document info)\b)|\b(?:status|state|preflight|inspect|audit|dimensions?|resolution|color mode|document info)\b(?=[\s\S]{0,140}\b(?:photoshop|psd|image document)\b)/i;
const PHOTOSHOP_LAYER_INVENTORY_RE = /\b(?:photoshop|psd)\b(?=[\s\S]{0,160}\b(?:layers?|layer inventory|text layers?|type layers?|smart objects?|masks?|adjustment layers?)\b)|\b(?:layers?|layer inventory|text layers?|type layers?|smart objects?|masks?|adjustment layers?)\b(?=[\s\S]{0,160}\b(?:photoshop|psd)\b)/i;
const PHOTOSHOP_LAYER_ACTION_RE = /^\s*(?:please\s+)?(show|hide|lock|unlock)\s+(?:the\s+)?(?:photoshop\s+)?layer\s+["'`]?([^"'`\n\r]{1,120})["'`]?(?:\s+(?:in|inside|on)\s+(?:adobe\s+)?photoshop)?\s*[.!?]?\s*$/i;
const PHOTOSHOP_TEXT_LAYER_UPDATE_RE = /^\s*(?:please\s+)?(?:set|change|update|replace)\s+(?:the\s+)?(?:photoshop\s+)?(?:(?:text|type)\s+)?layer\s+["'`]?([^"'`\n\r]{1,160})["'`]?\s+(?:text\s+)?(?:to|as|with)\s+["'`]?([\s\S]{1,5000}?)["'`]?(?:\s+(?:in|inside|on)\s+(?:adobe\s+)?photoshop)?\s*[.!?]?\s*$/i;
const PHOTOSHOP_NAMED_TEXT_UPDATE_RE = /^\s*(?:please\s+)?(?:set|change|update|replace)\s+(?:the\s+)?(?:photoshop\s+)?(headline|title|subheadline|body(?:\s+copy)?|copy|cta|button|offer|price|legal|disclaimer|caption|tagline)(?:\s+text)?\s+(?:to|as|with)\s+["'`]?([\s\S]{1,5000}?)["'`]?(?:\s+(?:in|inside|on)\s+(?:adobe\s+)?photoshop)?\s*[.!?]?\s*$/i;
const PHOTOSHOP_GENERATIVE_FILL_RE = /^\s*(?:please\s+)?(?:(?:use|run|open|start|apply)\s+)?(?:photoshop\s+)?(?:generative\s+fill|firefly\s+fill|ai\s+fill)(?:\s+(?:to|with|using|for|and)\s+([\s\S]{1,2000}?))?\s*[.!?]?\s*$/i;
const PHOTOSHOP_GENERATIVE_FILL_NATURAL_RE = /^\s*(?:please\s+)?(?:add|insert|replace|modify|change|remove|erase|delete)\s+([\s\S]{1,2000}?)\s+(?:with|using|via)\s+(?:photoshop\s+)?(?:generative\s+fill|firefly\s+fill|ai\s+fill)\s*[.!?]?\s*$/i;
const PHOTOSHOP_SELECTED_AREA_GENERATIVE_FILL_RE = /^\s*(?:please\s+)?(?:(?:generative\s+fill|firefly\s+fill|ai\s+fill|fill|replace|change|transform|turn)\s+(?:the\s+)?(?:selected|highlighted|masked|current)\s+(?:area|region|section|selection|part|piece)(?:\s+(?:with|to|into|as|using|for)\s+([\s\S]{1,2000}?))?|(?:fill|replace|change|transform|turn)\s+(?:it|that|this|the\s+selection|the\s+selected\s+area|the\s+highlighted\s+area)\s+(?:with|to|into|as)\s+([\s\S]{1,2000}?))\s*[.!?]?\s*$/i;
const PHOTOSHOP_REMOVE_SELECTED_AREA_RE = /^\s*(?:please\s+)?(?:remove|erase|delete|clear|clean\s+up)\s+(?:the\s+)?(?:selected|highlighted|masked|current)\s+(?:area|region|section|selection|object|item|distraction|part|piece)(?:\s+(?:with|using|via)\s+(?:photoshop\s+)?(?:ai|generative\s+fill|firefly\s+fill|firefly))?\s*[.!?]?\s*$/i;
const PHOTOSHOP_SHORT_SELECTION_FILL_RE = /^\s*(?:please\s+)?(?:fill|replace|change|transform|turn)(?:\s+(?:it|that|this|the\s+selection|selected\s+area|highlighted\s+area|current\s+selection|area|section|region))?\s+(?:with|to|into|as)\s+([\s\S]{1,2000}?)\s*[.!?]?\s*$/i;
const PHOTOSHOP_REFERENCE_CUE_RE = /\b(?:selected|selection|highlighted|highlight|masked|mask|brushed|brush|painted|marked|circled|circle|lassoed|lasso|marquee|current\s+(?:area|selection)|where\s+(?:i|we)\s+(?:selected|highlighted|brushed|painted|marked|circled|lassoed|drew)|(?:this|that)\s+(?:area|spot|part|section|region|thing|object)|(?:the\s+)?(?:area|spot|part|section|region|thing|object)\s+(?:i|we)\s+(?:selected|highlighted|brushed|painted|marked|circled|lassoed))\b/i;
const PHOTOSHOP_GENERATIVE_FILL_CONTEXT_RE = /\b(?:generative\s+fill|gen\s*fill|firefly(?:\s+fill)?|ai\s+fill|photoshop\s+ai|inpaint|inpainting)\b/i;
const PHOTOSHOP_GENERATIVE_FILL_ACTION_RE = /\b(?:fill|replace|change|turn|transform|add|insert|put|place|generate|create|make|remove|erase|delete|clean\s+up|get\s+rid\s+of|take\s+out)\b/i;
const PHOTOSHOP_GENERATE_IMAGE_RE = /^\s*(?:please\s+)?(?:photoshop\s+)?(?:generate|create|make)\s+(?:a\s+|an\s+)?(?:new\s+)?(?:ai\s+)?image(?:\s+(?:of|showing|with|from|from\s+prompt))?\s+([\s\S]{1,2000}?)\s*[.!?]?\s*$/i;
const PHOTOSHOP_GENERATIVE_EXPAND_RE = /^\s*(?:please\s+)?(?:(?:use|run|open|start|apply)\s+)?(?:photoshop\s+)?(?:generative\s+expand|ai\s+expand|expand\s+(?:the\s+)?(?:canvas|background|image)\s+(?:with|using)\s+(?:ai|generative\s+ai))(?:\s+(?:to|with|using|for|and)\s+([\s\S]{1,2000}?))?\s*[.!?]?\s*$/i;
const PHOTOSHOP_AI_EDIT_IMAGE_RE = /^\s*(?:please\s+)?(?:ai\s+edit(?:\s+(?:the\s+)?(?:image|photo|picture))?|edit\s+(?:the\s+)?(?:image|photo|picture)\s+with\s+ai|use\s+photoshop\s+ai\s+to\s+(?:edit|change|modify)(?:\s+(?:the\s+)?(?:image|photo|picture))?)\s+(?:to|and|with)?\s*([\s\S]{1,2000}?)\s*[.!?]?\s*$/i;
const PHOTOSHOP_REPLACE_BACKGROUND_RE = /^\s*(?:please\s+)?(?:replace|change|swap|make)\s+(?:the\s+)?background(?:\s+(?:to|with|into|as))?\s+([\s\S]{1,2000}?)\s*(?:using\s+(?:photoshop\s+)?ai|with\s+(?:photoshop\s+)?ai|via\s+generative\s+fill)?\s*[.!?]?\s*$/i;
const PHOTOSHOP_REMOVE_OBJECT_AI_RE = /^\s*(?:please\s+)?(?:remove|erase|delete)\s+(?:(?:the\s+)?(?:selected\s+)?(?:object|person|item|distraction|thing|selection|area)|([\s\S]{1,300}?))\s+(?:with|using|via)\s+(?:photoshop\s+)?(?:ai|generative\s+fill|firefly)\s*[.!?]?\s*$/i;
const PHOTOSHOP_SOCIAL_CANVAS_RE = /^\s*(?:please\s+)?(?:create|make|start|open)\s+(?:a\s+)?(?:new\s+)?(?:photoshop\s+)?(instagram\s+post|instagram\s+square|instagram\s+story|facebook\s+ad|linkedin\s+post|youtube\s+thumbnail|web\s+hero|website\s+hero|desktop\s+wallpaper|poster|flyer|letter\s+flyer)(?:\s+(?:canvas|document|design|layout))?(?:\s+(?:with|for|about)\s+([\s\S]{1,1000}?))?\s*[.!?]?\s*$/i;
const PHOTOSHOP_STYLE_TRANSFER_RE = /^\s*(?:please\s+)?(?:apply|use|run)\s+(?:a\s+)?(?:style\s+transfer|neural\s+style|ai\s+style)(?:\s+(?:to|with|using|like|as)\s+([\s\S]{1,500}?))?\s*[.!?]?\s*$/i;
const PHOTOSHOP_SMART_PORTRAIT_RE = /^\s*(?:please\s+)?(?:open|use|run|apply)\s+(?:the\s+)?(?:smart\s+portrait|skin\s+smoothing|portrait\s+neural\s+filter|colorize|depth\s+blur)(?:\s+(?:neural\s+filter|filter))?\s*[.!?]?\s*$/i;
const PHOTOSHOP_SELECTION_BRUSH_PREP_RE = /^\s*(?:please\s+)?(?:open|use|select|switch\s+to|choose)\s+(?:the\s+)?(?:selection\s+brush|selection\s+brush\s+tool|brush\s+selection)\s*(?:tool)?(?:\s+(?:for|before|to\s+prep(?:are)?\s+for|to\s+highlight\s+(?:an?\s+)?(?:area|section|region)\s+for)\s+(?:generative\s+fill|firefly\s+fill|ai\s+fill))?\s*[.!?]?\s*$/i;
const PHOTOSHOP_SELECTION_BRUSH_DRAG_RE = /^\s*(?:please\s+)?(?:use|with|select|highlight|paint|brush|mark)\s+(?:the\s+)?(?:selection\s+brush|selection\s+brush\s+tool|brush\s+selection)(?:\s+(?:to|and))?\s*(?:select|highlight|paint|brush|mark)?\s*(?:a\s+)?(?:selection|area|region|section|stroke)?\s*(?:from|between)?\s+(\d{1,5})\s*,\s*(\d{1,5})\s+(?:to|and)\s+(\d{1,5})\s*,\s*(\d{1,5})(?:\s+(?:in|inside|on)\s+(?:adobe\s+)?photoshop)?\s*[.!?]?\s*$/i;
const PHOTOSHOP_SELECTION_BRUSH_GENERATIVE_FILL_RE = /^\s*(?:please\s+)?(?:use|with|select|highlight|paint|brush|mark)\s+(?:the\s+)?(?:selection\s+brush|selection\s+brush\s+tool|brush\s+selection)(?:\s+(?:to|and))?\s*(?:select|highlight|paint|brush|mark)?\s*(?:a\s+)?(?:selection|area|region|section|stroke)?\s*(?:from|between)?\s+(\d{1,5})\s*,\s*(\d{1,5})\s+(?:to|and)\s+(\d{1,5})\s*,\s*(\d{1,5})\s+(?:and|then)?\s*(?:generative\s+fill|firefly\s+fill|ai\s+fill|fill|replace|remove|erase|delete)(?:\s+(?:it|that|this|the\s+selection|selected\s+area|highlighted\s+area))?(?:\s+(?:with|to|into|as|using|for)\s+([\s\S]{1,2000}?))?\s*[.!?]?\s*$/i;
const PHOTOSHOP_RECTANGLE_SELECT_RE = /^\s*(?:please\s+)?(?:select|highlight|mark|draw|make)\s+(?:a\s+)?(?:(?:rectangular|rectangle|box|marquee)\s+)?(?:selection|area|region|section|box|rectangle)?\s*(?:from|between)?\s+(\d{1,5})\s*,\s*(\d{1,5})\s+(?:to|and)\s+(\d{1,5})\s*,\s*(\d{1,5})(?:\s+(?:in|inside|on)\s+(?:adobe\s+)?photoshop)?\s*[.!?]?\s*$/i;
const PHOTOSHOP_RECTANGLE_GENERATIVE_FILL_RE = /^\s*(?:please\s+)?(?:select|highlight|mark|draw|make)\s+(?:a\s+)?(?:(?:rectangular|rectangle|box|marquee)\s+)?(?:selection|area|region|section|box|rectangle)?\s*(?:from|between)?\s+(\d{1,5})\s*,\s*(\d{1,5})\s+(?:to|and)\s+(\d{1,5})\s*,\s*(\d{1,5})\s+(?:and\s+)?(?:generative\s+fill|firefly\s+fill|ai\s+fill|fill|replace|remove|erase|delete)(?:\s+(?:it|that|this|the\s+selection|selected\s+area|highlighted\s+area))?(?:\s+(?:with|to|into|as|using|for)\s+([\s\S]{1,2000}?))?\s*[.!?]?\s*$/i;
const FILE_DIALOG_PATH_PATTERN = String.raw`(?:"([^"\n\r]{1,500})"|'([^'\n\r]{1,500})'|((?:~\/|\/|\.\/|\.\.\/)[^\n\r]{1,500}|[^\s"'` + '`' + String.raw`\n\r]{1,240}\.[a-z0-9]{1,12}))`;
const INDESIGN_DOCUMENT_FILE_RE = /(?:"([^"\n\r]{1,500}\.indd)"|'([^'\n\r]{1,500}\.indd)'|((?:~\/|\/|\.\/|\.\.\/)[^"'\n\r]{1,500}\.indd)|\b([A-Za-z0-9][A-Za-z0-9._()@+#-]{0,180}\.indd)\b)/i;
const PHOTOSHOP_OPEN_FILE_RE = new RegExp(String.raw`^\s*(?:please\s+)?(?:open|load)\s+(?:(?:the\s+)?(?:file|image|photo|picture|asset)\s+)?${FILE_DIALOG_PATH_PATTERN}(?:\s+(?:in|inside|on)\s+(?:adobe\s+)?photoshop)?\s*[.!?]?\s*$`, 'i');
const PHOTOSHOP_PLACE_FILE_RE = new RegExp(String.raw`^\s*(?:please\s+)?(?:place|import|insert|add)\s+(?:(?:the\s+)?(?:file|image|photo|picture|graphic|asset)\s+)?${FILE_DIALOG_PATH_PATTERN}(?:\s+(?:as\s+)?(?:embedded|linked|smart\s+object|layer))?(?:\s+(?:in|inside|on)\s+(?:adobe\s+)?photoshop)?\s*[.!?]?\s*$`, 'i');
const INDESIGN_PLACE_FILE_RE = new RegExp(String.raw`^\s*(?:please\s+)?(?:place|import|insert|add)\s+(?:(?:the\s+)?(?:file|image|photo|graphic|asset)\s+)?${FILE_DIALOG_PATH_PATTERN}(?:\s+(?:into|in|inside|on)\s+(?:the\s+)?(?:selected\s+)?(?:frame|document|layout|indesign))?\s*[.!?]?\s*$`, 'i');
const INDESIGN_EXPORT_FILE_RE = /^\s*(?:please\s+)?(?:export|save)\s+(?:(?:the\s+)?(?:document|layout|file|indesign\s+file)\s+)?(?:as|to)\s+["'`]?([^"'`\n\r]{1,240}\.(?:pdf|epub|html|idml|jpg|jpeg|png))["'`]?\s*[.!?]?\s*$/i;
const INDESIGN_INSERT_PAGES_RE = /^\s*(?:please\s+)?(?:insert|add|create|make)\s+(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten)?\s*(?:new\s+)?pages?\s*[.!?]?\s*$/i;
const INDESIGN_FIND_CHANGE_RE = /^\s*(?:please\s+)?(?:open|show|use|run)?\s*(?:find\s*\/?\s*change|find\s+and\s+change|find\s+replace|find\s+and\s+replace)\s*[.!?]?\s*$/i;
const INDESIGN_SIMPLE_FIND_CHANGE_RE = /^\s*(?:please\s+)?(?:(?:find\s+["'`]?([^"'`\n\r]{1,160})["'`]?\s+(?:and\s+)?(?:replace|change)\s+(?:it\s+)?(?:to|with|into|as)\s+["'`]?([^"'`\n\r]{1,240})["'`]?)|(?:(?:change|replace)\s+["'`]?([^"'`\n\r]{1,160})["'`]?\s+(?:to|with|into|as)\s+["'`]?([^"'`\n\r]{1,240})["'`]?))(?:\s+(?:in|inside|on)\s+(?:adobe\s+)?indesign)?\s*[.!?]?\s*$/i;
const INDESIGN_DOCUMENT_STATUS_RE = /^\s*(?:please\s+)?(?:(?:check|inspect|audit|review|show|list|tell\s+me|what(?:'s| is)|which|are|is)\b[\s\S]{0,160})?\b(?:adobe\s+)?indesign\b[\s\S]{0,220}\b(?:status|state|info|summary|preflight|links?|fonts?|issues?|problems?|active\s+document|open\s+documents?|file\s+is\s+open|document\s+is\s+open|missing|modified)\b/i;
const INDESIGN_TEXT_INVENTORY_RE = /^\s*(?:please\s+)?(?:(?:show|list|inspect|map|find|scan|inventory|audit|tell\s+me)\b[\s\S]{0,160})?\b(?:adobe\s+)?indesign\b[\s\S]{0,220}\b(?:text\s+frames?|copy\s+fields?|text\s+layers?|editable\s+text|named\s+frames?|layer\s+names?|banner\s+fields?|field\s+names?)\b/i;
const INDESIGN_FIT_FRAME_RE = /^\s*(?:please\s+)?(?:fit|fill|center)\s+(?:the\s+)?(?:selected\s+)?(?:image|graphic|content|frame|object)(?:\s+(proportionally|to\s+frame|to\s+content|frame\s+to\s+content|content\s+proportionally|frame\s+proportionally|center))?\s*[.!?]?\s*$/i;
const INDESIGN_GO_TO_PAGE_RE = /^\s*(?:please\s+)?(?:go\s+to|jump\s+to|open|show)\s+(?:page\s+)?(\d{1,5})\s*(?:in\s+(?:adobe\s+)?indesign)?\s*[.!?]?\s*$/i;
const INDESIGN_EXPORT_PRESET_RE = /^\s*(?:please\s+)?(?:export|make|create)\s+(?:a\s+)?(?:(print|press|high\s+quality|interactive|web|smallest\s+file)\s+)?pdf(?:\s+(?:as|to)\s+["'`]?([^"'`\n\r]{1,240}\.pdf)["'`]?)?\s*[.!?]?\s*$/i;
const INDESIGN_TEXT_TO_IMAGE_RE = /^\s*(?:please\s+)?(?:(?:use|open|run)\s+)?(?:indesign\s+)?(?:text\s+to\s+image|generate\s+(?:an?\s+)?image|make\s+(?:an?\s+)?image|create\s+(?:an?\s+)?image)(?:\s+(?:of|for|with|from|showing|from\s+prompt))?\s+([\s\S]{1,2000}?)\s*[.!?]?\s*$/i;
const INDESIGN_GENERATIVE_EXPAND_RE = /^\s*(?:please\s+)?(?:(?:use|run|apply|open)\s+)?(?:indesign\s+)?(?:generative\s+expand|ai\s+expand|expand\s+(?:the\s+)?(?:image|photo|picture|graphic|frame)\s+(?:with|using)\s+(?:ai|generative\s+ai))(?:\s+(?:(?:the\s+)?(?:selected\s+)?(?:image|photo|picture|graphic|frame))?)?(?:\s+(?:to|with|using|for|and)\s+([\s\S]{1,2000}?))?\s*[.!?]?\s*$/i;
const INDESIGN_GENERATIVE_FILL_RE = /^\s*(?:please\s+)?(?:(?:use|run|apply|open)\s+)?(?:indesign\s+)?(?:generative\s+fill|firefly\s+fill|ai\s+fill)(?:\s+(?:to|with|using|for|and)\s+([\s\S]{1,2000}?))?\s*[.!?]?\s*$/i;
const INDESIGN_GENERATE_ALT_TEXT_RE = /^\s*(?:please\s+)?(?:generate|write|create)\s+(?:ai\s+)?alt\s+text(?:\s+(?:for|on)\s+(?:the\s+)?(?:selected\s+)?(?:image|graphic|frame|object))?\s*[.!?]?\s*$/i;
const INDESIGN_BROCHURE_LAYOUT_RE = /^\s*(?:please\s+)?(?:create|make|start|set\s+up)\s+(?:a\s+)?(?:(?:tri-?fold|three\s+panel)(?:\s+brochure)?|brochure|flyer|one\s+sheet|newsletter|magazine\s+spread)(?:\s+(?:layout|document|template))?(?:\s+(?:in|with)\s+indesign)?\s*[.!?]?\s*$/i;
const INDESIGN_ACCESSIBLE_EXPORT_PREP_RE = /^\s*(?:please\s+)?(?:prepare|prep|check|make)\s+(?:the\s+)?(?:indesign\s+)?(?:document|layout|file)?\s*(?:for\s+)?(?:accessible\s+pdf|accessibility|accessible\s+export)\s*[.!?]?\s*$/i;
const INDESIGN_BANNER_WORKSPACE_RE = /^\s*(?:please\s+)?(?:open|show|prep|prepare|set\s+up|setup|start|build)\s+(?:the\s+)?(?:indesign\s+)?(?:(?:banner|ad|creative|campaign|display\s+ad)\s+)?(?:workflow|workspace|production\s+workspace|banner\s+workspace|layer\s+workflow|variant\s+workflow|automation\s+board)(?:\s+(?:for|in)\s+(?:banners?|ads?|creatives?|campaigns?))?\s*[.!?]?\s*$/i;
const INDESIGN_OBJECT_LAYER_OPTIONS_RE = /^\s*(?:please\s+)?(?:open|show|edit|change|use)\s+(?:the\s+)?(?:(?:object|placed|linked|photoshop|psd|pdf|illustrator|ai)\s+)?(?:object\s+)?layer\s+options(?:\s+(?:for|on)\s+(?:the\s+)?(?:selected|placed|linked)?\s*(?:object|graphic|image|asset|psd|file)?)?\s*[.!?]?\s*$/i;
const INDESIGN_PLACED_LAYER_VARIANT_RE = /^\s*(?:please\s+)?(?:show|hide|swap|change|switch|toggle|use)\s+(?:the\s+)?(?:(?:placed|linked|photoshop|psd|pdf|illustrator|ai)\s+)?(?:(?:asset|image|graphic)\s+)?(?:layer|layer\s+comp|variant)\s+(?:to|as|for)?\s*["'`]?([^"'`\n\r]{1,160}?)["'`]?(?:\s+(?:in|on)\s+(?:indesign|the\s+selected\s+(?:graphic|image|asset|object)))?\s*[.!?]?\s*$/i;
const INDESIGN_BANNER_TEXT_RE = /^\s*(?:please\s+)?(?:set|change|update|replace)\s+(?:the\s+)?(?:(?:selected|current)\s+)?(?:banner\s+|ad\s+|creative\s+)?(headline|title|body(?:\s+copy)?|copy|cta|button|offer|price|legal|disclaimer)(?:\s+text)?\s+(?:to|as|with)\s+["'`]?([\s\S]{1,1000}?)["'`]?\s*[.!?]?\s*$/i;
const INDESIGN_DEALER_BANNER_TEXT_RE = /^\s*(?:please\s+)?(?:set|change|update|replace|make)\s+(?:the\s+)?(?:(selected|current|active)\s+)?(?:(?:dealer|dealership|vehicle|car|auto|automotive|banner|ad|creative|offer)\s+)?(disclaimer(?:\s+copy)?|legal(?:\s+(?:copy|text))?|fine\s+print|terms(?:\s+and\s+conditions)?|lease(?:\s+terms?)?|finance(?:\s+apr)?|apr|rate|monthly\s+payment|payment|down\s+payment|cash\s+down|price|sale\s+price|msrp|vehicle\s+model|model|year|trim|stock(?:\s+(?:number|#))?|vin|cta|button|headline|subheadline|offer|rebate|incentive|expiration(?:\s+date)?|dealer(?:ship)?\s+name|phone(?:\s+number)?|url|website)(?:\s+(?:text|copy|value))?\s+(?:to|as|with)\s+["'`]?([\s\S]{1,1500}?)["'`]?\s*[.!?]?\s*$/i;
const INDESIGN_DEALER_FIND_REPLACE_RE = /^\s*(?:please\s+)?(?:(?:in|inside|on)\s+(?:adobe\s+)?indesign\s+)?(?:find\s+and\s+replace|find\/change|replace|change)\s+["'`]([^"'`\n\r]{1,300})["'`]\s+(?:to|with|into|as)\s+["'`]([^"'`\n\r]{1,500})["'`](?:\s+(?:in|inside|on)\s+(?:the\s+)?(?:disclaimer|legal|fine\s+print|banner|ad|creative|document|layout|indesign))?\s*[.!?]?\s*$/i;
const INDESIGN_DEALER_PRODUCTION_CHECK_RE = /^\s*(?:please\s+)?(?:prep|prepare|check|review|proof|audit)\s+(?:the\s+)?(?:(?:(?:dealer|dealership|vehicle|car|auto|automotive)\s+(?:banner|ad|creative|offer)(?:\s+(?:for|with)\s+(?:legal(?:\s+review)?|disclaimer|fine\s+print|offer|price|apr|lease|handoff|print|export|proof(?:ing)?))?)|(?:(?:banner|ad|creative|offer)\s+(?:for|with)\s+(?:legal(?:\s+review)?|disclaimer|fine\s+print|offer|price|apr|lease|handoff|print|export|proof(?:ing)?)))(?:\s+(?:workflow|production|setup|board))?\s*[.!?]?\s*$/i;
const INDESIGN_BANNER_ASSET_PLACE_RE = new RegExp(String.raw`^\s*(?:please\s+)?(?:replace|place|swap|update)\s+(?:the\s+)?(?:(?:selected|current)\s+)?(?:banner\s+|ad\s+|creative\s+)?(?:image|photo|graphic|logo|background|hero|asset)\s+(?:with|to|as|using)?\s*${FILE_DIALOG_PATH_PATTERN}(?:\s+(?:into|in|inside|on)\s+(?:the\s+)?(?:selected\s+)?(?:frame|banner|ad|creative|layout|indesign))?\s*[.!?]?\s*$`, 'i');
const INDESIGN_BANNER_EXPORT_RE = /^\s*(?:please\s+)?(?:export|save)\s+(?:the\s+)?(?:(?:selected|current)\s+)?(?:banner|ad|creative|layout|page|spread|object)\s+(?:as|to)\s+["'`]?([^"'`\n\r]{1,240}\.(?:pdf|jpg|jpeg|png))["'`]?\s*[.!?]?\s*$/i;
const INDESIGN_BANNER_DATA_MERGE_RE = /^\s*(?:please\s+)?(?:set\s+up|setup|prep|prepare|open|show|start|build)\s+(?:a\s+)?(?:(?:variable|versioned|personalized|batch|data\s+merge)\s+)?(?:banners?|ads?|creatives?|campaigns?)(?:\s+(?:with|using|from)\s+data\s+merge|\s+data\s+merge)?(?:\s+(?:workflow|layout|production|automation|variants?))?\s*[.!?]?\s*$/i;
const INDESIGN_BANNER_ALTERNATE_LAYOUT_RE = /^\s*(?:please\s+)?(?:create|make|build|start|duplicate)\s+(?:a\s+)?(?:(?:banner|ad|creative|campaign)\s+)?(?:variant|version|size|alternate\s+layout|alternate\s+banner\s+layout)(?:\s+(?:in|with)\s+indesign)?\s*[.!?]?\s*$/i;
const INDESIGN_SELECT_LAYER_RE = /^\s*(?:please\s+)?(?:select|target|activate|choose)\s+(?:the\s+)?(?:indesign\s+)?layer\s+["'`]?([^"'`\n\r]{1,120})["'`]?\s*[.!?]?\s*$/i;
const INDESIGN_MOVE_SELECTION_TO_LAYER_RE = /^\s*(?:please\s+)?(?:move|send|put)\s+(?:the\s+)?(?:selected\s+)?(?:object|frame|image|graphic|text|banner|ad|creative|asset|logo)\s+(?:to|onto|into)\s+(?:the\s+)?layer\s+["'`]?([^"'`\n\r]{1,120})["'`]?\s*[.!?]?\s*$/i;
const INDESIGN_PLACE_FILE_ON_LAYER_RE = new RegExp(String.raw`^\s*(?:please\s+)?(?:place|import|insert|add)\s+(?:(?:the\s+)?(?:file|image|photo|graphic|asset|logo)\s+)?${FILE_DIALOG_PATH_PATTERN}\s+(?:on|onto|into)\s+(?:the\s+)?layer\s+["'\x60]?([^"'\x60\n\r]{1,120})["'\x60]?(?:\s+(?:in|inside|on)\s+(?:indesign|the\s+layout))?\s*[.!?]?\s*$`, 'i');
const INDESIGN_APPLY_STYLE_RE = /^\s*(?:please\s+)?(?:apply|use|set)\s+(?:(paragraph|character|object)\s+)?style\s+["'`]?([^"'`\n\r]{1,180})["'`]?(?:\s+(?:to|on|for)\s+(?:the\s+)?(?:selected\s+)?(?:text|copy|object|frame|selection|banner|ad|creative))?\s*[.!?]?\s*$/i;
const INDESIGN_RESIZE_SELECTION_RE = /^\s*(?:please\s+)?(?:resize|set|make|change)\s+(?:the\s+)?(?:selected\s+)?(?:banner|ad|creative|frame|object|image|graphic|selection|text\s+frame)\s+(?:to|as)\s+(\d{2,5})\s*(?:x|by)\s*(\d{2,5})(?:\s*(px|pixels?|pt|points?|in|inch(?:es)?|mm|cm))?\s*[.!?]?\s*$/i;
const INDESIGN_ALIGN_SELECTION_RE = /^\s*(?:please\s+)?(?:align|center)\s+(?:the\s+)?(?:selected\s+)?(?:object|frame|image|graphic|text|selection|banner|ad|creative|logo)(?:\s+(?:to|on|in|with))?\s+(page\s+center|center|middle|horizontal\s+center|vertical\s+center|left|right|top|bottom)(?:\s+(?:of|on|to|in)\s+(page|spread|margin|selection|key\s+object))?\s*[.!?]?\s*$/i;
const INDESIGN_TEXT_ALIGN_RE = /^\s*(?:please\s+)?(?:align|set)\s+(?:the\s+)?(?:selected\s+)?(?:text|copy|paragraph|headline|body|cta|disclaimer)\s+(left|center|centre|right|justified?|justify)\s*[.!?]?\s*$/i;
const INDESIGN_TEXT_CASE_RE = /^\s*(?:please\s+)?(?:make|change|set|convert)\s+(?:the\s+)?(?:selected\s+)?(?:text|copy|headline|body|cta|disclaimer)\s+(uppercase|upper\s+case|lowercase|lower\s+case|title\s+case|sentence\s+case)\s*[.!?]?\s*$/i;
const INDESIGN_RELINK_FILE_RE = new RegExp(String.raw`^\s*(?:please\s+)?(?:relink|replace\s+link|update\s+(?:the\s+)?(?:selected\s+)?link|swap\s+(?:the\s+)?(?:linked\s+)?(?:asset|image|graphic|logo))(?:\s+(?:the\s+)?(?:selected\s+)?(?:link|asset|image|graphic|logo))?\s+(?:with|to|as|using)?\s*${FILE_DIALOG_PATH_PATTERN}(?:\s+(?:in|inside|on)\s+(?:indesign|the\s+selected\s+(?:link|image|graphic|asset)))?\s*[.!?]?\s*$`, 'i');
const INDESIGN_PROOF_EXPORT_RE = /^\s*(?:please\s+)?(?:export|make|create|save)\s+(?:a\s+)?(?:(?:dealer|dealership|legal|client|review|proof)\s+)?proof\s+pdf(?:\s+(?:as|to)\s+["'`]?([^"'`\n\r]{1,240}\.pdf)["'`]?)?\s*[.!?]?\s*$/i;
const INDESIGN_PACKAGE_HANDOFF_RE = new RegExp(String.raw`^\s*(?:please\s+)?(?:prep|prepare|package|collect)\s+(?:the\s+)?(?:indesign\s+)?(?:document|file|project|banner|ad|creative|layout)\s+(?:for\s+)?(?:handoff|production|print|printer|vendor|delivery|release|archive)(?:\s+(?:to|into|in|at)\s+${FILE_DIALOG_PATH_PATTERN})?\s*[.!?]?\s*$`, 'i');
const INDESIGN_DUPLICATE_PAGE_RE = /^\s*(?:please\s+)?(?:duplicate|copy)\s+(?:the\s+)?(?:current\s+)?(page|spread|layout)(?:\s+(?:in|inside|on)\s+(?:indesign|the\s+document))?\s*[.!?]?\s*$/i;
const INDESIGN_DATA_MERGE_SOURCE_RE = new RegExp(String.raw`^\s*(?:please\s+)?(?:(?:set|select|choose|load|use)\s+(?:the\s+)?(?:data\s+merge\s+)?(?:source|data\s+source|csv|spreadsheet|data\s+file)|(?:connect|link)\s+(?:data\s+merge|csv|spreadsheet))\s+(?:to|as|from|with|using)?\s*${FILE_DIALOG_PATH_PATTERN}(?:\s+(?:for|in|inside|on)\s+(?:indesign|data\s+merge|the\s+document))?\s*[.!?]?\s*$`, 'i');
const INDESIGN_DATA_MERGE_PREVIEW_RE = /^\s*(?:please\s+)?(?:preview|show|turn\s+on|enable)\s+(?:the\s+)?(?:data\s+merge\s+)?(?:preview|merged\s+records?)(?:\s+(?:in|inside|on)\s+(?:indesign|data\s+merge))?\s*[.!?]?\s*$/i;
const INDESIGN_DATA_MERGE_CREATE_RE = /^\s*(?:please\s+)?(?:create|make|generate|build)\s+(?:the\s+)?(?:merged\s+document|data\s+merged\s+document|merged\s+records?|data\s+merge\s+output)(?:\s+(?:in|inside|on)\s+(?:indesign|data\s+merge))?\s*[.!?]?\s*$/i;
const INDESIGN_LINKS_ACTION_RE = /^\s*(?:please\s+)?(?:(update\s+all\s+links|update\s+(?:modified\s+)?links?|relink\s+missing\s+links?|edit\s+original(?:\s+(?:link|image|asset|graphic))?|reveal\s+(?:link|linked\s+file|image|asset|graphic)\s+in\s+finder|go\s+to\s+link|show\s+link\s+info)(?:\s+(?:in|inside|on)\s+(?:indesign|links?\s+panel))?)\s*[.!?]?\s*$/i;
const INDESIGN_SELECTED_OBJECT_ACTION_RE = /^\s*(?:please\s+)?(?:(group|ungroup|lock|unlock|duplicate)\s+(?:the\s+)?(?:selected\s+)?(?:objects?|frames?|items?|selection|banner|ad|creative|image|graphic|text\s+frames?)|unlock\s+all\s+(?:objects?\s+)?on\s+(?:the\s+)?spread|paste\s+(?:the\s+)?selection\s+in\s+place)\s*[.!?]?\s*$/i;
const INDESIGN_LAYER_ACTION_RE = /^\s*(?:please\s+)?(show|hide|lock|unlock)\s+(?:the\s+)?(?:indesign\s+)?layer\s+["'`]?([^"'`\n\r]{1,120})["'`]?\s*[.!?]?\s*$/i;
const INDESIGN_EXPORT_PAGE_RANGE_RE = /^\s*(?:please\s+)?(?:export|save)\s+(?:pages?|page\s+range)\s+([0-9,\-\s]{1,80})\s+(?:as|to)\s+["'`]?([^"'`\n\r]{1,240}\.(?:pdf|jpg|jpeg|png))["'`]?\s*[.!?]?\s*$/i;
const INDESIGN_NEW_DOCUMENT_SIZE_RE = /^\s*(?:please\s+)?(?:create|make|start|open|build)\s+(?:a\s+)?(?:new\s+)?(?:(?:indesign|id)\s+)?(?:(?:banner|ad|document|layout|page)\s+)?(?:document|layout|file|banner|ad)?\s*(?:at|as|to|for|with)?\s*(\d{2,5}(?:\.\d{1,3})?)\s*(?:x|by)\s*(\d{2,5}(?:\.\d{1,3})?)(?:\s*(px|pixels?|pt|points?|in|inch(?:es)?|mm|cm))?(?:\s+(?:banner|ad|document|layout|page))?(?:\s+(?:with|and)\s+(\d{1,3})\s+pages?)?(?:\s+(?:with|and)\s+(?:bleed\s+)?(\d{1,3}(?:\.\d{1,4})?)\s*(px|pt|points?|in|inch(?:es)?|mm|cm)?\s+bleed)?(?:\s+(?:in|inside|on)\s+(?:adobe\s+)?indesign)?\s*[.!?]?\s*$/i;
const INDESIGN_DOCUMENT_SIZE_RE = /^\s*(?:please\s+)?(?:set|change|update|resize)\s+(?:the\s+)?(?:document|page|layout)\s+size\s+(?:to|as)\s+(\d{2,5}(?:\.\d{1,3})?)\s*(?:x|by)\s*(\d{2,5}(?:\.\d{1,3})?)(?:\s*(px|pixels?|pt|points?|in|inch(?:es)?|mm|cm))?(?:\s+(?:in|inside|on)\s+(?:adobe\s+)?indesign)?\s*[.!?]?\s*$/i;
const INDESIGN_SET_BLEED_RE = /^\s*(?:please\s+)?(?:set|change|update)\s+(?:the\s+)?(?:document\s+)?bleed(?:\s+(?:to|as))?\s+(\d{1,3}(?:\.\d{1,4})?)(?:\s*(px|pt|points?|in|inch(?:es)?|mm|cm))?(?:\s+(?:in|inside|on)\s+(?:adobe\s+)?indesign)?\s*[.!?]?\s*$/i;
const INDESIGN_SET_MARGINS_RE = /^\s*(?:please\s+)?(?:set|change|update)\s+(?:the\s+)?margins?(?:\s+(?:to|as))?\s+(\d{1,3}(?:\.\d{1,4})?)(?:\s*(px|pt|points?|in|inch(?:es)?|mm|cm))?(?:\s+(?:in|inside|on)\s+(?:adobe\s+)?indesign)?\s*[.!?]?\s*$/i;
const INDESIGN_SET_COLUMNS_RE = /^\s*(?:please\s+)?(?:set|change|update)\s+(?:the\s+)?(?:margins?\s+)?columns?(?:\s+(?:to|as))?\s+(\d{1,3})(?:\s+(?:in|inside|on)\s+(?:adobe\s+)?indesign)?\s*[.!?]?\s*$/i;
const INDESIGN_NEW_LAYER_RE = /^\s*(?:please\s+)?(?:create|make|add)\s+(?:a\s+)?(?:new\s+)?(?:indesign\s+)?layer\s+["'`]?([^"'`\n\r]{1,120})["'`]?\s*[.!?]?\s*$/i;
const INDESIGN_RENAME_LAYER_RE = /^\s*(?:please\s+)?(?:rename|change)\s+(?:the\s+)?(?:indesign\s+)?layer\s+["'`]?([^"'`\n\r]{1,120})["'`]?\s+(?:to|as)\s+["'`]?([^"'`\n\r]{1,120})["'`]?\s*[.!?]?\s*$/i;
const INDESIGN_NEW_SWATCH_RE = /^\s*(?:please\s+)?(?:create|make|add)\s+(?:a\s+)?(?:new\s+)?(?:color\s+)?swatch\s+["'`]?([^"'`#\n\r]{1,120}?)["'`]?\s+(?:with|to|as|using)?\s*(#[0-9a-f]{6})\s*[.!?]?\s*$/i;
const INDESIGN_APPLY_SWATCH_RE = /^\s*(?:please\s+)?(?:(?:apply|use)\s+(?:(fill|stroke|text)\s+)?(?:swatch|color)\s+["'`]?([^"'`\n\r]{1,120})["'`]?(?:\s+(?:to|on|for)\s+(?:the\s+)?(?:selected\s+)?(?:text|object|frame|selection|banner|ad|creative))?|(?:set|change)\s+(?:the\s+)?(?:selected\s+)?(fill|stroke|text|object|frame)?\s*(?:color|swatch)\s+(?:to|as)\s+["'`]?([^"'`\n\r]{1,120})["'`]?)\s*[.!?]?\s*$/i;
const INDESIGN_TEXT_WRAP_RE = /^\s*(?:please\s+)?(?:(?:set|apply|turn\s+on|use)\s+(?:the\s+)?text\s+wrap(?:\s+(?:to|as))?\s*(none|no\s+wrap|bounding\s+box|wrap\s+around\s+bounding\s+box|object\s+shape|wrap\s+around\s+object\s+shape|jump\s+object|jump\s+to\s+next\s+column)?|wrap\s+text\s+around\s+(?:the\s+)?(?:selected\s+)?(?:image|object|frame|graphic)(?:\s+(none|bounding\s+box|object\s+shape|jump\s+object|jump\s+to\s+next\s+column))?)\s*[.!?]?\s*$/i;
const INDESIGN_EXPORT_NAMED_PRESET_RE = /^\s*(?:please\s+)?(?:export|make|create|save)\s+(?:a\s+)?pdf\s+(?:using|with|from)\s+(?:the\s+)?(?:pdf\s+)?preset\s+["'`]?([^"'`\n\r]{1,160}?)["'`]?(?:\s+(?:as|to)\s+["'`]?([^"'`\n\r]{1,240}\.pdf)["'`]?)?\s*[.!?]?\s*$/i;
const INDESIGN_APPLY_PARENT_RE = /^\s*(?:please\s+)?(?:apply|use|set)\s+(?:the\s+)?(?:parent|master)(?:\s+page)?\s+["'`]?([^"'`\n\r]{1,120})["'`]?\s+(?:to|on|for)\s+pages?\s+([0-9,\-\s]{1,80})\s*[.!?]?\s*$/i;
const INDESIGN_CREATE_GUIDES_RE = /^\s*(?:please\s+)?(?:create|make|add|setup|set\s+up)\s+(?:a\s+)?(?:guide|guides|guide\s+grid)\s+(?:(\d{1,3})\s+rows?)?(?:\s*(?:and|by|x)?\s*(\d{1,3})\s+columns?)?\s*[.!?]?\s*$/i;
const MAC_SPOTLIGHT_RE = /^\s*(?:please\s+)?(?:(?:open|show|launch)\s+)?spotlight(?:\s+(?:and\s+)?(?:(?:search|find|look\s+for)(?:\s+for)?\s+)?([\s\S]{1,500}?))?\s*[.!?]?\s*$/i;
const MAC_SPOTLIGHT_SEARCH_RE = /^\s*(?:please\s+)?(?:search|find|look\s+for)\s+(?:(?:with|using|in|on)\s+)?spotlight(?:\s+for)?\s+([\s\S]{1,500})\s*[.!?]?\s*$/i;
const MAC_MISSION_CONTROL_RE = /^\s*(?:please\s+)?(?:open|show|launch|toggle)\s+(?:mission\s+control|all\s+windows|desktop\s+spaces|spaces)\s*[.!?]?\s*$/i;
const MAC_APP_WINDOWS_RE = /^\s*(?:please\s+)?(?:open|show|toggle)\s+(?:app(?:lication)?\s+windows|current\s+app\s+windows|expose)\s*[.!?]?\s*$/i;
const MAC_SHOW_DESKTOP_RE = /^\s*(?:please\s+)?(?:show|reveal|peek\s+at)\s+(?:the\s+)?desktop\s*[.!?]?\s*$/i;
const MAC_LAUNCHPAD_RE = /^\s*(?:please\s+)?(?:open|show|launch|toggle)\s+launchpad\s*[.!?]?\s*$/i;
const MAC_APP_SWITCHER_RE = /^\s*(?:please\s+)?(?:open|show|toggle)\s+(?:the\s+)?(?:app\s+switcher|application\s+switcher|application\s+switching)\s*[.!?]?\s*$/i;
const MAC_LOCK_SCREEN_RE = /^\s*(?:please\s+)?(?:lock|sleep)\s+(?:my\s+)?(?:mac|screen|computer|desktop)\s*[.!?]?\s*$/i;
const MAC_SCREENSHOT_RE = /^\s*(?:please\s+)?(?:(?:take|capture|start)\s+(?:a\s+)?(?:(selection|selected\s+area|area|region|window|screen|full\s*screen|toolbar)\s+)?(?:screen\s*shot|screenshot)|(?:open|show|launch)\s+(?:the\s+)?screenshot\s+(toolbar|tool|app))\s*[.!?]?\s*$/i;
const MAC_FINDER_LOCATION_RE = /^\s*(?:please\s+)?(?:open|show|go\s+to|reveal)\s+(?:(?:the\s+)?finder\s+)?(?:my\s+)?(desktop|downloads?|documents?|applications?|airdrop|recents?|home|computer|network|icloud(?:\s+drive)?)(?:\s+(?:folder|window|in\s+finder))?\s*[.!?]?\s*$/i;
const MAC_FINDER_LOCATION_TRAILING_RE = /^\s*(?:please\s+)?(?:open|show|go\s+to|reveal)\s+(?:the\s+)?(desktop|downloads?|documents?|applications?|airdrop|recents?|home|computer|network|icloud(?:\s+drive)?)\s+(?:in|inside|on)\s+finder\s*[.!?]?\s*$/i;
const MAC_FINDER_ACTION_RE = /^\s*(?:please\s+)?(?:(?:open|create|make|start)\s+(?:a\s+)?new\s+(finder\s+)?window|(?:create|make|add)\s+(?:a\s+)?new\s+folder(?:\s+in\s+finder)?|(?:quick\s+look|preview)\s+(?:the\s+)?(?:selection|selected\s+file|file|item)(?:\s+in\s+finder)?|(?:get|show|open)\s+(?:info|file\s+info)(?:\s+in\s+finder)?|(?:search|find)\s+(?:in\s+)?finder)\s*[.!?]?\s*$/i;
const MAC_FINDER_VIEW_RE = /^\s*(?:please\s+)?(?:set|switch|change|show|use|open)\s+(?:finder\s+)?(?:to\s+)?(icon|list|column|gallery)\s+view(?:\s+in\s+finder)?\s*[.!?]?\s*$/i;
const MAC_SYSTEM_SETTINGS_MAIN_RE = /^\s*(?:please\s+)?(?:open|show|launch|go\s+to)\s+(?:the\s+)?(?:system\s+settings|system\s+preferences|mac\s+settings|macos\s+settings)(?:\s+(?:for|to|at|in)?\s*([\s\S]{1,160}?))?\s*[.!?]?\s*$/i;
const MAC_SYSTEM_SETTINGS_PANE_RE = /^\s*(?:please\s+)?(?:open|show|launch|go\s+to)\s+(?:the\s+)?(accessibility|privacy(?:\s+and\s+security)?|security|display|displays|sound|keyboard|mouse|trackpad|bluetooth|network|wi-?fi|battery|storage|users?\s+and\s+groups?|general|appearance|desktop\s+and\s+dock|control\s+center|siri|spotlight|printers?(?:\s+and\s+scanners)?|screen\s+time|notifications?|login\s+items?)\s+(?:settings|preferences)\s*[.!?]?\s*$/i;
const URL_TARGET_PATTERN = String.raw`(?:https?:\/\/\S+|www\.\S+|[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+(?:\/\S*)?)`;
const STANDALONE_NEW_TAB_URL_RE = new RegExp(String.raw`^\s*(?:please\s+)?(?:open|visit|go\s+to|navigate\s+to)\s+(${URL_TARGET_PATTERN})\s+(?:in|inside|on)\s+(?:a\s+)?(?:new\s+)?tab(?:\s+(?:in|inside|on)\s+(.+?)(?:\s+(?:app|application|window|browser))?)?\s*[.!?]?\s*$`, 'i');
const STANDALONE_NEW_TAB_TO_URL_RE = new RegExp(String.raw`^\s*(?:please\s+)?(?:open|create|start|make)\s+(?:a\s+)?new\s+tab\s+(?:to|at|for|with)\s+(${URL_TARGET_PATTERN})(?:\s+(?:in|inside|on)\s+(.+?)(?:\s+(?:app|application|window|browser))?)?\s*[.!?]?\s*$`, 'i');
const STANDALONE_BROWSER_SEARCH_IN_APP_RE = /^\s*(?:please\s+)?(?:search|google)\s+(?:(?:the\s+)?(?:web|internet|google)\s+)?(?:for\s+)?([\s\S]{1,2000}?)\s+(?:in|inside|on)\s+(.+?)(?:\s+(?:app|application|window|browser))?\s*[.!?]?\s*$/i;
const COPY_CURRENT_URL_RE = /^\s*(?:please\s+)?(?:copy|get|grab|save)\s+(?:the\s+)?(?:current\s+)?(?:page\s+)?(?:url|link|address)(?:\s+(?:from|in|inside|on)\s+(.+?)(?:\s+(?:app|application|window|browser))?)?\s*[.!?]?\s*$/i;
const FIND_ON_CURRENT_PAGE_RE = /^\s*(?:please\s+)?(?:find|search)(?:\s+(?:this|the|current)\s+page)?(?:\s+for)?\s+([\s\S]{1,2000}?)\s+(?:on|within|inside)\s+(?:this|the|current)\s+page(?:\s+(?:in|inside|on)\s+(.+?)(?:\s+(?:app|application|window|browser))?)?\s*[.!?]?\s*$/i;
const GMAIL_OPEN_RE = /^\s*(?:please\s+)?(?:open|show|go\s+to|launch)\s+(?:my\s+)?gmail(?:\s+(inbox|sent|drafts?|starred|snoozed|important|spam|trash|all\s+mail|compose))?(?:\s+(?:in|inside|on)\s+(.+?)(?:\s+(?:app|application|window|browser))?)?\s*[.!?]?\s*$/i;
const GMAIL_LABEL_TRAILING_RE = /^\s*(?:please\s+)?(?:open|show|go\s+to)\s+(inbox|sent|drafts?|starred|snoozed|important|spam|trash|all\s+mail)\s+(?:in|inside|on)\s+gmail(?:\s+(?:in|inside|on)\s+(.+?)(?:\s+(?:app|application|window|browser))?)?\s*[.!?]?\s*$/i;
const GMAIL_SEARCH_RE = /^\s*(?:please\s+)?(?:search|find|look\s+for)\s+(?:gmail|mail|email|emails)(?:\s+for)?\s+([\s\S]{1,500}?)(?:\s+(?:in|inside|on)\s+(.+?)(?:\s+(?:app|application|window|browser))?)?\s*[.!?]?\s*$/i;
const GMAIL_SEARCH_TRAILING_RE = /^\s*(?:please\s+)?(?:search|find|look\s+for)\s+([\s\S]{1,500}?)\s+(?:in|inside|on)\s+(?:gmail|mail|email|emails)(?:\s+(?:in|inside|on)\s+(.+?)(?:\s+(?:app|application|window|browser))?)?\s*[.!?]?\s*$/i;
const GMAIL_COMPOSE_INTENT_RE = /^\s*(?:please\s+)?(?:open\s+)?(?:(compose|draft|write|send)\s+(?:a\s+)?(?:gmail|email|message)|gmail\s+compose)([\s\S]*)$/i;
const WORDPRESS_ADMIN_RE = new RegExp(String.raw`^\s*(?:please\s+)?(?:open|show|go\s+to|launch)\s+(?:wordpress|wp|wp-admin|wordpress\s+admin)(?:\s+(?:dashboard|admin))?(?:\s+(?:for|on|at)\s+(${URL_TARGET_PATTERN}))?(?:\s+(?:in|inside|on)\s+(.+?)(?:\s+(?:app|application|window|browser))?)?\s*[.!?]?\s*$`, 'i');
const WORDPRESS_SECTION_RE = new RegExp(String.raw`^\s*(?:please\s+)?(?:open|show|go\s+to|launch)\s+(?:(?:the\s+)?(?:wordpress|wp)\s+)?(dashboard|admin|posts?|all\s+posts|new\s+post|add\s+new\s+post|pages?|all\s+pages|new\s+page|add\s+new\s+page|media(?:\s+library)?|comments?|plugins?|themes?|users?|settings|categories|tags)(?:\s+(?:in|inside|on)\s+(?:wordpress|wp))?(?:\s+(?:for|on|at)\s+(${URL_TARGET_PATTERN}))?(?:\s+(?:in|inside|on)\s+(.+?)(?:\s+(?:app|application|window|browser))?)?\s*[.!?]?\s*$`, 'i');
const WORDPRESS_NEW_CONTENT_RE = new RegExp(String.raw`^\s*(?:please\s+)?(?:create|make|start|open)\s+(?:a\s+)?(?:new\s+)?(?:wordpress|wp)\s+(post|page)(?:\s+(?:for|on|at)\s+(${URL_TARGET_PATTERN}))?(?:\s+(?:in|inside|on)\s+(.+?)(?:\s+(?:app|application|window|browser))?)?\s*[.!?]?\s*$`, 'i');
const PRESS_KEYS_IN_APP_RE = /^\s*(?:please\s+)?(?:press|hit|tap)\s+(.+?)\s+(?:in|inside|on)\s+(.+?)(?:\s+(?:app|application|window))?\s*[.!?]?\s*$/i;
const PRESS_KEYS_FRONTMOST_RE = /^\s*(?:please\s+)?(?:press|hit|tap)\s+(.+?)\s+(?:in|inside|on)\s+(?:the\s+)?(?:current|active|frontmost)\s+(?:app|application|window)\s*[.!?]?\s*$/i;
const PRESS_KEYS_BARE_RE = /^\s*(?:please\s+)?(?:press|hit|tap)\s+(.+?)\s*[.!?]?\s*$/i;
const MENU_CLICK_IN_APP_RE = /^\s*(?:please\s+)?(?:click|press|select|choose|open)\s+(?:the\s+)?(.+?(?:>|→|›).+?)(?:\s+menu(?:\s+item)?|\s+item)?\s+(?:in|inside|on)\s+(.+?)(?:\s+(?:app|application|window))?\s*[.!?]?\s*$/i;
const MENU_CLICK_FRONTMOST_RE = /^\s*(?:please\s+)?(?:click|press|select|choose|open)\s+(?:the\s+)?(.+?(?:>|→|›).+?)(?:\s+menu(?:\s+item)?|\s+item)?\s+(?:in|inside|on)\s+(?:the\s+)?(?:current|active|frontmost)\s+(?:app|application|window)\s*[.!?]?\s*$/i;
const BARE_MENU_CLICK_RE = /^\s*(?:please\s+)?(?:click|press|select|choose|open)\s+(?:the\s+)?(.+?(?:>|→|›).+?)(?:\s+menu(?:\s+item)?|\s+item)?\s*[.!?]?\s*$/i;
const SEMANTIC_CLICK_IN_APP_RE = /^\s*(?:please\s+)?(?:click|press|select|choose|tap|check|uncheck|toggle)\s+(?:the\s+)?(.+?)(?:\s+(?:button|menu|menu item|control|field|item|tab|checkbox|check\s*box|icon|switch|toggle))?\s+(?:in|inside|on)\s+(.+?)(?:\s+(?:app|application|window))?\s*[.!?]?\s*$/i;
const SEMANTIC_CLICK_FRONTMOST_RE = /^\s*(?:please\s+)?(?:click|press|select|choose|tap|check|uncheck|toggle)\s+(?:the\s+)?(.+?)(?:\s+(?:button|menu|menu item|control|field|item|tab|checkbox|check\s*box|icon|switch|toggle))?\s+(?:in|inside|on)\s+(?:the\s+)?(?:current|active|frontmost)\s+(?:app|application|window)\s*[.!?]?\s*$/i;
const BARE_SEMANTIC_CLICK_RE = /^\s*(?:please\s+)?(?:click|press|select|choose|tap|check|uncheck|toggle)\s+(?:the\s+)?(.+?)(?:\s+(?:button|menu|menu item|control|field|item|tab|checkbox|check\s*box|icon|switch|toggle))?\s*[.!?]?\s*$/i;
const WAIT_FOR_APP_RE = new RegExp(String.raw`^\s*(?:please\s+)?(?:wait|pause)(?:\s+for)?\s+(.+?)\s+(?:to\s+)?(?:open|launch|start|load|be\s+ready|come\s+up|appear)(?:\s+(?:for\s+)?(${DURATION_AMOUNT_PATTERN})\s*(seconds|second|secs|sec|s|milliseconds|millisecond|ms))?\s*[.!?]?\s*$`, 'i');
const WAIT_UNTIL_READY_RE = new RegExp(String.raw`^\s*(?:please\s+)?(?:wait|pause)\s+(?:(?:until|till|for)\s+)?(?:(.+?)\s+)?(?:to\s+)?(?:open|launch|start|load|be\s+ready|is\s+ready|ready|come\s+up|appear)(?:\s+(?:for\s+)?(${DURATION_AMOUNT_PATTERN})\s*(seconds|second|secs|sec|s|milliseconds|millisecond|ms))?\s*[.!?]?\s*$`, 'i');
const WAIT_RE = new RegExp(String.raw`^\s*(?:please\s+)?(?:wait|pause|sleep)(?:\s+(?:for\s+)?)?(${DURATION_AMOUNT_PATTERN})?\s*(milliseconds|millisecond|ms|seconds|second|secs|sec|s)?\s*[.!?]?\s*$`, 'i');
const WINDOW_RESIZE_RE = /^\s*(?:please\s+)?resize\s+(?:(.+?)\s+)?window\s+(?:to|at)\s+(\d{2,5})\s*x\s*(\d{2,5})\s*[.!?]?\s*$/i;
const WINDOW_MANAGE_RE = /^\s*(?:please\s+)?(minimi[sz]e|unminimi[sz]e|maximi[sz]e|zoom|raise|focus)\s+(?:(active|frontmost|current)\s+)?(?:(.+?)\s+)?window\s*[.!?]?\s*$/i;
const LAUNCH_APP_RE = /^\s*(?:please\s+)?(?:open|launch|start|fire\s+up)\s+(.+?)(?:\s+(?:app|application|program))?(?:\s+(?:on|in)\s+(?:my\s+)?(?:computer|mac|desktop))?\s*[.!?]?$/i;
const FOCUS_APP_RE = /^\s*(?:please\s+)?(?:focus|switch\s+to|bring\s+(?:up|forward)|bring\s+.+?\s+to\s+(?:front|the\s+front))\s+(.+?)(?:\s+(?:app|application|window))?\s*[.!?]?$/i;
const BRING_TO_FRONT_RE = /^\s*(?:please\s+)?bring\s+(.+?)\s+to\s+(?:front|the\s+front)\s*[.!?]?$/i;
const OPEN_URL_RE = /^\s*(?:please\s+)?(?:open|visit|go\s+to|navigate\s+to|launch)\s+(https?:\/\/\S+|mailto:\S+|file:\/\/\S+)\s*$/i;
const OPEN_BARE_URL_RE = /^\s*(?:please\s+)?(?:open|visit|go\s+to|navigate\s+to|launch)\s+((?:www\.)?[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+(?:\/\S*)?)\s*$/i;
const OPEN_PATH_RE = /^\s*(?:please\s+)?(?:open|reveal|show)\s+((?:~\/|\/|\.\/|\.\.\/)[^\n\r]+)\s*$/i;
const SEQUENCE_COMMAND_VERBS = String.raw`open|launch|start|focus|switch|bring|activate|navigate|click|press|select|highlight|mark|choose|check|uncheck|toggle|type|enter|paste|fill|set|prep|prepare|change|update|put|add|convert|hit|tap|wait|pause|sleep|scroll|move|hover|position|drag|resize|minimi[sz]e|maximi[sz]e|zoom|raise|take|show|list|read|inspect|audit|search|find|locate|copy|cut|clear|empty|erase|remove|replace|overwrite|delete|save|export|place|import|package|fit|outline|close|quit|exit|undo|redo|refresh|reload|confirm|submit|cancel|dismiss|accept|decline|hide|unhide|use|apply|run|trigger|execute|generate|generative|insert|modify|edit|create|make|new|go|ai|harmoni[sz]e|match`;
const SEQUENCE_COMMAND_PREFIX = String.raw`(?:please\s+)?(?:${SEQUENCE_COMMAND_VERBS})\b`;
const SEQUENCE_MARKER_RE = new RegExp(String.raw`\b(?:and then|then|after that|finally|lastly|first)\b|\bnext\b\s+(?=${SEQUENCE_COMMAND_PREFIX})|[;\n]|\s->\s|\s\d+[.)]\s|,\s+(?=${SEQUENCE_COMMAND_PREFIX})|\s+\band\s+(?=${SEQUENCE_COMMAND_PREFIX})`, 'i');
const SEQUENCE_COMMAND_VERB_RE = new RegExp(SEQUENCE_COMMAND_PREFIX, 'i');
const SEQUENCE_SPLIT_RE = new RegExp(String.raw`\s*(?:;|\n+|\s*->\s*|\s+\b(?:and then|then|after that|finally|lastly)\b\s+|\s+\bnext\b\s+(?=${SEQUENCE_COMMAND_PREFIX})|,\s+(?=${SEQUENCE_COMMAND_PREFIX})|\s+\band\b\s+(?=${SEQUENCE_COMMAND_PREFIX}))\s*`, 'i');

const APP_KEY_ACTIONS: Array<{ combo: string; reason: string; re: RegExp; appGroup?: number }> = [
  { combo: 'Cmd+Shift+S', reason: 'local-save-as-shortcut', re: /^\s*(?:please\s+)?save\s+as(?:\s+(?:in|inside|on)\s+(.+?)(?:\s+(?:app|application|window))?)?\s*[.!?]?\s*$/i },
  { combo: 'Cmd+S', reason: 'local-save-shortcut', re: /^\s*(?:please\s+)?save(?:\s+(?:it|this|the\s+(?:file|document|image|project|work)))?(?:\s+(?:in|inside|on)\s+(.+?)(?:\s+(?:app|application|window))?)?\s*[.!?]?\s*$/i },
  { combo: 'Return', reason: 'local-confirm-dialog-shortcut', re: /^\s*(?:please\s+)?(?:confirm|submit|accept|press\s+(?:ok|okay)|click\s+(?:ok|okay)|hit\s+(?:ok|okay)|choose\s+(?:ok|okay))(?:\s+(?:dialog|modal|popup|prompt|alert|form|current\s+dialog))?(?:\s+(?:in|inside|on)\s+(.+?)(?:\s+(?:app|application|window))?)?\s*[.!?]?\s*$/i },
  { combo: 'Escape', reason: 'local-cancel-dialog-shortcut', re: /^\s*(?:please\s+)?(?:cancel|dismiss|decline|close|escape)(?:\s+(?:the\s+)?(?:dialog|modal|popup|prompt|alert))?(?:\s+(?:in|inside|on)\s+(.+?)(?:\s+(?:app|application|window))?)?\s*[.!?]?\s*$/i },
  { combo: 'Cmd+A', reason: 'local-select-all-shortcut', re: /^\s*(?:please\s+)?select\s+all(?:\s+(?:in|inside|on)\s+(.+?)(?:\s+(?:app|application|window))?)?\s*[.!?]?\s*$/i },
  { combo: 'Cmd+C', reason: 'local-copy-selection-shortcut', re: /^\s*(?:please\s+)?copy(?:\s+(?:it|this|selection|selected\s+(?:text|item|items)|current\s+selection))?(?:\s+(?:in|inside|on)\s+(.+?)(?:\s+(?:app|application|window))?)?\s*[.!?]?\s*$/i },
  { combo: 'Cmd+X', reason: 'local-cut-selection-shortcut', re: /^\s*(?:please\s+)?cut(?:\s+(?:it|this|selection|selected\s+(?:text|item|items)|current\s+selection))?(?:\s+(?:in|inside|on)\s+(.+?)(?:\s+(?:app|application|window))?)?\s*[.!?]?\s*$/i },
  { combo: 'Cmd+V', reason: 'local-paste-shortcut', re: /^\s*(?:please\s+)?paste(?:\s+(?:it|this|clipboard|from\s+clipboard|current\s+clipboard))?(?:\s+(?:in|inside|on)\s+(.+?)(?:\s+(?:app|application|window))?)?\s*[.!?]?\s*$/i },
  { combo: 'Delete', reason: 'local-delete-selection-shortcut', re: /^\s*(?:please\s+)?(?:delete|remove|clear|erase)\s+(?:the\s+)?(?:selection|selected\s+(?:text|item|items)|current\s+selection|current\s+field|field\s+contents|text|contents?)(?:\s+(?:in|inside|on)\s+(.+?)(?:\s+(?:app|application|window))?)?\s*[.!?]?\s*$/i },
  { combo: 'Cmd+Z', reason: 'local-undo-shortcut', re: /^\s*(?:please\s+)?undo(?:\s+(?:it|that|last\s+(?:step|action|change)))?(?:\s+(?:in|inside|on)\s+(.+?)(?:\s+(?:app|application|window))?)?\s*[.!?]?\s*$/i },
  { combo: 'Cmd+Shift+Z', reason: 'local-redo-shortcut', re: /^\s*(?:please\s+)?redo(?:\s+(?:it|that|last\s+(?:step|action|change)))?(?:\s+(?:in|inside|on)\s+(.+?)(?:\s+(?:app|application|window))?)?\s*[.!?]?\s*$/i },
  { combo: 'Cmd+L', reason: 'local-location-bar-shortcut', re: /^\s*(?:please\s+)?(?:focus|select|open|activate|go\s+to)\s+(?:the\s+)?(?:address|location|url|omnibox|search)\s+(?:bar|field|box)(?:\s+(?:in|inside|on)\s+(.+?)(?:\s+(?:app|application|window))?)?\s*[.!?]?\s*$/i },
  { combo: 'Cmd+F', reason: 'local-find-shortcut', re: /^\s*(?:please\s+)?(?:open\s+)?(?:find|search)(?:\s+(?:box|field|bar))?(?:\s+(?:in|inside|on)\s+(.+?)(?:\s+(?:app|application|window))?)?\s*[.!?]?\s*$/i },
  { combo: 'Cmd+T', reason: 'local-new-tab-shortcut', re: /^\s*(?:please\s+)?(?:(?:open|create|start|make)\s+)?(?:a\s+)?new\s+tab(?:\s+(?:in|inside|on)\s+(.+?)(?:\s+(?:app|application|window))?)?\s*[.!?]?\s*$/i },
  { combo: 'Cmd+Shift+N', reason: 'local-private-window-shortcut', re: /^\s*(?:please\s+)?(?:(?:open|create|start|make)\s+)?(?:a\s+)?(?:new\s+)?(?:private|incognito)\s+(?:window|tab|browser)(?:\s+(?:in|inside|on)\s+(.+?)(?:\s+(?:app|application|window|browser))?)?\s*[.!?]?\s*$/i },
  { combo: 'Cmd+Shift+T', reason: 'local-reopen-closed-tab-shortcut', re: /^\s*(?:please\s+)?(?:reopen|restore)\s+(?:the\s+)?(?:last\s+|previous\s+|closed\s+)*(?:closed\s+)?tab(?:\s+(?:in|inside|on)\s+(.+?)(?:\s+(?:app|application|window))?)?\s*[.!?]?\s*$/i },
  { combo: 'Ctrl+Tab', reason: 'local-next-tab-shortcut', re: /^\s*(?:please\s+)?(?:go\s+to|switch\s+to|activate|select|next)\s+(?:the\s+)?next\s+tab(?:\s+(?:in|inside|on)\s+(.+?)(?:\s+(?:app|application|window))?)?\s*[.!?]?\s*$/i },
  { combo: 'Ctrl+Shift+Tab', reason: 'local-previous-tab-shortcut', re: /^\s*(?:please\s+)?(?:go\s+to|switch\s+to|activate|select|previous|prev)\s+(?:the\s+)?(?:previous|prev|last)\s+tab(?:\s+(?:in|inside|on)\s+(.+?)(?:\s+(?:app|application|window))?)?\s*[.!?]?\s*$/i },
  { combo: 'Cmd+`', reason: 'local-next-window-shortcut', re: /^\s*(?:please\s+)?(?:go\s+to|switch\s+to|activate|select|next)\s+(?:the\s+)?next\s+window(?:\s+(?:in|inside|on)\s+(.+?)(?:\s+(?:app|application|window))?)?\s*[.!?]?\s*$/i },
  { combo: 'Cmd+Shift+`', reason: 'local-previous-window-shortcut', re: /^\s*(?:please\s+)?(?:go\s+to|switch\s+to|activate|select|previous|prev)\s+(?:the\s+)?(?:previous|prev|last)\s+window(?:\s+(?:in|inside|on)\s+(.+?)(?:\s+(?:app|application|window))?)?\s*[.!?]?\s*$/i },
  { combo: 'Cmd+N', reason: 'local-new-document-shortcut', re: /^\s*(?:please\s+)?(?:(?:open|create|start|make)\s+)?(?:a\s+)?new\s+(?:document|file|window|project)(?:\s+(?:in|inside|on)\s+(.+?)(?:\s+(?:app|application|window))?)?\s*[.!?]?\s*$/i },
  { combo: 'Cmd+W', reason: 'local-close-window-shortcut', re: /^\s*(?:please\s+)?close\s+(?:it|this|the\s+)?(?:current\s+|active\s+|frontmost\s+)?(?:window|tab|document|file)(?:\s+(?:in|inside|on)\s+(.+?)(?:\s+(?:app|application|window))?)?\s*[.!?]?\s*$/i },
  { combo: 'Cmd+Q', reason: 'local-quit-app-shortcut', re: /^\s*(?:please\s+)?(?:quit|exit)\s+(.+?)(?:\s+(?:app|application|program))?\s*[.!?]?\s*$/i },
  { combo: 'Cmd+[', reason: 'local-browser-back-shortcut', re: /^\s*(?:please\s+)?(?:go|navigate|move)\s+back(?:\s+(?:in|inside|on)\s+(.+?)(?:\s+(?:app|application|window|browser))?)?\s*[.!?]?\s*$/i },
  { combo: 'Cmd+]', reason: 'local-browser-forward-shortcut', re: /^\s*(?:please\s+)?(?:go|navigate|move)\s+forward(?:\s+(?:in|inside|on)\s+(.+?)(?:\s+(?:app|application|window|browser))?)?\s*[.!?]?\s*$/i },
  { combo: 'Cmd+Shift+R', reason: 'local-hard-refresh-shortcut', re: /^\s*(?:please\s+)?(?:hard\s+refresh|force\s+refresh|force\s+reload|reload\s+without\s+cache)(?:\s+(?:it|this|page|view|window))?(?:\s+(?:in|inside|on)\s+(.+?)(?:\s+(?:app|application|window|browser))?)?\s*[.!?]?\s*$/i },
  { combo: 'Cmd+R', reason: 'local-refresh-shortcut', re: /^\s*(?:please\s+)?(?:refresh|reload)(?:\s+(?:it|this|page|view|window))?(?:\s+(?:in|inside|on)\s+(.+?)(?:\s+(?:app|application|window))?)?\s*[.!?]?\s*$/i },
  { combo: 'Cmd+P', reason: 'local-print-shortcut', re: /^\s*(?:please\s+)?(?:print|open\s+(?:the\s+)?print\s+(?:dialog|sheet))(?:\s+(?:it|this|page|document|file|view|window))?(?:\s+(?:in|inside|on)\s+(.+?)(?:\s+(?:app|application|window|browser))?)?\s*[.!?]?\s*$/i },
  { combo: 'Cmd+Opt+I', reason: 'local-devtools-shortcut', re: /^\s*(?:please\s+)?(?:(?:open|show|toggle)\s+)?(?:dev\s*tools|developer\s+tools|inspect\s+element|web\s+inspector)(?:\s+(?:in|inside|on)\s+(.+?)(?:\s+(?:app|application|window|browser))?)?\s*[.!?]?\s*$/i },
  { combo: 'Cmd+Opt+U', reason: 'local-view-source-shortcut', re: /^\s*(?:please\s+)?(?:(?:open|show|view)\s+)?(?:page\s+source|source\s+code|view\s+source)(?:\s+(?:in|inside|on)\s+(.+?)(?:\s+(?:app|application|window|browser))?)?\s*[.!?]?\s*$/i },
  { combo: 'Cmd+=', reason: 'local-zoom-in-shortcut', re: /^\s*(?:please\s+)?zoom\s+in(?:\s+(?:in|inside|on)\s+(.+?)(?:\s+(?:app|application|window))?)?\s*[.!?]?\s*$/i },
  { combo: 'Cmd+-', reason: 'local-zoom-out-shortcut', re: /^\s*(?:please\s+)?zoom\s+out(?:\s+(?:in|inside|on)\s+(.+?)(?:\s+(?:app|application|window))?)?\s*[.!?]?\s*$/i },
  { combo: 'Cmd+0', reason: 'local-reset-zoom-shortcut', re: /^\s*(?:please\s+)?(?:reset|restore)\s+zoom(?:\s+(?:in|inside|on)\s+(.+?)(?:\s+(?:app|application|window))?)?\s*[.!?]?\s*$/i },
  { combo: 'Ctrl+Cmd+F', reason: 'local-fullscreen-shortcut', re: /^\s*(?:please\s+)?(?:toggle\s+)?(?:full\s*screen|fullscreen)(?:\s+(?:mode|view))?(?:\s+(?:in|inside|on)\s+(.+?)(?:\s+(?:app|application|window))?)?\s*[.!?]?\s*$/i },
  { combo: 'Cmd+H', reason: 'local-hide-app-shortcut', re: /^\s*(?:please\s+)?hide(?:\s+(?:it|this|the\s+app))?(?:\s+(?:in|inside|on)\s+(.+?)(?:\s+(?:app|application|window))?)?\s*[.!?]?\s*$/i },
  { combo: 'Cmd+Opt+H', reason: 'local-hide-others-shortcut', re: /^\s*(?:please\s+)?hide\s+others(?:\s+(?:in|inside|on)\s+(.+?)(?:\s+(?:app|application|window))?)?\s*[.!?]?\s*$/i },
  { combo: 'Tab', reason: 'local-next-field-shortcut', re: /^\s*(?:please\s+)?(?:go\s+to|move\s+to|focus|select|next)\s+(?:the\s+)?next\s+(?:field|input|control)(?:\s+(?:in|inside|on)\s+(.+?)(?:\s+(?:app|application|window))?)?\s*[.!?]?\s*$/i },
  { combo: 'Shift+Tab', reason: 'local-previous-field-shortcut', re: /^\s*(?:please\s+)?(?:go\s+to|move\s+to|focus|select|previous|prev)\s+(?:the\s+)?(?:previous|prev|last)\s+(?:field|input|control)(?:\s+(?:in|inside|on)\s+(.+?)(?:\s+(?:app|application|window))?)?\s*[.!?]?\s*$/i },
  { combo: 'PageDown', reason: 'local-page-down-shortcut', re: /^\s*(?:please\s+)?(?:page\s+down|go\s+down\s+a\s+page|next\s+page)(?:\s+(?:in|inside|on)\s+(.+?)(?:\s+(?:app|application|window))?)?\s*[.!?]?\s*$/i },
  { combo: 'PageUp', reason: 'local-page-up-shortcut', re: /^\s*(?:please\s+)?(?:page\s+up|go\s+up\s+a\s+page|previous\s+page|prev\s+page)(?:\s+(?:in|inside|on)\s+(.+?)(?:\s+(?:app|application|window))?)?\s*[.!?]?\s*$/i },
  { combo: 'Home', reason: 'local-home-shortcut', re: /^\s*(?:please\s+)?(?:(?:go|scroll|jump)\s+to\s+)?(?:top|beginning|start)(?:\s+of\s+(?:page|document|file|screen|view))?(?:\s+(?:in|inside|on)\s+(.+?)(?:\s+(?:app|application|window|browser))?)?\s*[.!?]?\s*$/i },
  { combo: 'End', reason: 'local-end-shortcut', re: /^\s*(?:please\s+)?(?:(?:go|scroll|jump)\s+to\s+)?(?:bottom|end)(?:\s+of\s+(?:page|document|file|screen|view))?(?:\s+(?:in|inside|on)\s+(.+?)(?:\s+(?:app|application|window|browser))?)?\s*[.!?]?\s*$/i },
  { combo: 'Cmd+,', reason: 'local-preferences-shortcut', re: /^\s*(?:please\s+)?(?:(?:open|show)\s+)?(?:preferences|settings)(?:\s+(?:in|inside|on)\s+(.+?)(?:\s+(?:app|application|window))?)?\s*[.!?]?\s*$/i },
];

function isPathish(value: string): boolean {
  return /^(~|~\/|\/|\.\/|\.\.\/)/.test(value.trim()) ||
    /\b(downloads?|documents?|desktop|home folder|home directory)\b/i.test(value);
}

function normalizeFileSearchRoot(value: string): string {
  const lower = value.trim().toLowerCase();
  if (lower === 'desktop') return '~/Desktop';
  if (lower === 'download' || lower === 'downloads') return '~/Downloads';
  if (lower === 'document' || lower === 'documents') return '~/Documents';
  if (lower === 'picture' || lower === 'pictures' || lower === 'photo' || lower === 'photos') return '~/Pictures';
  if (GOOGLE_DRIVE_ROOT_RE.test(lower)) return 'google_drive';
  if (lower === 'computer' || lower === 'mac' || lower === 'laptop' || lower === 'home folder' || lower === 'home directory' || lower === 'files') return '~';
  return value.trim();
}

function cleanFileSearchQuery(value: string): string {
  const normalized = normalizeDesktopFileSearchQuery(value);
  if (normalized) return normalized;
  return value
    .replace(/\b(the|a|an|file|folder|image|photo|picture|document|named|called)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanAppQuery(value: string): string {
  return String(value || '')
    .replace(/\s+(?:and\s+then|then|and|after\s+that|next|also)\s+[\s\S]*$/i, '')
    .replace(/\s*,\s*[\s\S]*$/i, '')
    .replace(/\s+(?:app|application|program|window)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanOptionalShortcutAppQuery(value: string | undefined): string | undefined {
  const cleaned = cleanAppQuery(value || '');
  if (!cleaned || /^(?:the\s+)?(?:it|this|that|current|active|frontmost|app|application|program|window|document|file|tab|page|selection|clipboard)(?:\s+(?:is|to|has|be))?$/i.test(cleaned)) {
    return undefined;
  }
  return cleaned;
}

function looksLikeWebSurface(value: string): boolean {
  return /\b(website|webpage|site|page|tab|url|link|browser|wordpress|shopify|webflow|wix|squarespace|woocommerce|bigcommerce|framer|cms|admin panel|web app)\b/i.test(value);
}

function isBrowserAppQuery(value: string | undefined): boolean {
  return /^(chrome|google chrome|safari|brave|edge|microsoft edge|arc|opera|vivaldi|browser)$/i.test(String(value || '').trim());
}

function cleanUiTargetLabel(value: string): string {
  return String(value || '')
    .replace(/\b(the|a|an)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanTypedText(value: string): string {
  return String(value || '')
    .trim()
    .replace(/^["'`]|["'`]$/g, '')
    .trim();
}

function stripPhotoshopSuffix(value: string): string {
  return String(value || '')
    .replace(/\s+(?:in|inside|on|with|using)\s+(?:adobe\s+)?photoshop(?:\s+\d{4})?(?:\s+(?:app|application|window))?\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanPhotoshopPrompt(value: string | undefined): string {
  return stripPhotoshopSuffix(cleanTypedText(value || ''))
    .replace(/^(?:to\s+)?(?:add|insert|create|make|generate|replace|change|modify)\s+/i, '')
    .trim();
}

function hasPhotoshopGenerativeFillContext(text: string, currentApp?: string): boolean {
  const raw = String(text || '');
  const photoshopSurface = /\bphotoshop\b/i.test(raw) || Boolean(currentApp && /\bphotoshop\b/i.test(currentApp));
  if (PHOTOSHOP_GENERATIVE_FILL_CONTEXT_RE.test(raw)) return true;
  return photoshopSurface && PHOTOSHOP_GENERATIVE_FILL_ACTION_RE.test(raw) && PHOTOSHOP_REFERENCE_CUE_RE.test(raw);
}

function extractLoosePhotoshopReferenceFillPrompt(text: string): string {
  const raw = stripPhotoshopSuffix(String(text || '').trim());
  const addAtReference = raw.match(/^\s*(?:please\s+)?(?:(?:use|with)\s+(?:photoshop\s+)?(?:ai|firefly|generative\s+fill|gen\s*fill|ai\s+fill)\s+(?:to\s+)?)?(?:put|add|insert|place|generate|create|make)\s+([\s\S]{1,1200}?)\s+(?:where|in|inside|into|over|on|onto|to)\s+(?:(?:i|we)\s+)?(?:selected|highlighted|masked|brushed|painted|marked|circled|lassoed|drew|picked|chose|the\s+selected|the\s+highlighted|the\s+masked|the\s+brushed|the\s+painted|the\s+marked|the\s+circled|the\s+current|this|that|there|here)\b/i);
  if (addAtReference?.[1]) return cleanPhotoshopPrompt(addAtReference[1]);

  const referenceToPrompt = raw.match(/^\s*(?:please\s+)?(?:(?:use|with)\s+(?:photoshop\s+)?(?:ai|firefly|generative\s+fill|gen\s*fill|ai\s+fill)\s+(?:to\s+)?)?(?:make|turn|change|replace|transform|fill)\s+(?:(?:the\s+)?(?:selected|highlighted|masked|brushed|painted|marked|circled|lassoed|current)\s+(?:area|region|section|part|spot|selection|thing|object)?|(?:the\s+)?(?:area|spot|part|section|region|thing|object)\s+(?:i|we)\s+(?:selected|highlighted|brushed|painted|marked|circled|lassoed)|(?:it|that|this|there|here))\s+(?:with|to|into|as)\s+([\s\S]{1,1200}?)\s*$/i);
  if (referenceToPrompt?.[1]) return cleanPhotoshopPrompt(referenceToPrompt[1]);

  const referenceAdjectivePrompt = raw.match(/^\s*(?:please\s+)?(?:(?:use|with)\s+(?:photoshop\s+)?(?:ai|firefly|generative\s+fill|gen\s*fill|ai\s+fill)\s+(?:to\s+)?)?(?:make|turn|change|transform)\s+(?:(?:the\s+)?(?:selected|highlighted|masked|brushed|painted|marked|circled|lassoed|current)\s+(?:area|region|section|part|spot|selection|thing|object)?|(?:the\s+)?(?:area|spot|part|section|region|thing|object)\s+(?:i|we)\s+(?:selected|highlighted|brushed|painted|marked|circled|lassoed)|(?:it|that|this|there|here))\s+([\s\S]{2,1200}?)\s*$/i);
  if (referenceAdjectivePrompt?.[1]) return cleanPhotoshopPrompt(referenceAdjectivePrompt[1]);

  const promptForReference = raw.match(/^\s*(?:please\s+)?(?:generative\s+fill|gen\s*fill|firefly\s+fill|ai\s+fill)\s+(?:(?:the\s+)?(?:selected|highlighted|masked|brushed|painted|marked|circled|lassoed|current)\s+(?:area|region|section|part|spot|selection|thing|object)?|(?:it|that|this|there|here))\s+(?:with|to|into|as|for)\s+([\s\S]{1,1200}?)\s*$/i);
  if (promptForReference?.[1]) return cleanPhotoshopPrompt(promptForReference[1]);

  return '';
}

function isLoosePhotoshopReferenceRemoval(text: string): boolean {
  const raw = String(text || '');
  return /\b(?:remove|erase|delete|clear|clean\s+up|get\s+rid\s+of|take\s+out)\b/i.test(raw) &&
    PHOTOSHOP_REFERENCE_CUE_RE.test(raw);
}

export type PhotoshopGenerativeFillClarification = {
  route: boolean;
  question: string;
  missing: Array<'target_area' | 'fill_prompt'>;
  suggestions: string[];
  reason: string;
};

export function buildPhotoshopGenerativeFillClarification(
  message: string,
  currentApp?: string,
): PhotoshopGenerativeFillClarification {
  const raw = String(message || '').trim();
  if (!raw || !hasPhotoshopGenerativeFillContext(raw, currentApp)) {
    return { route: false, question: '', missing: [], suggestions: [], reason: 'not-photoshop-generative-fill' };
  }
  if (PHOTOSHOP_REPLACE_BACKGROUND_RE.test(raw) || PHOTOSHOP_RECTANGLE_GENERATIVE_FILL_RE.test(raw) || PHOTOSHOP_SELECTION_BRUSH_GENERATIVE_FILL_RE.test(raw)) {
    return { route: false, question: '', missing: [], suggestions: [], reason: 'deterministic-photoshop-generative-fill' };
  }

  const hasArea = PHOTOSHOP_REFERENCE_CUE_RE.test(raw) ||
    /\b(?:background|sky|subject)\b/i.test(raw) ||
    /\b\d{1,5}\s*,\s*\d{1,5}\s+(?:to|and)\s+\d{1,5}\s*,\s*\d{1,5}\b/i.test(raw);
  const isRemoval = /\b(?:remove|erase|delete|clear|clean\s+up|get\s+rid\s+of|take\s+out)\b/i.test(raw);
  const prompt = extractLoosePhotoshopReferenceFillPrompt(raw) ||
    cleanPhotoshopPrompt((raw.match(/\b(?:with|to|into|as|using|for)\s+([\s\S]{2,1200})$/i) || [])[1]);
  const hasPrompt = isRemoval || Boolean(prompt);
  const missing: Array<'target_area' | 'fill_prompt'> = [];
  if (!hasArea) missing.push('target_area');
  if (!hasPrompt) missing.push('fill_prompt');
  if (missing.length === 0) {
    return { route: false, question: '', missing: [], suggestions: [], reason: 'ready' };
  }

  const question = missing.length === 2
    ? 'What area should I select in Photoshop, and what should Generative Fill create there? You can say “selected area”, give coordinates like “from 120,220 to 520,620”, or say “remove it”.'
    : missing[0] === 'target_area'
      ? 'Which Photoshop area should I apply Generative Fill to? Say “selected area”, “highlighted area”, “use selection brush from x,y to x,y”, or give a rectangular area like “from 120,220 to 520,620”.'
      : 'What should Photoshop Generative Fill create in that area? If you want the selected object removed, say “remove it”.';
  return {
    route: true,
    question,
    missing,
    suggestions: [
      'Open Photoshop and fill selected area with neon glass flowers',
      'Open Photoshop and remove highlighted section with generative fill',
      'Open Photoshop and select area from 100,200 to 500,650 then generative fill with sunset water',
      'Open Photoshop and use selection brush from 120,220 to 520,620 then generative fill with mossy stone texture',
    ],
    reason: 'photoshop-generative-fill-needs-clarification',
  };
}

export type InDesignBannerClarification = {
  route: boolean;
  question: string;
  missing: Array<'banner_target' | 'change_details'>;
  suggestions: string[];
  reason: string;
};

function stripInDesignLauncherPrefix(value: string): string {
  return String(value || '')
    .replace(/^\s*(?:please\s+)?(?:open|launch|focus|switch\s+to|bring\s+up)\s+(?:adobe\s+)?indesign(?:\s+\d{4})?(?:\s+(?:and|then))?\s*/i, '')
    .replace(/\s+(?:in|inside|on|with|using)\s+(?:adobe\s+)?indesign(?:\s+\d{4})?(?:\s+(?:app|application|window))?\s*$/i, '')
    .trim();
}

function hasInDesignBannerContext(raw: string, currentApp?: string): boolean {
  const appContext = /\bindesign\b/i.test(currentApp || '') || /\bindesign|in\s*design\b/i.test(raw);
  const designContext = /\b(?:banners?|display\s+ads?|ads?|creatives?|campaigns?|dealership|dealer|automotive|vehicle|car\s+dealership|hero|headline|cta|offer|logo|background|disclaimer|legal|fine\s+print|lease|apr|finance|payment|sale\s+price|msrp|stock\s+number|vin|rebate|incentive|placed\s+(?:psd|pdf|ai|graphic)|object\s+layer\s+options|layer\s+comp|data\s+merge|variable\s+(?:layout|banner|ad|creative)|versioned\s+(?:layout|banner|ad|creative))\b/i.test(raw);
  return appContext && designContext;
}

function isDeterministicInDesignBannerRequest(raw: string): boolean {
  const text = stripInDesignLauncherPrefix(raw);
  const hasDocumentWorkflow = findInDesignDocumentReference(raw) !== null &&
    /\b(?:open|load|change|update|replace|set|make|prep|prepare|proof|audit|export|save|place|select|move|generate|generative|insert|package)\b/i.test(raw);
  return hasDocumentWorkflow ||
    INDESIGN_BANNER_WORKSPACE_RE.test(text) ||
    INDESIGN_OBJECT_LAYER_OPTIONS_RE.test(text) ||
    INDESIGN_PLACED_LAYER_VARIANT_RE.test(text) ||
    INDESIGN_BANNER_TEXT_RE.test(text) ||
    INDESIGN_BANNER_ASSET_PLACE_RE.test(text) ||
    INDESIGN_BANNER_EXPORT_RE.test(text) ||
    INDESIGN_BANNER_DATA_MERGE_RE.test(text) ||
    INDESIGN_BANNER_ALTERNATE_LAYOUT_RE.test(text) ||
    INDESIGN_DEALER_BANNER_TEXT_RE.test(text) ||
    INDESIGN_DEALER_FIND_REPLACE_RE.test(text) ||
    extractInDesignBatchFindChangePairs(text).length >= 2 ||
    INDESIGN_SIMPLE_FIND_CHANGE_RE.test(text) ||
    INDESIGN_DOCUMENT_STATUS_RE.test(text) ||
    INDESIGN_DEALER_PRODUCTION_CHECK_RE.test(text) ||
    INDESIGN_SELECT_LAYER_RE.test(text) ||
    INDESIGN_MOVE_SELECTION_TO_LAYER_RE.test(text) ||
    INDESIGN_PLACE_FILE_ON_LAYER_RE.test(text) ||
    INDESIGN_APPLY_STYLE_RE.test(text) ||
    INDESIGN_RESIZE_SELECTION_RE.test(text) ||
    INDESIGN_ALIGN_SELECTION_RE.test(text) ||
    INDESIGN_TEXT_ALIGN_RE.test(text) ||
    INDESIGN_TEXT_CASE_RE.test(text) ||
    INDESIGN_RELINK_FILE_RE.test(text) ||
    INDESIGN_PROOF_EXPORT_RE.test(text) ||
    INDESIGN_PACKAGE_HANDOFF_RE.test(text) ||
    INDESIGN_DATA_MERGE_SOURCE_RE.test(text) ||
    INDESIGN_DATA_MERGE_PREVIEW_RE.test(text) ||
    INDESIGN_DATA_MERGE_CREATE_RE.test(text) ||
    INDESIGN_LINKS_ACTION_RE.test(text) ||
    INDESIGN_SELECTED_OBJECT_ACTION_RE.test(text) ||
    INDESIGN_LAYER_ACTION_RE.test(text) ||
    INDESIGN_EXPORT_PAGE_RANGE_RE.test(text) ||
    INDESIGN_NEW_DOCUMENT_SIZE_RE.test(text) ||
    INDESIGN_DOCUMENT_SIZE_RE.test(text) ||
    INDESIGN_SET_BLEED_RE.test(text) ||
    INDESIGN_SET_MARGINS_RE.test(text) ||
    INDESIGN_SET_COLUMNS_RE.test(text) ||
    INDESIGN_NEW_LAYER_RE.test(text) ||
    INDESIGN_RENAME_LAYER_RE.test(text) ||
    INDESIGN_NEW_SWATCH_RE.test(text) ||
    INDESIGN_APPLY_SWATCH_RE.test(text) ||
    INDESIGN_TEXT_WRAP_RE.test(text) ||
    INDESIGN_EXPORT_NAMED_PRESET_RE.test(text) ||
    INDESIGN_APPLY_PARENT_RE.test(text) ||
    INDESIGN_CREATE_GUIDES_RE.test(text) ||
    extractInDesignDealerMultiUpdates(text).length > 0;
}

function hasSpecificInDesignBannerTarget(raw: string): boolean {
  return /\b(?:selected|current|active|this|that|page\s+\d+|spread|layer\s+["'`]?[a-z0-9 _.-]{2,}|headline|title|body\s+copy|copy|cta|button|offer|price|sale\s+price|msrp|legal|disclaimer|fine\s+print|lease|apr|finance|payment|model|year|trim|stock\s+number|vin|rebate|incentive|dealer(?:ship)?\s+name|phone|website|url|image|photo|graphic|logo|background|hero|asset|placed\s+(?:psd|pdf|ai|graphic)|object\s+layer\s+options|layer\s+comp|data\s+merge|variant|version|alternate\s+layout|workspace|workflow)\b/i.test(raw);
}

function hasConcreteInDesignBannerChange(raw: string): boolean {
  const text = stripInDesignLauncherPrefix(raw);
  if (isDeterministicInDesignBannerRequest(text)) return true;
  if (/\b(?:prep|prepare|set\s+up|setup|open|show|export|save|package|preflight|data\s+merge|alternate\s+layout|create\s+variant|make\s+variant|relink|update\s+links?|proof|handoff|group|ungroup|lock|unlock|duplicate|align|resize|style|document size|page size|bleed|margins?|columns?|swatch|color|text wrap|parent page|master page|guides?)\b/i.test(text)) return true;
  if (/(?:~\/|\/|\.\/|\.\.\/)\S+|\b\S+\.(?:psd|ai|pdf|png|jpe?g|webp|tiff?|indd)\b/i.test(text)) return true;
  if (/\b(?:to|as|with|using)\s+["'`]?[^"'`\n\r]{2,}/i.test(text) && !/\b(?:better|good|nice|cool|clean|professional|awesome)\s*[.!?]?\s*$/i.test(text)) return true;
  return false;
}

export function buildInDesignBannerClarification(
  message: string,
  currentApp?: string,
): InDesignBannerClarification {
  const raw = String(message || '').trim();
  if (!raw || !hasInDesignBannerContext(raw, currentApp)) {
    return { route: false, question: '', missing: [], suggestions: [], reason: 'not-indesign-banner' };
  }
  if (/^\s*(?:how|what|why|explain|research|plan|ideas?|ways?|can\s+you\s+explain)\b/i.test(raw)) {
    return { route: false, question: '', missing: [], suggestions: [], reason: 'informational-indesign-banner-request' };
  }
  if (isDeterministicInDesignBannerRequest(raw)) {
    return { route: false, question: '', missing: [], suggestions: [], reason: 'deterministic-indesign-banner' };
  }

  const missing: Array<'banner_target' | 'change_details'> = [];
  if (!hasSpecificInDesignBannerTarget(raw)) missing.push('banner_target');
  if (!hasConcreteInDesignBannerChange(raw)) missing.push('change_details');
  if (missing.length === 0) {
    return { route: false, question: '', missing: [], suggestions: [], reason: 'ready' };
  }

  const question = missing.length === 2
    ? 'Which InDesign banner layer or element should I change, and what exact change should I make? Give me the selected frame, layer name, headline/CTA/body copy, image path, or export target.'
    : missing[0] === 'banner_target'
      ? 'Which InDesign banner layer or element should I target? You can say selected banner image, headline, CTA, background, a layer name, or placed PSD layer options.'
      : 'What exact InDesign banner change should I make? You can give the replacement copy, asset path, layer variant, export filename, or ask me to prep the banner workflow.';
  return {
    route: true,
    question,
    missing,
    suggestions: [
      'Open InDesign and prep banner workflow',
      'Open InDesign and set selected banner headline to Spring Sale',
      'Open InDesign and replace selected banner image with ~/Desktop/hero.png',
      'Open InDesign and show object layer options for selected graphic',
      'Open InDesign and set up variable banners with data merge',
    ],
    reason: 'indesign-banner-needs-clarification',
  };
}

function photoshopMenu(menuPath: string[], reason: string): LocalComputerAwarenessIntent {
  return {
    route: true,
    kind: 'menu_click',
    menuPath,
    targetLabel: menuPath.join(' > '),
    reason,
  };
}

function photoshopClick(targetLabel: string, reason: string): LocalComputerAwarenessIntent {
  return { route: true, kind: 'semantic_click', targetLabel, reason };
}

function photoshopKey(combo: string, reason: string): LocalComputerAwarenessIntent {
  return { route: true, kind: 'press_keys', combo, reason };
}

function photoshopWait(durationMs: number): LocalComputerAwarenessIntent {
  return { route: true, kind: 'wait', durationMs, reason: 'local-wait' };
}

function photoshopSetField(targetLabel: string, text: string): LocalComputerAwarenessIntent {
  return { route: true, kind: 'set_field_text', targetLabel, text, reason: 'local-set-field-text' };
}

function photoshopPastePrompt(prompt: string): LocalComputerAwarenessIntent {
  return { route: true, kind: 'paste_text', text: prompt, reason: 'local-photoshop-ai-prompt' };
}

function photoshopMouseDrag(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  reason: string,
): LocalComputerAwarenessIntent {
  return { route: true, kind: 'mouse_drag', fromX, fromY, toX, toY, durationMs: 350, reason };
}

function photoshopConfirmDialog(): LocalComputerAwarenessIntent {
  return photoshopKey('Return', 'local-confirm-dialog-shortcut');
}

function designPresetDimensions(preset: string): { width: string; height: string; resolution: string; label: string } {
  const normalized = preset.toLowerCase().replace(/\s+/g, ' ').trim();
  if (/instagram story/.test(normalized)) return { width: '1080', height: '1920', resolution: '72', label: 'Instagram Story' };
  if (/youtube thumbnail/.test(normalized)) return { width: '1280', height: '720', resolution: '72', label: 'YouTube Thumbnail' };
  if (/facebook ad|linkedin post|web hero|website hero/.test(normalized)) return { width: '1920', height: '1080', resolution: '72', label: 'Web Hero' };
  if (/desktop wallpaper/.test(normalized)) return { width: '2560', height: '1440', resolution: '72', label: 'Desktop Wallpaper' };
  if (/poster/.test(normalized)) return { width: '2400', height: '3600', resolution: '300', label: 'Poster' };
  if (/flyer|letter flyer/.test(normalized)) return { width: '2550', height: '3300', resolution: '300', label: 'Flyer' };
  return { width: '1080', height: '1080', resolution: '72', label: 'Instagram Square' };
}

function photoshopNewDocumentPresetActions(
  preset: { width: string; height: string; resolution: string; label: string },
): LocalComputerAwarenessIntent[] {
  return [
    photoshopKey('Cmd+N', 'local-new-document-shortcut'),
    photoshopWait(800),
    photoshopSetField('Width', preset.width),
    photoshopSetField('Height', preset.height),
    photoshopSetField('Resolution', preset.resolution),
    photoshopClick('Create', `local-photoshop-create-${preset.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`),
    photoshopWait(1200),
  ];
}

function photoshopOpenGenerativeFillActions(prompt?: string): LocalComputerAwarenessIntent[] {
  const cleanPrompt = cleanPhotoshopPrompt(prompt);
  return [
    photoshopMenu(['Edit', 'Generative Fill...'], 'local-photoshop-generative-fill'),
    photoshopWait(1200),
    ...(cleanPrompt ? [photoshopPastePrompt(cleanPrompt)] : []),
    photoshopClick('Generate', 'local-photoshop-ai-generate'),
    photoshopWait(2500),
  ];
}

function photoshopRectangularSelectionActions(
  fromX: string,
  fromY: string,
  toX: string,
  toY: string,
): LocalComputerAwarenessIntent[] {
  return [
    photoshopKey('M', 'local-photoshop-rectangular-marquee-tool'),
    photoshopWait(250),
    photoshopMouseDrag(Number(fromX), Number(fromY), Number(toX), Number(toY), 'local-photoshop-rectangular-selection-drag'),
    photoshopWait(500),
  ];
}

function photoshopSelectionBrushStrokeActions(
  fromX: string,
  fromY: string,
  toX: string,
  toY: string,
): LocalComputerAwarenessIntent[] {
  return [
    photoshopClick('Selection Brush Tool', 'local-photoshop-selection-brush-tool'),
    photoshopWait(500),
    photoshopMouseDrag(Number(fromX), Number(fromY), Number(toX), Number(toY), 'local-photoshop-selection-brush-drag'),
    photoshopWait(350),
  ];
}

function photoshopNeuralFilterActions(filterLabel: string, reason: string): LocalComputerAwarenessIntent[] {
  return [
    photoshopMenu(['Filter', 'Neural Filters...'], 'local-photoshop-neural-filters'),
    photoshopWait(1200),
    photoshopClick(filterLabel, reason),
    photoshopWait(800),
  ];
}

function fileDialogPathEntry(targetPath: string): LocalComputerAwarenessIntent[] {
  if (isPathish(targetPath)) {
    return [
      photoshopKey('Cmd+Shift+G', 'local-file-dialog-go-to-path'),
      photoshopWait(300),
      { route: true, kind: 'paste_text', text: targetPath, reason: 'local-file-dialog-path' },
      photoshopKey('Return', 'local-confirm-dialog-shortcut'),
      photoshopWait(500),
      photoshopKey('Return', 'local-confirm-dialog-shortcut'),
    ];
  }
  return [
    { route: true, kind: 'paste_text', text: targetPath, reason: 'local-file-dialog-path' },
    photoshopKey('Return', 'local-confirm-dialog-shortcut'),
  ];
}

function withStandalonePhotoshopContext(
  actions: LocalComputerAwarenessIntent[],
  currentApp: string | undefined,
  rawText: string,
): LocalComputerAwarenessIntent[] {
  if (currentApp && /\bphotoshop\b/i.test(currentApp)) return actions;
  const shouldTargetPhotoshop = /\bphotoshop\b/i.test(rawText) ||
    /\b(generative fill|gen\s*fill|generative expand|content-aware fill|firefly|photoshop ai|ai fill|inpaint|selected area|highlighted area|current selection|part i selected|area i selected|thing i selected|where i highlighted|where i selected|circled|lassoed|selection brush|marquee|rectangular selection|select subject|select sky|select object|color range|remove background|replace background|ai edit|style transfer|smart portrait|skin smoothing|harmonize|neural filters?|camera raw|auto tone|auto contrast|auto color|smart object|clipping mask|adjustment layer|image processor|save for web|export layers to files|layer comps to files|select and mask|sky replacement|puppet warp|perspective warp|actions panel|layers panel|timeline panel|instagram post|instagram story|youtube thumbnail|web hero|poster|flyer)\b/i.test(rawText);
  if (!shouldTargetPhotoshop) return [];
  return [
    { route: true, kind: 'focus_app', appQuery: 'Photoshop', reason: 'local-focus-app' },
    ...actions.map((action) => action.kind === 'wait' || action.appQuery ? action : { ...action, appQuery: 'Photoshop' }),
  ];
}

function expandPhotoshopTaskMacro(step: string, currentApp?: string): LocalComputerAwarenessIntent[] {
  const text = stripPhotoshopSuffix(step);
  const resizeImage = text.match(PHOTOSHOP_RESIZE_IMAGE_RE);
  if (resizeImage?.[1] && resizeImage[2]) {
    return withStandalonePhotoshopContext([
      photoshopMenu(['Image', 'Image Size...'], 'local-photoshop-image-size'),
      photoshopWait(700),
      photoshopSetField('Width', resizeImage[1]),
      photoshopSetField('Height', resizeImage[2]),
      photoshopKey('Return', 'local-confirm-dialog-shortcut'),
    ], currentApp, step);
  }

  const canvasSize = text.match(PHOTOSHOP_CANVAS_SIZE_RE);
  if (canvasSize?.[1] && canvasSize[2]) {
    return withStandalonePhotoshopContext([
      photoshopMenu(['Image', 'Canvas Size...'], 'local-photoshop-canvas-size'),
      photoshopWait(700),
      photoshopSetField('Width', canvasSize[1]),
      photoshopSetField('Height', canvasSize[2]),
      photoshopKey('Return', 'local-confirm-dialog-shortcut'),
    ], currentApp, step);
  }

  const resolution = text.match(PHOTOSHOP_RESOLUTION_RE);
  if (resolution?.[1]) {
    return withStandalonePhotoshopContext([
      photoshopMenu(['Image', 'Image Size...'], 'local-photoshop-image-size-resolution'),
      photoshopWait(700),
      photoshopSetField('Resolution', resolution[1]),
      photoshopKey('Return', 'local-confirm-dialog-shortcut'),
    ], currentApp, step);
  }

  const saveForWebFile = text.match(PHOTOSHOP_SAVE_FOR_WEB_FILE_RE);
  if (saveForWebFile) {
    const filename = cleanTypedText(saveForWebFile[1] || '');
    if (filename && /\.(?:png|jpe?g)$/i.test(filename)) {
      return withStandalonePhotoshopContext(buildPhotoshopSaveForWebExportActions(filename), currentApp, step);
    }
    return withStandalonePhotoshopContext([
      photoshopKey('Cmd+Opt+Shift+S', 'local-save-for-web-shortcut'),
      photoshopWait(1500),
      ...(filename ? [
        photoshopClick('Save', 'local-save-for-web-save-button'),
        photoshopWait(1000),
        { route: true, kind: 'paste_text', text: filename, reason: 'local-save-dialog-filename' } as LocalComputerAwarenessIntent,
        photoshopKey('Return', 'local-confirm-dialog-shortcut'),
      ] : []),
    ], currentApp, step);
  }

  const exportAsFile = text.match(PHOTOSHOP_EXPORT_PROOF_RE) || text.match(PHOTOSHOP_EXPORT_AS_FILE_RE);
  if (exportAsFile?.[1]) {
    const filename = cleanTypedText(exportAsFile[1]);
    if (/\.(?:png|jpe?g)$/i.test(filename)) {
      return withStandalonePhotoshopContext([
        {
          route: true,
          kind: 'photoshop_export_proof',
          outputPath: filename,
          format: /\.jpe?g$/i.test(filename) ? 'jpg' : 'png',
          reason: 'local-photoshop-export-proof',
        },
      ], currentApp, step);
    }
    return withStandalonePhotoshopContext([
      photoshopMenu(['File', 'Export', 'Export As...'], 'local-photoshop-export-as'),
      photoshopWait(1000),
      photoshopClick('Export', 'local-photoshop-export-confirm'),
      photoshopWait(900),
      { route: true, kind: 'paste_text', text: filename, reason: 'local-save-dialog-filename' },
      photoshopKey('Return', 'local-confirm-dialog-shortcut'),
    ], currentApp, step);
  }

  const layerAction = text.match(PHOTOSHOP_LAYER_ACTION_RE);
  if (layerAction?.[1] && layerAction[2]) {
    return withStandalonePhotoshopContext([
      {
        route: true,
        kind: 'photoshop_set_layer_state',
        appQuery: 'Photoshop',
        targetLabel: cleanTypedText(layerAction[2]),
        layerStateAction: normalizeInDesignLayerStateAction(layerAction[1]),
        reason: 'local-photoshop-set-layer-state',
      },
    ], currentApp, step);
  }

  const openFile = text.match(PHOTOSHOP_OPEN_FILE_RE);
  if (openFile) {
    const targetPath = cleanFileDialogPathMatch(openFile);
    return withStandalonePhotoshopContext([
      photoshopMenu(['File', 'Open...'], 'local-photoshop-open-file'),
      photoshopWait(800),
      ...fileDialogPathEntry(targetPath),
    ], currentApp, step);
  }

  const placeFile = text.match(PHOTOSHOP_PLACE_FILE_RE);
  if (placeFile) {
    const targetPath = cleanFileDialogPathMatch(placeFile);
    return withStandalonePhotoshopContext([
      {
        route: true,
        kind: 'photoshop_place_asset',
        assetPath: targetPath,
        reason: 'local-photoshop-place-asset',
      },
    ], currentApp, step);
  }

  const brushFill = text.match(PHOTOSHOP_SELECTION_BRUSH_GENERATIVE_FILL_RE);
  if (brushFill?.[1] && brushFill[2] && brushFill[3] && brushFill[4]) {
    const isRemove = /\b(remove|erase|delete)\b/i.test(text);
    const prompt = isRemove ? '' : cleanPhotoshopPrompt(brushFill[5]);
    return withStandalonePhotoshopContext([
      ...photoshopSelectionBrushStrokeActions(brushFill[1], brushFill[2], brushFill[3], brushFill[4]),
      ...photoshopOpenGenerativeFillActions(prompt),
    ], currentApp, step);
  }

  const brushSelect = text.match(PHOTOSHOP_SELECTION_BRUSH_DRAG_RE);
  if (brushSelect?.[1] && brushSelect[2] && brushSelect[3] && brushSelect[4]) {
    return withStandalonePhotoshopContext([
      ...photoshopSelectionBrushStrokeActions(brushSelect[1], brushSelect[2], brushSelect[3], brushSelect[4]),
    ], currentApp, step);
  }

  const rectFill = text.match(PHOTOSHOP_RECTANGLE_GENERATIVE_FILL_RE);
  if (rectFill?.[1] && rectFill[2] && rectFill[3] && rectFill[4]) {
    const isRemove = /\b(remove|erase|delete)\b/i.test(text);
    const prompt = isRemove ? '' : cleanPhotoshopPrompt(rectFill[5]);
    return withStandalonePhotoshopContext([
      ...photoshopRectangularSelectionActions(rectFill[1], rectFill[2], rectFill[3], rectFill[4]),
      ...photoshopOpenGenerativeFillActions(prompt),
    ], currentApp, step);
  }

  const rectSelect = text.match(PHOTOSHOP_RECTANGLE_SELECT_RE);
  if (rectSelect?.[1] && rectSelect[2] && rectSelect[3] && rectSelect[4]) {
    return withStandalonePhotoshopContext([
      ...photoshopRectangularSelectionActions(rectSelect[1], rectSelect[2], rectSelect[3], rectSelect[4]),
    ], currentApp, step);
  }

  const looseReferencePrompt = extractLoosePhotoshopReferenceFillPrompt(text);
  if (looseReferencePrompt) {
    return withStandalonePhotoshopContext([
      ...photoshopOpenGenerativeFillActions(looseReferencePrompt),
    ], currentApp, step);
  }

  if (isLoosePhotoshopReferenceRemoval(text)) {
    return withStandalonePhotoshopContext([
      ...photoshopOpenGenerativeFillActions(''),
    ], currentApp, step);
  }

  const socialCanvas = text.match(PHOTOSHOP_SOCIAL_CANVAS_RE);
  if (socialCanvas?.[1]) {
    const preset = designPresetDimensions(socialCanvas[1]);
    const prompt = cleanPhotoshopPrompt(socialCanvas[2]);
    return withStandalonePhotoshopContext([
      ...photoshopNewDocumentPresetActions(preset),
      ...(prompt ? [
        photoshopClick('Generate Image', 'local-photoshop-generate-image'),
        photoshopWait(1000),
        photoshopPastePrompt(prompt),
        photoshopClick('Generate', 'local-photoshop-ai-generate'),
        photoshopWait(2500),
      ] : [
        photoshopMenu(['Window', 'Contextual Task Bar'], 'local-photoshop-contextual-task-bar'),
      ]),
    ], currentApp, step);
  }

  if (PHOTOSHOP_SELECTION_BRUSH_PREP_RE.test(text)) {
    return withStandalonePhotoshopContext([
      photoshopClick('Selection Brush Tool', 'local-photoshop-selection-brush-tool'),
      photoshopWait(500),
      photoshopMenu(['Window', 'Contextual Task Bar'], 'local-photoshop-contextual-task-bar'),
    ], currentApp, step);
  }

  const replaceBackground = text.match(PHOTOSHOP_REPLACE_BACKGROUND_RE);
  if (replaceBackground?.[1]) {
    const prompt = cleanPhotoshopPrompt(replaceBackground[1]);
    return withStandalonePhotoshopContext([
      photoshopMenu(['Select', 'Subject'], 'local-photoshop-select-subject'),
      photoshopWait(1500),
      photoshopMenu(['Select', 'Inverse'], 'local-photoshop-select-inverse'),
      photoshopWait(400),
      ...photoshopOpenGenerativeFillActions(prompt),
    ], currentApp, step);
  }

  if (PHOTOSHOP_REMOVE_SELECTED_AREA_RE.test(text)) {
    return withStandalonePhotoshopContext([
      ...photoshopOpenGenerativeFillActions(''),
    ], currentApp, step);
  }

  const removeObjectAi = text.match(PHOTOSHOP_REMOVE_OBJECT_AI_RE);
  if (removeObjectAi) {
    return withStandalonePhotoshopContext([
      ...photoshopOpenGenerativeFillActions(''),
    ], currentApp, step);
  }

  const aiEditImage = text.match(PHOTOSHOP_AI_EDIT_IMAGE_RE);
  if (aiEditImage?.[1]) {
    return withStandalonePhotoshopContext([
      ...photoshopOpenGenerativeFillActions(aiEditImage[1]),
    ], currentApp, step);
  }

  const selectedAreaFill = text.match(PHOTOSHOP_SELECTED_AREA_GENERATIVE_FILL_RE);
  if (selectedAreaFill) {
    const prompt = cleanPhotoshopPrompt(selectedAreaFill[1] || selectedAreaFill[2] || '');
    return withStandalonePhotoshopContext([
      ...photoshopOpenGenerativeFillActions(prompt),
    ], currentApp, step);
  }

  const shortSelectionFill = text.match(PHOTOSHOP_SHORT_SELECTION_FILL_RE);
  if (shortSelectionFill?.[1]) {
    return withStandalonePhotoshopContext([
      ...photoshopOpenGenerativeFillActions(shortSelectionFill[1]),
    ], currentApp, step);
  }

  const generativeFill = text.match(PHOTOSHOP_GENERATIVE_FILL_RE) || text.match(PHOTOSHOP_GENERATIVE_FILL_NATURAL_RE);
  if (generativeFill) {
    const rawPrompt = cleanPhotoshopPrompt(generativeFill[1]);
    const prompt = /\b(remove|erase|delete)\b/i.test(text) && !/\b(with|using|replace|add|insert)\b/i.test(text) ? '' : rawPrompt;
    return withStandalonePhotoshopContext([
      ...photoshopOpenGenerativeFillActions(prompt),
    ], currentApp, step);
  }

  const generateImage = text.match(PHOTOSHOP_GENERATE_IMAGE_RE);
  if (generateImage?.[1] && /\b(?:generate|create|make)\b/i.test(text)) {
    const prompt = cleanPhotoshopPrompt(generateImage[1]);
    return withStandalonePhotoshopContext([
      photoshopKey('Cmd+N', 'local-new-document-shortcut'),
      photoshopWait(800),
      photoshopClick('Create', 'local-photoshop-create-document'),
      photoshopWait(1200),
      photoshopClick('Generate Image', 'local-photoshop-generate-image'),
      photoshopWait(1000),
      photoshopPastePrompt(prompt),
      photoshopClick('Generate', 'local-photoshop-ai-generate'),
      photoshopWait(2500),
    ], currentApp, step);
  }

  const generativeExpand = text.match(PHOTOSHOP_GENERATIVE_EXPAND_RE);
  if (generativeExpand) {
    const prompt = cleanPhotoshopPrompt(generativeExpand[1]);
    return withStandalonePhotoshopContext([
      photoshopKey('C', 'local-photoshop-crop-tool'),
      photoshopWait(700),
      photoshopClick('Generative Expand', 'local-photoshop-generative-expand'),
      photoshopWait(800),
      ...(prompt ? [photoshopPastePrompt(prompt)] : []),
      photoshopClick('Generate', 'local-photoshop-ai-generate'),
      photoshopWait(2000),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:harmoni[sz]e|match\s+(?:the\s+)?lighting|match\s+(?:the\s+)?color)\s+(?:the\s+)?(?:selected\s+)?(?:subject|object|layer|selection)(?:\s+(?:with|to)\s+(?:the\s+)?background)?\s*$/i.test(text)) {
    return withStandalonePhotoshopContext([
      photoshopMenu(['Window', 'Contextual Task Bar'], 'local-photoshop-contextual-task-bar'),
      photoshopWait(500),
      photoshopClick('Harmonize', 'local-photoshop-ai-harmonize'),
      photoshopWait(900),
      photoshopClick('Generate', 'local-photoshop-ai-generate'),
      photoshopWait(2000),
    ], currentApp, step);
  }

  const styleTransfer = text.match(PHOTOSHOP_STYLE_TRANSFER_RE);
  if (styleTransfer) {
    return withStandalonePhotoshopContext([
      ...photoshopNeuralFilterActions('Style Transfer', 'local-photoshop-style-transfer'),
      ...(styleTransfer[1] ? [photoshopPastePrompt(styleTransfer[1])] : []),
    ], currentApp, step);
  }

  const smartPortrait = text.match(PHOTOSHOP_SMART_PORTRAIT_RE);
  if (smartPortrait) {
    const label = /\bskin\s+smoothing\b/i.test(text)
      ? 'Skin Smoothing'
      : /\bcolorize\b/i.test(text)
        ? 'Colorize'
        : /\bdepth\s+blur\b/i.test(text)
          ? 'Depth Blur'
          : 'Smart Portrait';
    return withStandalonePhotoshopContext([
      ...photoshopNeuralFilterActions(label, `local-photoshop-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:select|choose|mask)\s+(?:the\s+)?subject\s*$/i.test(text)) {
    return withStandalonePhotoshopContext([
      photoshopMenu(['Select', 'Subject'], 'local-photoshop-select-subject'),
      photoshopWait(1200),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:select|choose|mask)\s+(?:the\s+)?(?:sky|object|focus\s+area|color\s+range)\s*$/i.test(text)) {
    const menuPath = /\bsky\b/i.test(text)
      ? ['Select', 'Sky']
      : /\bobject\b/i.test(text)
        ? ['Select', 'Object']
        : /\bfocus\s+area\b/i.test(text)
          ? ['Select', 'Focus Area...']
          : ['Select', 'Color Range...'];
    return withStandalonePhotoshopContext([
      photoshopMenu(menuPath, 'local-photoshop-select-helper'),
      photoshopWait(900),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:remove|delete|erase|cut\s+out)\s+(?:the\s+)?background\s*$/i.test(text)) {
    return withStandalonePhotoshopContext([
      photoshopMenu(['Select', 'Subject'], 'local-photoshop-select-subject'),
      photoshopWait(1500),
      photoshopClick('Remove Background', 'local-photoshop-remove-background'),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:use|run|open|apply)?\s*(?:content-aware|content aware)\s+fill\s*$/i.test(text)) {
    return withStandalonePhotoshopContext([
      photoshopMenu(['Edit', 'Content-Aware Fill...'], 'local-photoshop-content-aware-fill'),
      photoshopWait(1000),
      photoshopClick('OK', 'local-photoshop-confirm-content-aware-fill'),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:crop|select\s+(?:the\s+)?crop\s+tool|open\s+(?:the\s+)?crop\s+tool)(?:\s+(?:the\s+)?(?:image|photo|picture|document|canvas))?\s*$/i.test(text)) {
    return withStandalonePhotoshopContext([
      photoshopKey('C', 'local-photoshop-crop-tool'),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:apply|commit|confirm)\s+(?:the\s+)?crop\s*$/i.test(text)) {
    return withStandalonePhotoshopContext([
      photoshopKey('Return', 'local-photoshop-commit-crop'),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:free\s+transform|transform|scale|resize\s+(?:the\s+)?layer)(?:\s+(?:the\s+)?(?:current\s+)?(?:layer|selection|object))?\s*$/i.test(text)) {
    return withStandalonePhotoshopContext([
      photoshopKey('Cmd+T', 'local-photoshop-free-transform'),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:auto\s+tone|fix\s+tone)\s*$/i.test(text)) {
    return withStandalonePhotoshopContext([photoshopMenu(['Image', 'Auto Tone'], 'local-photoshop-auto-tone')], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:auto\s+contrast|fix\s+contrast)\s*$/i.test(text)) {
    return withStandalonePhotoshopContext([photoshopMenu(['Image', 'Auto Contrast'], 'local-photoshop-auto-contrast')], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:auto\s+color|fix\s+color)\s*$/i.test(text)) {
    return withStandalonePhotoshopContext([photoshopMenu(['Image', 'Auto Color'], 'local-photoshop-auto-color')], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:open|show|run|use)\s+(?:the\s+)?(?:neural\s+filters?|photoshop\s+neural\s+filters?)\s*$/i.test(text)) {
    return withStandalonePhotoshopContext([
      photoshopMenu(['Filter', 'Neural Filters...'], 'local-photoshop-neural-filters'),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:open|show|run|use)\s+(?:the\s+)?(?:camera\s+raw|camera\s+raw\s+filter)\s*$/i.test(text)) {
    return withStandalonePhotoshopContext([
      photoshopMenu(['Filter', 'Camera Raw Filter...'], 'local-photoshop-camera-raw'),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:show|open|toggle)\s+(?:the\s+)?contextual\s+task\s+bar\s*$/i.test(text)) {
    return withStandalonePhotoshopContext([
      photoshopMenu(['Window', 'Contextual Task Bar'], 'local-photoshop-contextual-task-bar'),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:open|show|use|run)?\s*(?:select\s+and\s+mask|select\s*&\s*mask)\s*$/i.test(text)) {
    return withStandalonePhotoshopContext([
      photoshopMenu(['Select', 'Select and Mask...'], 'local-photoshop-select-and-mask'),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:select|choose|use|switch\s+to|open)\s+(?:the\s+)?object\s+selection\s+tool\s*$/i.test(text)) {
    return withStandalonePhotoshopContext([
      photoshopKey('W', 'local-photoshop-object-selection-tool'),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:select|choose|use|switch\s+to|open)\s+(?:the\s+)?remove\s+tool\s*$/i.test(text)) {
    return withStandalonePhotoshopContext([
      photoshopKey('J', 'local-photoshop-remove-tool'),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:delete|remove|erase)\s+(?:and\s+)?fill\s+(?:the\s+)?(?:selection|selected\s+area|selected\s+object)\s*$/i.test(text)) {
    return withStandalonePhotoshopContext([
      photoshopMenu(['Edit', 'Delete and Fill Selection'], 'local-photoshop-delete-fill-selection'),
      photoshopWait(1200),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:new|create|add)\s+(?:a\s+)?(?:blank\s+)?layer\s*$/i.test(text)) {
    return withStandalonePhotoshopContext([
      photoshopKey('Cmd+Shift+N', 'local-photoshop-new-layer'),
      photoshopWait(500),
      photoshopKey('Return', 'local-confirm-dialog-shortcut'),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:new|create|add)\s+(?:an?\s+)?artboard\s*$/i.test(text)) {
    return withStandalonePhotoshopContext([
      photoshopMenu(['Layer', 'New', 'Artboard...'], 'local-photoshop-new-artboard'),
      photoshopWait(600),
      photoshopKey('Return', 'local-confirm-dialog-shortcut'),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:duplicate|copy)\s+(?:the\s+)?(?:current\s+)?layer\s*$/i.test(text)) {
    return withStandalonePhotoshopContext([
      photoshopKey('Cmd+J', 'local-photoshop-duplicate-layer'),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:add|create|apply)\s+(?:a\s+)?(?:layer\s+)?mask(?:\s+(?:from|to)\s+(?:the\s+)?selection)?\s*$/i.test(text)) {
    return withStandalonePhotoshopContext([
      photoshopMenu(['Layer', 'Layer Mask', 'Reveal Selection'], 'local-photoshop-layer-mask-reveal-selection'),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:convert|make)\s+(?:the\s+)?(?:current\s+)?layer\s+(?:to|into)\s+(?:a\s+)?smart\s+object\s*$/i.test(text)) {
    return withStandalonePhotoshopContext([
      photoshopMenu(['Layer', 'Smart Objects', 'Convert to Smart Object'], 'local-photoshop-convert-smart-object'),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:flatten|merge)\s+(?:the\s+)?(?:image|document|layers?)\s*$/i.test(text)) {
    return withStandalonePhotoshopContext([
      photoshopMenu(['Layer', 'Flatten Image'], 'local-photoshop-flatten-image'),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:open|use|apply|run)?\s*(?:liquify|liquify\s+filter)\s*$/i.test(text)) {
    return withStandalonePhotoshopContext([
      photoshopMenu(['Filter', 'Liquify...'], 'local-photoshop-liquify'),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:open|use|apply|run)?\s*(?:gaussian\s+blur|blur\s+filter)\s*$/i.test(text)) {
    return withStandalonePhotoshopContext([
      photoshopMenu(['Filter', 'Blur', 'Gaussian Blur...'], 'local-photoshop-gaussian-blur'),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:open|use|apply|run)?\s*(?:smart\s+sharpen|sharpen\s+filter)\s*$/i.test(text)) {
    return withStandalonePhotoshopContext([
      photoshopMenu(['Filter', 'Sharpen', 'Smart Sharpen...'], 'local-photoshop-smart-sharpen'),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:open|use|apply|run)?\s*(?:dust\s+and\s+scratches|lens\s+correction|high\s+pass|puppet\s+warp|perspective\s+warp|sky\s+replacement)(?:\s+(?:filter|tool))?\s*$/i.test(text)) {
    const menuPath = /\blens\s+correction\b/i.test(text)
      ? ['Filter', 'Lens Correction...']
      : /\bhigh\s+pass\b/i.test(text)
        ? ['Filter', 'Other', 'High Pass...']
        : /\bpuppet\s+warp\b/i.test(text)
          ? ['Edit', 'Puppet Warp']
          : /\bperspective\s+warp\b/i.test(text)
            ? ['Edit', 'Perspective Warp']
            : /\bsky\s+replacement\b/i.test(text)
              ? ['Edit', 'Sky Replacement...']
              : ['Filter', 'Noise', 'Dust & Scratches...'];
    return withStandalonePhotoshopContext([
      photoshopMenu(menuPath, 'local-photoshop-retouch-transform-workflow'),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:add|create|open)\s+(?:a\s+)?curves(?:\s+adjustment)?(?:\s+layer)?\s*$/i.test(text)) {
    return withStandalonePhotoshopContext([
      photoshopMenu(['Layer', 'New Adjustment Layer', 'Curves...'], 'local-photoshop-curves-adjustment'),
      photoshopWait(500),
      photoshopKey('Return', 'local-confirm-dialog-shortcut'),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:add|create|open)\s+(?:a\s+)?levels(?:\s+adjustment)?(?:\s+layer)?\s*$/i.test(text)) {
    return withStandalonePhotoshopContext([
      photoshopMenu(['Layer', 'New Adjustment Layer', 'Levels...'], 'local-photoshop-levels-adjustment'),
      photoshopWait(500),
      photoshopKey('Return', 'local-confirm-dialog-shortcut'),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:add|create|open)\s+(?:a\s+)?(?:hue\s*\/?\s*saturation|hue\s+and\s+saturation)(?:\s+adjustment)?(?:\s+layer)?\s*$/i.test(text)) {
    return withStandalonePhotoshopContext([
      photoshopMenu(['Layer', 'New Adjustment Layer', 'Hue/Saturation...'], 'local-photoshop-hue-saturation-adjustment'),
      photoshopWait(500),
      photoshopKey('Return', 'local-confirm-dialog-shortcut'),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:add|create|open)\s+(?:a\s+)?(?:brightness\s*\/?\s*contrast|brightness\s+and\s+contrast)(?:\s+adjustment)?(?:\s+layer)?\s*$/i.test(text)) {
    return withStandalonePhotoshopContext([
      photoshopMenu(['Layer', 'New Adjustment Layer', 'Brightness/Contrast...'], 'local-photoshop-brightness-contrast-adjustment'),
      photoshopWait(500),
      photoshopKey('Return', 'local-confirm-dialog-shortcut'),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:add|create|open)\s+(?:a\s+)?(?:vibrance|exposure|black\s*&\s*white|black\s+and\s+white|color\s+balance|selective\s+color)(?:\s+adjustment)?(?:\s+layer)?\s*$/i.test(text)) {
    const adjustment = /\bvibrance\b/i.test(text)
      ? 'Vibrance...'
      : /\bexposure\b/i.test(text)
        ? 'Exposure...'
        : /\bblack\b/i.test(text)
          ? 'Black & White...'
          : /\bcolor\s+balance\b/i.test(text)
            ? 'Color Balance...'
            : 'Selective Color...';
    return withStandalonePhotoshopContext([
      photoshopMenu(['Layer', 'New Adjustment Layer', adjustment], `local-photoshop-${adjustment.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-adjustment`),
      photoshopWait(500),
      photoshopKey('Return', 'local-confirm-dialog-shortcut'),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:select\s+inverse|invert\s+(?:the\s+)?selection)\s*$/i.test(text)) {
    return withStandalonePhotoshopContext([
      photoshopMenu(['Select', 'Inverse'], 'local-photoshop-select-inverse'),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:deselect|clear\s+(?:the\s+)?selection)\s*$/i.test(text)) {
    return withStandalonePhotoshopContext([
      photoshopKey('Cmd+D', 'local-photoshop-deselect'),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:feather|soften)\s+(?:the\s+)?selection\s*$/i.test(text)) {
    return withStandalonePhotoshopContext([
      photoshopMenu(['Select', 'Modify', 'Feather...'], 'local-photoshop-feather-selection'),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:make|create|apply)\s+(?:a\s+)?clipping\s+mask\s*$/i.test(text)) {
    return withStandalonePhotoshopContext([
      photoshopMenu(['Layer', 'Create Clipping Mask'], 'local-photoshop-clipping-mask'),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:group|group\s+selected)\s+layers?\s*$/i.test(text)) {
    return withStandalonePhotoshopContext([
      photoshopKey('Cmd+G', 'local-photoshop-group-layers'),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:ungroup|ungroup\s+selected)\s+layers?\s*$/i.test(text)) {
    return withStandalonePhotoshopContext([
      photoshopKey('Cmd+Shift+G', 'local-photoshop-ungroup-layers'),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:merge\s+(?:selected\s+)?layers?|merge\s+down)\s*$/i.test(text)) {
    return withStandalonePhotoshopContext([
      photoshopKey('Cmd+E', 'local-photoshop-merge-layers'),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:merge\s+visible|stamp\s+visible)\s*$/i.test(text)) {
    return withStandalonePhotoshopContext([
      photoshopKey('Cmd+Shift+E', 'local-photoshop-merge-visible'),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:rasteri[sz]e)\s+(?:the\s+)?(?:current\s+)?layer\s*$/i.test(text)) {
    return withStandalonePhotoshopContext([
      photoshopMenu(['Layer', 'Rasterize', 'Layer'], 'local-photoshop-rasterize-layer'),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:convert|change|set)\s+(?:the\s+)?(?:image|document|file)?\s*(?:mode\s+)?(?:to\s+)?(rgb|cmyk|grayscale|grey\s*scale)\s*(?:color)?\s*$/i.test(text)) {
    const mode = /\bcmyk\b/i.test(text)
      ? 'CMYK Color'
      : /\bgr[ae]y\s*scale\b/i.test(text)
        ? 'Grayscale'
        : 'RGB Color';
    return withStandalonePhotoshopContext([
      photoshopMenu(['Image', 'Mode', mode], 'local-photoshop-image-mode'),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:open|show|toggle)\s+(?:the\s+)?(?:layers?|history|actions?|properties|libraries|adjustments|channels|paths|swatches|timeline|navigator|info|histogram|character|paragraph|glyphs|brushes|tool\s+presets)(?:\s+panel)?\s*$/i.test(text)) {
    const panel = /\bhistory\b/i.test(text)
      ? 'History'
      : /\bactions?\b/i.test(text)
        ? 'Actions'
        : /\bproperties\b/i.test(text)
          ? 'Properties'
          : /\blibraries\b/i.test(text)
            ? 'Libraries'
            : /\badjustments\b/i.test(text)
              ? 'Adjustments'
              : /\bchannels\b/i.test(text)
                ? 'Channels'
                : /\bpaths\b/i.test(text)
                  ? 'Paths'
                  : /\bswatches\b/i.test(text)
                    ? 'Swatches'
                    : /\btimeline\b/i.test(text)
                      ? 'Timeline'
                      : /\bnavigator\b/i.test(text)
                        ? 'Navigator'
                        : /\binfo\b/i.test(text)
                          ? 'Info'
                          : /\bhistogram\b/i.test(text)
                            ? 'Histogram'
                            : /\bcharacter\b/i.test(text)
                              ? 'Character'
                              : /\bparagraph\b/i.test(text)
                                ? 'Paragraph'
                                : /\bglyphs\b/i.test(text)
                                  ? 'Glyphs'
                                  : /\btool\s+presets\b/i.test(text)
                                    ? 'Tool Presets'
                                    : /\bbrushes\b/i.test(text)
                                      ? 'Brushes'
                    : 'Layers';
    return withStandalonePhotoshopContext([
      photoshopMenu(['Window', panel], 'local-photoshop-panel'),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:select|choose|use|switch\s+to|open)\s+(?:the\s+)?(?:move|brush|healing\s+brush|spot\s+healing\s+brush|clone\s+stamp|eyedropper|text|type|zoom|hand|pen|lasso|marquee)\s+tool\s*$/i.test(text)) {
    const combo = /\bmove\b/i.test(text)
      ? 'V'
      : /\bspot\s+healing|healing\s+brush\b/i.test(text)
        ? 'J'
        : /\bclone\s+stamp\b/i.test(text)
          ? 'S'
          : /\beyedropper\b/i.test(text)
            ? 'I'
            : /\btext|type\b/i.test(text)
              ? 'T'
              : /\bzoom\b/i.test(text)
                ? 'Z'
                : /\bhand\b/i.test(text)
                  ? 'H'
                  : /\bpen\b/i.test(text)
                    ? 'P'
                    : /\blasso\b/i.test(text)
                      ? 'L'
                      : /\bmarquee\b/i.test(text)
                        ? 'M'
                        : 'B';
    return withStandalonePhotoshopContext([
      photoshopKey(combo, 'local-photoshop-tool-shortcut'),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:(?:open|run|use)\s+(?:the\s+)?(?:image\s+processor|batch|contact\s+sheet|load\s+files\s+into\s+stack|export\s+layers\s+to\s+files|layer\s+comps\s+to\s+files)|export\s+(?:layers\s+to\s+files|layer\s+comps\s+to\s+files))(?:\s+(?:dialog|workflow|script))?\s*$/i.test(text)) {
    const menuPath = /\bbatch\b/i.test(text)
      ? ['File', 'Automate', 'Batch...']
      : /\bcontact\s+sheet\b/i.test(text)
        ? ['File', 'Automate', 'Contact Sheet II...']
        : /\bload\s+files\s+into\s+stack\b/i.test(text)
          ? ['File', 'Scripts', 'Load Files into Stack...']
          : /\bexport\s+layers\s+to\s+files\b/i.test(text)
            ? ['File', 'Export', 'Layers to Files...']
            : /\blayer\s+comps\s+to\s+files\b/i.test(text)
              ? ['File', 'Export', 'Layer Comps to Files...']
          : ['File', 'Scripts', 'Image Processor...'];
    return withStandalonePhotoshopContext([
      photoshopMenu(menuPath, 'local-photoshop-automation-workflow'),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:save\s+a\s+copy|save\s+copy)\s*$/i.test(text)) {
    return withStandalonePhotoshopContext([
      photoshopMenu(['File', 'Save a Copy...'], 'local-photoshop-save-copy'),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:open|show|use)\s+(?:export\s+as|export\s+as\s+dialog)\s*$/i.test(text)) {
    return withStandalonePhotoshopContext([
      photoshopMenu(['File', 'Export', 'Export As...'], 'local-photoshop-export-as'),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:open|show|use)\s+(?:save\s+for\s+web|save\s+for\s+web\s+legacy)\s*$/i.test(text)) {
    return withStandalonePhotoshopContext([
      photoshopMenu(['File', 'Export', 'Save for Web (Legacy)...'], 'local-photoshop-save-for-web-dialog'),
    ], currentApp, step);
  }

  return [];
}

function cleanFileDialogPathMatch(match: RegExpMatchArray): string {
  return cleanTypedText(match[1] || match[2] || match[3] || '')
    .replace(/\s+(?:as\s+)?(?:embedded|linked|smart\s+object|layer)\s*$/i, '')
    .replace(/\s+(?:into|in|inside|on)\s+(?:the\s+)?(?:selected\s+)?(?:frame|document|layout|indesign|photoshop)\s*$/i, '')
    .trim();
}

function withStandaloneInDesignContext(
  actions: LocalComputerAwarenessIntent[],
  currentApp: string | undefined,
  rawText: string,
): LocalComputerAwarenessIntent[] {
  if (currentApp && /\bindesign\b/i.test(currentApp)) return actions;
  const shouldTargetInDesign = /\bindesign\b/i.test(rawText) ||
    /\b(preflight|package|handoff|proof pdf|place|import|relink|replace link|update link|apply style|paragraph styles?|character styles?|object styles?|links panel|pages panel|master pages?|parent pages?|margins and columns|document setup|document size|page size|bleed|create outlines|fitting|fit content|fill frame|text wrap|text frames?|copy fields?|editable text|named frames?|swatches?|color swatch|find font|table of contents|interactive pdf|go to page|duplicate page|duplicate spread|baseline grid|smart guides|hidden characters|page number|footnote|data merge|separations preview|flattener preview|alternate layout|text to image|generative expand|generative fill|firefly|alt text|brochure|tri-?fold|accessible pdf|accessibility|banner workspace|banner workflow|banner layers?|display ads?|object layer options|layer comp|placed psd|variable banners?|resize selected|align selected|center selected|uppercase|lowercase|title case|sentence case|dealership|dealer|automotive|vehicle|disclaimer|fine print|legal copy|lease terms?|finance apr|apr|monthly payment|sale price|msrp|stock number|vin|rebate|incentive|guide grid|guides?|new layer|rename layer)\b/i.test(rawText);
  if (!shouldTargetInDesign) return [];
  return [
    { route: true, kind: 'focus_app', appQuery: 'InDesign', reason: 'local-focus-app' },
    ...actions.map((action) => action.kind === 'wait' || action.appQuery ? action : { ...action, appQuery: 'InDesign' }),
  ];
}

function indesignDealerLayerLabel(field: string): string {
  const normalized = field.toLowerCase().replace(/\s+/g, ' ').trim();
  if (/\bdisclaimer|legal|fine print|terms\b/.test(normalized)) return 'Disclaimer';
  if (/\bapr|rate|finance|lease|payment|down payment|cash down|offer|rebate|incentive\b/.test(normalized)) return 'Offer';
  if (/\bprice|sale price|msrp\b/.test(normalized)) return 'Price';
  if (/\bmodel|year|trim|stock|vin\b/.test(normalized)) return 'Vehicle';
  if (/\bdealer|phone|url|website\b/.test(normalized)) return 'Dealer Info';
  if (/\bcta|button\b/.test(normalized)) return 'CTA';
  if (/\bheadline|subheadline\b/.test(normalized)) return /subheadline/.test(normalized) ? 'Subheadline' : 'Headline';
  if (/\bexpiration\b/.test(normalized)) return 'Expiration';
  return field;
}

function indesignDealerTextActions(field: string, replacement: string, selectedHint?: string): LocalComputerAwarenessIntent[] {
  const selected = Boolean(selectedHint);
  if (!selected) {
    return [
      {
        route: true,
        kind: 'indesign_update_text_layer',
        appQuery: 'InDesign',
        targetLabel: field,
        text: replacement,
        reason: 'local-indesign-update-text-layer',
      },
    ];
  }
  return [
    photoshopKey('T', 'local-indesign-type-tool'),
    photoshopWait(250),
    { route: true, kind: 'paste_text', text: replacement, reason: 'local-indesign-dealer-banner-text' },
  ];
}

function indesignApplyStyleActions(styleType: string | undefined, styleName: string): LocalComputerAwarenessIntent[] {
  const normalized = String(styleType || '').toLowerCase();
  const menuPath = /object/.test(normalized)
    ? ['Window', 'Styles', 'Object Styles']
    : /character/.test(normalized)
      ? ['Window', 'Styles', 'Character Styles']
      : ['Window', 'Styles', 'Paragraph Styles'];
  return [
    photoshopMenu(menuPath, 'local-indesign-style-panel'),
    photoshopWait(500),
    photoshopClick(styleName, 'local-indesign-apply-style'),
  ];
}

function indesignResizeSelectionActions(width: string, height: string, unit?: string): LocalComputerAwarenessIntent[] {
  const normalizedUnit = String(unit || '').toLowerCase();
  const suffix = /^in/.test(normalizedUnit)
    ? ' in'
    : /^mm$/.test(normalizedUnit)
      ? ' mm'
      : /^cm$/.test(normalizedUnit)
        ? ' cm'
        : /^px|pixels?/.test(normalizedUnit)
          ? ' px'
          : '';
  return [
    photoshopMenu(['Window', 'Object & Layout', 'Transform'], 'local-indesign-transform-panel'),
    photoshopWait(500),
    photoshopSetField('W', `${width}${suffix}`),
    photoshopSetField('H', `${height}${suffix}`),
    photoshopKey('Return', 'local-confirm-dialog-shortcut'),
  ];
}

function indesignAlignSelectionActions(position: string, reference?: string): LocalComputerAwarenessIntent[] {
  const normalized = `${position} ${reference || ''}`.toLowerCase().replace(/\s+/g, ' ').trim();
  const actions: LocalComputerAwarenessIntent[] = [
    photoshopMenu(['Window', 'Object & Layout', 'Align'], 'local-indesign-align-panel'),
    photoshopWait(400),
  ];
  if (/\bpage\b/.test(normalized)) actions.push(photoshopClick('Align to Page', 'local-indesign-align-to-page'));
  else if (/\bspread\b/.test(normalized)) actions.push(photoshopClick('Align to Spread', 'local-indesign-align-to-spread'));
  else if (/\bmargin\b/.test(normalized)) actions.push(photoshopClick('Align to Margin', 'local-indesign-align-to-margin'));

  if (/\bpage center\b|\bcenter\b|\bmiddle\b/.test(normalized)) {
    actions.push(photoshopClick('Horizontal Align Center', 'local-indesign-align-horizontal-center'));
    actions.push(photoshopClick('Vertical Align Center', 'local-indesign-align-vertical-center'));
  } else if (/\bhorizontal center\b/.test(normalized)) {
    actions.push(photoshopClick('Horizontal Align Center', 'local-indesign-align-horizontal-center'));
  } else if (/\bvertical center\b/.test(normalized)) {
    actions.push(photoshopClick('Vertical Align Center', 'local-indesign-align-vertical-center'));
  } else if (/\bleft\b/.test(normalized)) {
    actions.push(photoshopClick('Horizontal Align Left', 'local-indesign-align-left'));
  } else if (/\bright\b/.test(normalized)) {
    actions.push(photoshopClick('Horizontal Align Right', 'local-indesign-align-right'));
  } else if (/\btop\b/.test(normalized)) {
    actions.push(photoshopClick('Vertical Align Top', 'local-indesign-align-top'));
  } else if (/\bbottom\b/.test(normalized)) {
    actions.push(photoshopClick('Vertical Align Bottom', 'local-indesign-align-bottom'));
  }
  return actions;
}

function indesignTextAlignmentCombo(alignment: string): string {
  const normalized = alignment.toLowerCase();
  if (/\bright\b/.test(normalized)) return 'Cmd+Shift+R';
  if (/\bjustif/.test(normalized)) return 'Cmd+Shift+J';
  if (/\bcent(?:er|re)\b/.test(normalized)) return 'Cmd+Shift+C';
  return 'Cmd+Shift+L';
}

function indesignChangeCaseMenuLabel(caseName: string): string {
  const normalized = caseName.toLowerCase().replace(/\s+/g, ' ').trim();
  if (/lower/.test(normalized)) return 'lowercase';
  if (/title/.test(normalized)) return 'Title Case';
  if (/sentence/.test(normalized)) return 'Sentence case';
  return 'UPPERCASE';
}

function indesignRelinkFileActions(targetPath: string): LocalComputerAwarenessIntent[] {
  return [
    photoshopMenu(['Window', 'Links'], 'local-indesign-links-panel'),
    photoshopWait(500),
    photoshopClick('Relink', 'local-indesign-relink'),
    photoshopWait(800),
    ...fileDialogPathEntry(targetPath),
    photoshopWait(500),
    photoshopMenu(['Object', 'Fitting', 'Fill Frame Proportionally'], 'local-indesign-banner-fill-frame'),
  ];
}

function indesignExportFileActions(filename: string, reason: string): LocalComputerAwarenessIntent[] {
  return [
    photoshopMenu(['File', 'Export...'], reason),
    photoshopWait(900),
    { route: true, kind: 'paste_text', text: filename, reason: 'local-save-dialog-filename' },
    photoshopKey('Return', 'local-confirm-dialog-shortcut'),
    photoshopWait(1000),
    photoshopClick('Export', 'local-indesign-export-confirm'),
  ];
}

function inferInDesignPackageOutputFolder(match?: RegExpMatchArray | null): string {
  const parsed = match ? cleanFileDialogPathMatch(match) : '';
  return parsed || '~/Desktop/indesign-package';
}

function indesignPackageHandoffActions(match?: RegExpMatchArray | null): LocalComputerAwarenessIntent[] {
  return [
    {
      route: true,
      kind: 'indesign_document_status',
      appQuery: 'InDesign',
      reason: 'local-indesign-package-preflight',
    },
    {
      route: true,
      kind: 'indesign_package_document',
      appQuery: 'InDesign',
      outputFolderPath: inferInDesignPackageOutputFolder(match),
      reason: 'local-indesign-package-document',
    },
  ];
}

const INDESIGN_DEALER_MULTI_FIELD_PATTERN = '(?:disclaimer|legal|fine\\s+print|terms(?:\\s+and\\s+conditions)?|apr|finance(?:\\s+apr)?|rate|monthly\\s+payment|payment|down\\s+payment|cash\\s+down|price|sale\\s+price|msrp|vehicle\\s+model|model|year|trim|stock(?:\\s+(?:number|#))?|vin|cta|button|headline|subheadline|offer|rebate|incentive|expiration(?:\\s+date)?|dealer(?:ship)?\\s+name|phone(?:\\s+number)?|url|website)';

function extractInDesignDealerMultiUpdates(raw: string): Array<{ field: string; replacement: string }> {
  const text = stripInDesignLauncherPrefix(raw);
  if (!/\b(?:dealer|dealership|vehicle|car|auto|automotive|banner|ad|creative|offer|disclaimer|legal|apr|price|msrp|headline|cta)\b/i.test(text)) {
    return [];
  }
  const fieldRegex = new RegExp(
    `\\b(${INDESIGN_DEALER_MULTI_FIELD_PATTERN})(?:\\s+(?:text|copy|value))?\\s*(?:to|as|with|=|:)\\s*["'\`]?([\\s\\S]*?)(?=(?:[,;]\\s*)?\\b${INDESIGN_DEALER_MULTI_FIELD_PATTERN}(?:\\s+(?:text|copy|value))?\\s*(?:to|as|with|=|:)|$)`,
    'gi',
  );
  const updates: Array<{ field: string; replacement: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = fieldRegex.exec(text)) !== null) {
    const field = cleanTypedText(match[1] || '');
    const replacement = cleanTypedText(match[2] || '')
      .replace(/^\s*["'`]/, '')
      .replace(/["'`,;]\s*$/, '')
      .trim();
    if (!field || replacement.length < 1) continue;
    updates.push({ field, replacement });
  }
  return updates.length >= 2 ? updates.slice(0, 8) : [];
}

function indesignDealerMultiUpdateActions(updates: Array<{ field: string; replacement: string }>): LocalComputerAwarenessIntent[] {
  return [
    {
      route: true,
      kind: 'indesign_batch_update_text_layers',
      appQuery: 'InDesign',
      fieldUpdates: updates.map((update) => ({
        fieldName: update.field,
        replacementText: update.replacement,
      })),
      reason: 'local-indesign-batch-update-text-layers',
    },
  ];
}

function indesignFindChangeActions(findText: string, changeText: string, reason = 'local-indesign-find-change'): LocalComputerAwarenessIntent[] {
  return [
    {
      route: true,
      kind: 'indesign_find_change',
      appQuery: 'InDesign',
      query: findText,
      text: changeText,
      reason,
    },
  ];
}

function extractInDesignBatchFindChangePairs(raw: string): Array<{ findText: string; changeText: string }> {
  const text = stripInDesignLauncherPrefix(String(raw || ''))
    .replace(/\s+(?:in|inside|on)\s+(?:adobe\s+)?indesign\s*$/i, '')
    .trim();
  if (!/\b(?:change|replace|find\s+(?:and\s+)?replace|find\/change)\b/i.test(text)) return [];
  const pairs: Array<{ findText: string; changeText: string }> = [];
  const repeatedAction = /\b(?:change|replace|find\s+(?:and\s+)?replace|find\/change)\s+["'`]?([^"'`,;\n\r]{1,160}?)["'`]?\s+(?:to|with|into|as)\s+["'`]?([^"'`,;\n\r]{1,240}?)(?=(?:\s*(?:,|;|\band\b|\bthen\b)\s*(?:change|replace|find\s+(?:and\s+)?replace|find\/change)\b)|$)/gi;
  let match: RegExpExecArray | null;
  while ((match = repeatedAction.exec(text)) !== null) {
    const findText = cleanTypedText(match[1] || '');
    const changeText = cleanTypedText(match[2] || '').replace(/["'`,;]\s*$/, '').trim();
    if (findText && changeText) pairs.push({ findText, changeText });
  }
  if (pairs.length >= 2) return pairs.slice(0, 12);

  const compact = text
    .replace(/^\s*(?:please\s+)?(?:batch\s+|multiple\s+|all\s+)?(?:change|replace|find\s+(?:and\s+)?replace|find\/change)\s+/i, '')
    .replace(/\s+(?:in|inside|on)\s+(?:adobe\s+)?indesign\s*$/i, '')
    .trim();
  const segments = compact.split(/\s*(?:,|;|\band\b|\bthen\b)\s*/i).map((segment) => segment.trim()).filter(Boolean);
  if (segments.length < 2) return [];
  const segmentPairs: Array<{ findText: string; changeText: string }> = [];
  for (const segment of segments) {
    const segmentMatch = segment.match(/^["'`]?([^"'`\n\r]{1,160}?)["'`]?\s+(?:to|with|into|as)\s+["'`]?([^"'`\n\r]{1,240}?)["'`]?\s*$/i);
    const findText = cleanTypedText(segmentMatch?.[1] || '');
    const changeText = cleanTypedText(segmentMatch?.[2] || '').replace(/["'`,;]\s*$/, '').trim();
    if (findText && changeText) segmentPairs.push({ findText, changeText });
  }
  return segmentPairs.length >= 2 ? segmentPairs.slice(0, 12) : [];
}

function indesignDataMergeSourceActions(targetPath: string): LocalComputerAwarenessIntent[] {
  return [
    photoshopMenu(['Window', 'Utilities', 'Data Merge'], 'local-indesign-data-merge-panel'),
    photoshopWait(500),
    photoshopClick('Select Data Source...', 'local-indesign-data-merge-select-source'),
    photoshopWait(800),
    ...fileDialogPathEntry(targetPath),
    photoshopWait(700),
    photoshopClick('Preview', 'local-indesign-data-merge-preview'),
  ];
}

function indesignDataMergeCreateActions(): LocalComputerAwarenessIntent[] {
  return [
    photoshopMenu(['Window', 'Utilities', 'Data Merge'], 'local-indesign-data-merge-panel'),
    photoshopWait(500),
    photoshopClick('Create Merged Document...', 'local-indesign-data-merge-create'),
    photoshopWait(800),
    photoshopClick('OK', 'local-indesign-data-merge-create-ok'),
  ];
}

function indesignLinksActionLabel(actionText: string): { label: string; reason: string } {
  const normalized = actionText.toLowerCase();
  if (/\bedit\s+original\b/.test(normalized)) return { label: 'Edit Original', reason: 'local-indesign-link-edit-original' };
  if (/\breveal\b/.test(normalized)) return { label: 'Reveal in Finder', reason: 'local-indesign-link-reveal-finder' };
  if (/\bgo\s+to\s+link\b/.test(normalized)) return { label: 'Go to Link', reason: 'local-indesign-link-go-to' };
  if (/\binfo\b/.test(normalized)) return { label: 'Link Info', reason: 'local-indesign-link-info' };
  if (/\bmissing|relink\b/.test(normalized)) return { label: 'Relink', reason: 'local-indesign-relink' };
  return { label: /\ball\b/.test(normalized) ? 'Update All Links' : 'Update Link', reason: 'local-indesign-update-link' };
}

function indesignSelectedObjectActions(actionText: string): LocalComputerAwarenessIntent[] {
  const normalized = actionText.toLowerCase();
  if (/\bunlock\s+all\b/.test(normalized)) return [photoshopMenu(['Object', 'Unlock All on Spread'], 'local-indesign-unlock-all-on-spread')];
  if (/\bpaste\b.*\bin\s+place\b/.test(normalized)) return [photoshopMenu(['Edit', 'Paste in Place'], 'local-indesign-paste-in-place-menu')];
  if (/\bungroup\b/.test(normalized)) return [photoshopMenu(['Object', 'Ungroup'], 'local-indesign-ungroup-selection')];
  if (/\bgroup\b/.test(normalized)) return [photoshopMenu(['Object', 'Group'], 'local-indesign-group-selection')];
  if (/\bduplicate\b/.test(normalized)) return [photoshopMenu(['Edit', 'Duplicate'], 'local-indesign-duplicate-selection')];
  if (/\bunlock\b/.test(normalized)) return [photoshopMenu(['Object', 'Unlock'], 'local-indesign-unlock-selection')];
  return [photoshopMenu(['Object', 'Lock'], 'local-indesign-lock-selection')];
}

function normalizeInDesignLayerStateAction(action: string): 'show' | 'hide' | 'lock' | 'unlock' {
  const normalized = action.toLowerCase();
  if (/\bshow\b/.test(normalized)) return 'show';
  if (/\bhide\b/.test(normalized)) return 'hide';
  if (/\bunlock\b/.test(normalized)) return 'unlock';
  return 'lock';
}

function indesignUnitSuffix(unit?: string): string {
  const normalizedUnit = String(unit || '').toLowerCase();
  if (/^in|inch/.test(normalizedUnit)) return ' in';
  if (/^mm$/.test(normalizedUnit)) return ' mm';
  if (/^cm$/.test(normalizedUnit)) return ' cm';
  if (/^pt|points?/.test(normalizedUnit)) return ' pt';
  if (/^px|pixels?/.test(normalizedUnit)) return ' px';
  return '';
}

function indesignDimensionText(value: string, unit?: string): string {
  return `${value}${indesignUnitSuffix(unit)}`;
}

function indesignBleedFieldActions(value: string, unit?: string): LocalComputerAwarenessIntent[] {
  const text = indesignDimensionText(value, unit);
  return [
    photoshopSetField('Bleed Top', text),
    photoshopSetField('Bleed Bottom', text),
    photoshopSetField('Bleed Inside', text),
    photoshopSetField('Bleed Outside', text),
  ];
}

function indesignNewDocumentSizeActions(
  width: string,
  height: string,
  unit?: string,
  pages?: string,
  bleed?: string,
  bleedUnit?: string,
): LocalComputerAwarenessIntent[] {
  return [
    photoshopKey('Cmd+N', 'local-new-document-shortcut'),
    photoshopWait(800),
    photoshopSetField('Width', indesignDimensionText(width, unit)),
    photoshopSetField('Height', indesignDimensionText(height, unit)),
    ...(pages ? [photoshopSetField('Pages', pages)] : []),
    ...(bleed ? indesignBleedFieldActions(bleed, bleedUnit || unit) : []),
    photoshopClick('Create', 'local-indesign-create-sized-document'),
    photoshopWait(1200),
    photoshopMenu(['Window', 'Layers'], 'local-indesign-layers-panel'),
    photoshopMenu(['Window', 'Output', 'Preflight'], 'local-indesign-preflight-panel'),
  ];
}

function indesignDocumentSizeActions(width: string, height: string, unit?: string): LocalComputerAwarenessIntent[] {
  return [
    photoshopMenu(['File', 'Document Setup...'], 'local-indesign-document-setup'),
    photoshopWait(700),
    photoshopSetField('Width', indesignDimensionText(width, unit)),
    photoshopSetField('Height', indesignDimensionText(height, unit)),
    photoshopConfirmDialog(),
  ];
}

function indesignSetBleedActions(value: string, unit?: string): LocalComputerAwarenessIntent[] {
  return [
    photoshopMenu(['File', 'Document Setup...'], 'local-indesign-document-setup'),
    photoshopWait(700),
    ...indesignBleedFieldActions(value, unit),
    photoshopConfirmDialog(),
  ];
}

function indesignSetMarginsActions(value: string, unit?: string): LocalComputerAwarenessIntent[] {
  const text = indesignDimensionText(value, unit);
  return [
    photoshopMenu(['Layout', 'Margins and Columns...'], 'local-indesign-margins-columns'),
    photoshopWait(600),
    photoshopSetField('Top', text),
    photoshopSetField('Bottom', text),
    photoshopSetField('Inside', text),
    photoshopSetField('Outside', text),
    photoshopConfirmDialog(),
  ];
}

function indesignSetColumnsActions(columns: string): LocalComputerAwarenessIntent[] {
  return [
    photoshopMenu(['Layout', 'Margins and Columns...'], 'local-indesign-margins-columns'),
    photoshopWait(600),
    photoshopSetField('Columns', columns),
    photoshopConfirmDialog(),
  ];
}

function indesignNewLayerActions(layerName: string): LocalComputerAwarenessIntent[] {
  return [
    photoshopMenu(['Window', 'Layers'], 'local-indesign-layers-panel'),
    photoshopWait(500),
    photoshopClick('New Layer...', 'local-indesign-new-layer'),
    photoshopWait(500),
    photoshopSetField('Name', layerName),
    photoshopClick('OK', 'local-indesign-new-layer-ok'),
  ];
}

function indesignRenameLayerActions(fromLayer: string, toLayer: string): LocalComputerAwarenessIntent[] {
  return [
    photoshopMenu(['Window', 'Layers'], 'local-indesign-layers-panel'),
    photoshopWait(500),
    photoshopClick(fromLayer, 'local-indesign-select-layer'),
    photoshopWait(250),
    photoshopClick('Layer Options...', 'local-indesign-layer-options'),
    photoshopWait(500),
    photoshopSetField('Name', toLayer),
    photoshopClick('OK', 'local-indesign-layer-options-ok'),
  ];
}

function rgbFromHex(hex: string): { red: string; green: string; blue: string } | null {
  const normalized = String(hex || '').replace(/^#/, '').trim();
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return null;
  return {
    red: String(parseInt(normalized.slice(0, 2), 16)),
    green: String(parseInt(normalized.slice(2, 4), 16)),
    blue: String(parseInt(normalized.slice(4, 6), 16)),
  };
}

function indesignNewSwatchActions(name: string, hex: string): LocalComputerAwarenessIntent[] {
  const rgb = rgbFromHex(hex);
  return [
    photoshopMenu(['Window', 'Color', 'Swatches'], 'local-indesign-swatches-panel'),
    photoshopWait(500),
    photoshopClick('New Color Swatch...', 'local-indesign-new-color-swatch'),
    photoshopWait(700),
    photoshopSetField('Swatch Name', name),
    photoshopClick('RGB', 'local-indesign-swatch-rgb-mode'),
    ...(rgb ? [
      photoshopSetField('Red', rgb.red),
      photoshopSetField('Green', rgb.green),
      photoshopSetField('Blue', rgb.blue),
    ] : []),
    photoshopClick('OK', 'local-indesign-new-swatch-ok'),
  ];
}

function indesignApplySwatchActions(target: string | undefined, swatchName: string): LocalComputerAwarenessIntent[] {
  const normalized = String(target || '').toLowerCase();
  const targetControl = /\bstroke\b/.test(normalized)
    ? 'Stroke'
    : /\btext\b/.test(normalized)
      ? 'Text'
      : 'Fill';
  return [
    photoshopMenu(['Window', 'Color', 'Swatches'], 'local-indesign-swatches-panel'),
    photoshopWait(500),
    photoshopClick(targetControl, 'local-indesign-swatch-target'),
    photoshopWait(200),
    photoshopClick(swatchName, 'local-indesign-apply-swatch'),
  ];
}

function indesignTextWrapLabel(raw?: string): string {
  const normalized = String(raw || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (/\bnone|no wrap\b/.test(normalized)) return 'No Text Wrap';
  if (/\bobject shape\b/.test(normalized)) return 'Wrap Around Object Shape';
  if (/\bnext column\b/.test(normalized)) return 'Jump to Next Column';
  if (/\bjump\b/.test(normalized)) return 'Jump Object';
  return 'Wrap Around Bounding Box';
}

function indesignTextWrapActions(mode?: string): LocalComputerAwarenessIntent[] {
  return [
    photoshopMenu(['Window', 'Text Wrap'], 'local-indesign-text-wrap-panel'),
    photoshopWait(500),
    photoshopClick(indesignTextWrapLabel(mode), 'local-indesign-text-wrap-mode'),
  ];
}

function indesignApplyParentActions(parentName: string, pageRange: string): LocalComputerAwarenessIntent[] {
  return [
    photoshopMenu(['Window', 'Pages'], 'local-indesign-pages-panel'),
    photoshopWait(500),
    photoshopClick('Apply Parent to Pages...', 'local-indesign-apply-parent-to-pages'),
    photoshopWait(700),
    photoshopSetField('Apply Parent', parentName),
    photoshopSetField('To Pages', cleanTypedText(pageRange)),
    photoshopClick('OK', 'local-indesign-apply-parent-ok'),
  ];
}

function indesignCreateGuidesActions(rows?: string, columns?: string): LocalComputerAwarenessIntent[] {
  return [
    photoshopMenu(['Layout', 'Create Guides...'], 'local-indesign-create-guides'),
    photoshopWait(700),
    ...(rows ? [photoshopSetField('Rows', rows)] : []),
    ...(columns ? [photoshopSetField('Columns', columns)] : []),
    photoshopClick('OK', 'local-indesign-create-guides-ok'),
  ];
}

function inferPhotoshopFileWorkflowSearchExtensions(query: string): string[] | undefined {
  const extension = query.match(/\.([A-Za-z0-9]{1,12})$/)?.[1]?.toLowerCase();
  if (extension) return [extension];
  if (/^screenshot\b/i.test(query)) return ['png', 'jpg', 'jpeg', 'heic'];
  return ['png', 'jpg', 'jpeg', 'heic', 'webp', 'tif', 'tiff', 'psd'];
}

function normalizePhotoshopWorkflowFormat(value: string | undefined): 'png' | 'jpg' | null {
  const raw = String(value || '').toLowerCase();
  if (raw === 'png') return 'png';
  if (raw === 'jpg' || raw === 'jpeg') return 'jpg';
  return null;
}

function photoshopWorkflowFormatFromFilename(filename: string): 'png' | 'jpg' | null {
  const extension = filename.match(/\.([A-Za-z0-9]{1,12})$/)?.[1];
  return normalizePhotoshopWorkflowFormat(extension);
}

function cleanPhotoshopWorkflowOutputBasename(value: string): string {
  return cleanTypedText(value)
    .replace(/^\s*(?:to|as)\s+/i, '')
    .replace(/\.(?:png|jpe?g)$/i, '')
    .replace(/[\\/:\0]/g, '-')
    .replace(/[.?!]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function photoshopWorkflowOutputRoot(rootPath: string): string {
  if (!rootPath || rootPath === 'google_drive') return '~/Desktop';
  return rootPath;
}

function resolvePhotoshopWorkflowOutputPath(filename: string, rootPath: string): string {
  const cleanFilename = cleanTypedText(filename).replace(/^[\\/]+/, '');
  if (/^(?:~\/|\/|\.\/|\.\.\/)/.test(cleanFilename)) return cleanFilename;
  const root = photoshopWorkflowOutputRoot(rootPath).replace(/[\\/]+$/, '');
  return `${root}/${cleanFilename}`;
}

function basenameFromPhotoshopWorkflowOutputPath(outputPath: string): string {
  return cleanTypedText(outputPath).split(/[\\/]/).filter(Boolean).pop() || cleanTypedText(outputPath);
}

function buildPhotoshopSaveForWebExportActions(outputPath: string): LocalComputerAwarenessIntent[] {
  const targetPath = cleanTypedText(outputPath);
  const filename = basenameFromPhotoshopWorkflowOutputPath(targetPath);
  const format = photoshopWorkflowFormatFromFilename(filename);
  if (!filename || !targetPath) return [];
  return [
    { ...photoshopKey('Cmd+Opt+Shift+S', 'local-save-for-web-shortcut'), appQuery: 'Photoshop' },
    photoshopWait(1500),
    { ...photoshopClick('Save', 'local-save-for-web-save-button'), appQuery: 'Photoshop', format: format || undefined, outputPath: targetPath },
    photoshopWait(1000),
    { route: true, kind: 'paste_text', appQuery: 'Photoshop', text: targetPath, reason: 'local-save-dialog-output-path' },
    { ...photoshopKey('Return', 'local-confirm-dialog-shortcut'), appQuery: 'Photoshop' },
  ];
}

function buildPhotoshopWorkflowExportAction(
  rawText: string,
  sourceQuery: string,
  rootPath: string,
): LocalComputerAwarenessIntent[] {
  const namedSave = rawText.match(PHOTOSHOP_FILE_WORKFLOW_SAVE_NAMED_FILE_RE);
  if (namedSave?.[1]) {
    const outputPath = resolvePhotoshopWorkflowOutputPath(namedSave[1], rootPath);
    const format = photoshopWorkflowFormatFromFilename(outputPath);
    if (!format) return [];
    return buildPhotoshopSaveForWebExportActions(outputPath);
  }

  const saveFormat = rawText.match(PHOTOSHOP_FILE_WORKFLOW_SAVE_FORMAT_RE);
  const format = normalizePhotoshopWorkflowFormat(saveFormat?.[1]);
  if (!format) return [];
  const rename = rawText.match(PHOTOSHOP_FILE_WORKFLOW_RENAME_RE);
  const basename = cleanPhotoshopWorkflowOutputBasename(rename?.[1] || sourceQuery) || 'photoshop-export';
  return buildPhotoshopSaveForWebExportActions(resolvePhotoshopWorkflowOutputPath(`${basename}.${format === 'jpg' ? 'jpg' : 'png'}`, rootPath));
}

function expandPhotoshopFileSearchWorkflow(step: string): LocalComputerAwarenessIntent[] {
  const match = String(step || '').match(PHOTOSHOP_FILE_SEARCH_WORKFLOW_RE);
  if (!match?.[1] || !match[2]) return [];
  const query = cleanFileSearchQuery(match[1]);
  if (!query) return [];
  const rootPath = normalizeFileSearchRoot(match[2]);
  const actions: LocalComputerAwarenessIntent[] = [
    {
      route: true,
      kind: 'open_file_search_match',
      query,
      rootPath,
      extensions: inferPhotoshopFileWorkflowSearchExtensions(query),
      appQuery: 'Photoshop',
      reason: 'local-photoshop-find-open-file',
    },
    { route: true, kind: 'wait_for_app', appQuery: 'Photoshop', durationMs: 12_000, reason: 'local-photoshop-wait-for-file-open' },
    { route: true, kind: 'focus_app', appQuery: 'Photoshop', reason: 'local-focus-app' },
  ];
  const exportActions = buildPhotoshopWorkflowExportAction(step, query, rootPath);
  if (exportActions.length > 0) actions.push(...exportActions);
  return actions;
}

function findInDesignDocumentReference(raw: string): { target: string; matchedText: string; index: number; isPathLike: boolean } | null {
  const spacedFile = String(raw || '').match(/(?:^|\b)(?:open|load|find|locate|search(?:\s+for)?|use)\s+(?:the\s+)?(?:indesign\s+)?(?:file\s+|document\s+|layout\s+)?["'`]?([^"'`\n\r]{2,500}?\.indd)["'`]?(?=\s+(?:in|inside|on|under|from)\s+(?:my\s+)?(?:desktop|downloads?|documents?|google\s+drive|gdrive|my\s+drive|home folder|home directory|computer|mac|laptop|files?)\b|\s*(?:and|then|,|$))/i);
  const spacedTarget = cleanTypedText(spacedFile?.[1] || '');
  if (spacedFile && spacedTarget) {
    return {
      target: spacedTarget,
      matchedText: spacedFile[1] || spacedFile[0],
      index: typeof spacedFile.index === 'number'
        ? spacedFile.index + spacedFile[0].indexOf(spacedFile[1] || spacedFile[0])
        : 0,
      isPathLike: isPathish(spacedTarget),
    };
  }
  const match = String(raw || '').match(INDESIGN_DOCUMENT_FILE_RE);
  const target = cleanTypedText(match?.[1] || match?.[2] || match?.[3] || match?.[4] || '');
  if (!match || !target) return null;
  return {
    target,
    matchedText: match[0],
    index: typeof match.index === 'number' ? match.index : 0,
    isPathLike: isPathish(target),
  };
}

function inferInDesignDocumentSearchRoot(raw: string): string {
  if (/\b(?:google\s+drive|gdrive|my\s+drive)\b/i.test(raw)) return 'google_drive';
  if (/\bdesktop\b/i.test(raw)) return '~/Desktop';
  if (/\bdownloads?\b/i.test(raw)) return '~/Downloads';
  if (/\bdocuments?\b/i.test(raw)) return '~/Documents';
  return '~';
}

function inDesignDocumentOpenActions(
  reference: { target: string; isPathLike: boolean },
  rawText: string,
): LocalComputerAwarenessIntent[] {
  const opener: LocalComputerAwarenessIntent = reference.isPathLike
    ? {
      route: true,
      kind: 'open_path',
      path: reference.target,
      appQuery: 'InDesign',
      reason: 'local-indesign-open-file',
    }
    : {
      route: true,
      kind: 'open_file_search_match',
      query: reference.target,
      rootPath: inferInDesignDocumentSearchRoot(rawText),
      extensions: ['indd'],
      appQuery: 'InDesign',
      reason: 'local-indesign-find-open-file',
    };
  return [
    opener,
    { route: true, kind: 'wait_for_app', appQuery: 'InDesign', durationMs: 12_000, reason: 'local-indesign-wait-for-file-open' },
    { route: true, kind: 'focus_app', appQuery: 'InDesign', reason: 'local-focus-app' },
  ];
}

function stripInDesignDocumentReferenceForAction(
  raw: string,
  reference: { matchedText: string; index: number },
): string {
  const withoutFile = `${raw.slice(0, reference.index)} ${raw.slice(reference.index + reference.matchedText.length)}`;
  return stripInDesignLauncherPrefix(withoutFile)
    .replace(/\b(?:on|in|inside|under)\s+(?:my\s+)?(?:desktop|downloads?|documents?|home folder|home directory|computer|mac|laptop|files?)\b/gi, ' ')
    .replace(/\b(?:in|inside|on)\s+(?:the\s+)?(?:indesign\s+)?(?:file|document|layout)\b/gi, ' ')
    .replace(/^\s*(?:please\s+)?(?:find|open|load|locate|search(?:\s+for)?|use)\s+(?:the\s+)?(?:indesign\s+)?(?:file|document|layout)?\s*/i, '')
    .replace(/^\s*(?:the\s+)?(?:file|document|layout)\s+(?:and|then)\s+/i, '')
    .replace(/^\s*(?:the\s+)?(?:file|document|layout)\s*$/i, '')
    .replace(/^\s*(?:and|then|,)+\s*/i, '')
    .replace(/\s+\b(?:in|inside|on)\b\s+(?=(?:to|as|with)\b)/i, ' ')
    .replace(/\s+\b(?:in|inside|on)\b\s*$/i, '')
    .replace(/\s+\b(?:and|then)\b\s*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function expandInDesignDocumentWorkflow(step: string, _currentApp?: string): LocalComputerAwarenessIntent[] {
  const reference = findInDesignDocumentReference(step);
  if (!reference) return [];
  const openActions = inDesignDocumentOpenActions(reference, step);
  const actionText = stripInDesignDocumentReferenceForAction(step, reference);
  const explicitOpenOnly = /\b(?:open|load)\b/i.test(step);
  if (!actionText) return explicitOpenOnly ? openActions : [];
  const editActions = expandInDesignTaskMacro(actionText, 'InDesign')
    .filter((action) => action.kind !== 'focus_app' || !/\bindesign\b/i.test(action.appQuery || ''));
  const contextualEditActions = editActions.map((action) => (
    action.kind === 'wait' || action.appQuery ? action : { ...action, appQuery: 'InDesign' }
  ));
  if (contextualEditActions.length > 0) return [...openActions, ...contextualEditActions];
  return explicitOpenOnly ? openActions : [];
}

function cleanGoogleDriveInDesignActionText(value: string | undefined): string {
  return String(value || '')
    .trim()
    .replace(/^["'`]([\s\S]*)["'`]$/g, '$1')
    .replace(/^\s*(?:and|then|,)+\s*/i, '')
    .replace(/^\s*(?:make|do|apply)\s+(?:these|the|this)\s+changes?\s*:?\s*/i, '')
    .replace(/^\s*(?:changes?|edits?|updates?)\s*:\s*/i, '')
    .replace(/^\s*(?:to\s+)?(?:the\s+)?(?:file|document|layout)\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function expandGoogleDriveInDesignWorkflow(step: string, _currentApp?: string): LocalComputerAwarenessIntent[] {
  const match = String(step || '').match(GOOGLE_DRIVE_INDESIGN_WORKFLOW_RE);
  const target = cleanFileSearchQuery(match?.[1] || '');
  if (!match || !target) return [];
  const openActions = inDesignDocumentOpenActions({ target, isPathLike: false }, 'google drive');
  const rawActionText = cleanGoogleDriveInDesignActionText(match[2]);
  if (!rawActionText || /^(?:make\s+)?(?:these|the|this)?\s*changes?$/i.test(rawActionText)) return openActions;
  const editActions = expandInDesignTaskMacro(rawActionText, 'InDesign')
    .filter((action) => action.kind !== 'focus_app' || !/\bindesign\b/i.test(action.appQuery || ''));
  const contextualEditActions = editActions.map((action) => (
    action.kind === 'wait' || action.appQuery ? action : { ...action, appQuery: 'InDesign' }
  ));
  return contextualEditActions.length > 0 ? [...openActions, ...contextualEditActions] : openActions;
}

function expandInDesignTaskMacro(step: string, currentApp?: string): LocalComputerAwarenessIntent[] {
  const text = stripInDesignLauncherPrefix(String(step || ''));

  const googleDriveWorkflow = expandGoogleDriveInDesignWorkflow(String(step || ''), currentApp);
  if (googleDriveWorkflow.length > 0) return googleDriveWorkflow;

  const documentWorkflow = expandInDesignDocumentWorkflow(String(step || ''), currentApp);
  if (documentWorkflow.length > 0) return documentWorkflow;

  if (INDESIGN_DOCUMENT_STATUS_RE.test(text)) {
    return withStandaloneInDesignContext(
      [{
        route: true,
        kind: 'indesign_document_status',
        appQuery: 'InDesign',
        reason: 'local-indesign-document-status',
      }],
      currentApp,
      step,
    );
  }
  if (INDESIGN_TEXT_INVENTORY_RE.test(text)) {
    const query = cleanTypedText(
      text.match(/\b(?:for|matching|about|called|named)\s+["'`]?([^"'`\n\r]{1,120})["'`]?\s*$/i)?.[1] || '',
    );
    return withStandaloneInDesignContext(
      [{
        route: true,
        kind: 'indesign_text_inventory',
        appQuery: 'InDesign',
        query,
        reason: 'local-indesign-text-inventory',
      }],
      currentApp,
      step,
    );
  }

  const newDocumentSize = text.match(INDESIGN_NEW_DOCUMENT_SIZE_RE);
  if (newDocumentSize?.[1] && newDocumentSize[2]) {
    return withStandaloneInDesignContext(
      indesignNewDocumentSizeActions(
        newDocumentSize[1],
        newDocumentSize[2],
        newDocumentSize[3],
        newDocumentSize[4],
        newDocumentSize[5],
        newDocumentSize[6],
      ),
      currentApp,
      step,
    );
  }

  const documentSize = text.match(INDESIGN_DOCUMENT_SIZE_RE);
  if (documentSize?.[1] && documentSize[2]) {
    return withStandaloneInDesignContext(
      indesignDocumentSizeActions(documentSize[1], documentSize[2], documentSize[3]),
      currentApp,
      step,
    );
  }

  const documentBleed = text.match(INDESIGN_SET_BLEED_RE);
  if (documentBleed?.[1]) {
    return withStandaloneInDesignContext(
      indesignSetBleedActions(documentBleed[1], documentBleed[2]),
      currentApp,
      step,
    );
  }

  const documentMargins = text.match(INDESIGN_SET_MARGINS_RE);
  if (documentMargins?.[1]) {
    return withStandaloneInDesignContext(
      indesignSetMarginsActions(documentMargins[1], documentMargins[2]),
      currentApp,
      step,
    );
  }

  const documentColumns = text.match(INDESIGN_SET_COLUMNS_RE);
  if (documentColumns?.[1]) {
    return withStandaloneInDesignContext(
      indesignSetColumnsActions(documentColumns[1]),
      currentApp,
      step,
    );
  }

  if (INDESIGN_BANNER_WORKSPACE_RE.test(text) || INDESIGN_DEALER_PRODUCTION_CHECK_RE.test(text)) {
    return withStandaloneInDesignContext([
      photoshopMenu(['Window', 'Layers'], 'local-indesign-banner-layers-panel'),
      photoshopMenu(['Window', 'Links'], 'local-indesign-banner-links-panel'),
      photoshopMenu(['Window', 'Styles', 'Object Styles'], 'local-indesign-banner-object-styles'),
      photoshopMenu(['Window', 'Styles', 'Paragraph Styles'], 'local-indesign-banner-paragraph-styles'),
      photoshopMenu(['Window', 'Utilities', 'Data Merge'], 'local-indesign-banner-data-merge'),
      photoshopMenu(['Window', 'Object & Layout', 'Align'], 'local-indesign-banner-align-panel'),
      photoshopMenu(['Window', 'Output', 'Preflight'], 'local-indesign-banner-preflight-panel'),
      photoshopMenu(['Window', 'Properties'], 'local-indesign-banner-properties-panel'),
      ...(INDESIGN_DEALER_PRODUCTION_CHECK_RE.test(text) ? [photoshopMenu(['Edit', 'Find/Change...'], 'local-indesign-dealer-find-change')] : []),
    ], currentApp, step);
  }

  const dealerFindReplace = text.match(INDESIGN_DEALER_FIND_REPLACE_RE);
  if (dealerFindReplace?.[1] && dealerFindReplace[2]) {
    return withStandaloneInDesignContext([
      ...indesignFindChangeActions(
        cleanTypedText(dealerFindReplace[1]),
        cleanTypedText(dealerFindReplace[2]),
        'local-indesign-dealer-find-change',
      ),
    ], currentApp, step);
  }

  const dealerMultiUpdates = extractInDesignDealerMultiUpdates(text);
  if (dealerMultiUpdates.length > 0) {
    return withStandaloneInDesignContext(
      indesignDealerMultiUpdateActions(dealerMultiUpdates),
      currentApp,
      step,
    );
  }

  const dealerText = text.match(INDESIGN_DEALER_BANNER_TEXT_RE);
  if (dealerText?.[2] && dealerText[3]) {
    return withStandaloneInDesignContext(
      indesignDealerTextActions(dealerText[2], cleanTypedText(dealerText[3]), dealerText[1]),
      currentApp,
      step,
    );
  }

  if (INDESIGN_OBJECT_LAYER_OPTIONS_RE.test(text)) {
    return withStandaloneInDesignContext([
      photoshopMenu(['Object', 'Object Layer Options...'], 'local-indesign-object-layer-options'),
      photoshopWait(800),
    ], currentApp, step);
  }

  const placedLayerVariant = text.match(INDESIGN_PLACED_LAYER_VARIANT_RE);
  if (placedLayerVariant?.[1]) {
    const layerName = cleanTypedText(placedLayerVariant[1]);
    return withStandaloneInDesignContext([
      photoshopMenu(['Object', 'Object Layer Options...'], 'local-indesign-object-layer-options'),
      photoshopWait(800),
      photoshopClick(layerName, 'local-indesign-placed-layer-variant'),
      photoshopWait(300),
      photoshopClick('OK', 'local-indesign-object-layer-options-ok'),
    ], currentApp, step);
  }

  const bannerText = text.match(INDESIGN_BANNER_TEXT_RE);
  if (bannerText?.[2]) {
    const replacement = cleanTypedText(bannerText[2]);
    return withStandaloneInDesignContext(
      indesignDealerTextActions(bannerText[1], replacement, /(?:selected|current)/i.test(text) ? 'selected' : undefined),
      currentApp,
      step,
    );
  }

  const bannerAsset = text.match(INDESIGN_BANNER_ASSET_PLACE_RE);
  if (bannerAsset) {
    const targetPath = cleanFileDialogPathMatch(bannerAsset);
    if (/^\s*(?:please\s+)?(?:replace|swap|update)\b/i.test(text)) {
      return withStandaloneInDesignContext([
        {
          route: true,
          kind: 'indesign_relink_asset',
          appQuery: 'InDesign',
          assetPath: targetPath,
          reason: 'local-indesign-relink-asset',
        },
      ], currentApp, step);
    }
    return withStandaloneInDesignContext([
      photoshopMenu(['File', 'Place...'], 'local-indesign-banner-place-asset'),
      photoshopWait(800),
      ...fileDialogPathEntry(targetPath),
      photoshopMenu(['Object', 'Fitting', 'Fill Frame Proportionally'], 'local-indesign-banner-fill-frame'),
      photoshopMenu(['Window', 'Links'], 'local-indesign-banner-links-panel'),
    ], currentApp, step);
  }

  const bannerExport = text.match(INDESIGN_BANNER_EXPORT_RE);
  if (bannerExport?.[1]) {
    const filename = cleanTypedText(bannerExport[1]);
    return withStandaloneInDesignContext([
      photoshopMenu(['File', 'Export...'], 'local-indesign-banner-export'),
      photoshopWait(900),
      { route: true, kind: 'paste_text', text: filename, reason: 'local-save-dialog-filename' },
      photoshopKey('Return', 'local-confirm-dialog-shortcut'),
      photoshopWait(1000),
      photoshopClick('Export', 'local-indesign-export-confirm'),
    ], currentApp, step);
  }

  if (INDESIGN_BANNER_DATA_MERGE_RE.test(text)) {
    return withStandaloneInDesignContext([
      photoshopMenu(['Window', 'Utilities', 'Data Merge'], 'local-indesign-banner-data-merge'),
      photoshopMenu(['Window', 'Layers'], 'local-indesign-banner-layers-panel'),
      photoshopMenu(['Window', 'Links'], 'local-indesign-banner-links-panel'),
      photoshopMenu(['Window', 'Pages'], 'local-indesign-banner-pages-panel'),
      photoshopMenu(['Window', 'Styles', 'Paragraph Styles'], 'local-indesign-banner-paragraph-styles'),
      photoshopMenu(['Window', 'Output', 'Preflight'], 'local-indesign-banner-preflight-panel'),
    ], currentApp, step);
  }

  const dataMergeSource = text.match(INDESIGN_DATA_MERGE_SOURCE_RE);
  if (dataMergeSource) {
    return withStandaloneInDesignContext(
      indesignDataMergeSourceActions(cleanFileDialogPathMatch(dataMergeSource)),
      currentApp,
      step,
    );
  }

  if (INDESIGN_DATA_MERGE_PREVIEW_RE.test(text)) {
    return withStandaloneInDesignContext([
      photoshopMenu(['Window', 'Utilities', 'Data Merge'], 'local-indesign-data-merge-panel'),
      photoshopWait(500),
      photoshopClick('Preview', 'local-indesign-data-merge-preview'),
    ], currentApp, step);
  }

  if (INDESIGN_DATA_MERGE_CREATE_RE.test(text)) {
    return withStandaloneInDesignContext(indesignDataMergeCreateActions(), currentApp, step);
  }

  if (INDESIGN_BANNER_ALTERNATE_LAYOUT_RE.test(text)) {
    return withStandaloneInDesignContext([
      photoshopMenu(['Layout', 'Create Alternate Layout...'], 'local-indesign-banner-alternate-layout'),
      photoshopWait(700),
    ], currentApp, step);
  }

  const newLayer = text.match(INDESIGN_NEW_LAYER_RE);
  if (newLayer?.[1]) {
    return withStandaloneInDesignContext(
      indesignNewLayerActions(cleanTypedText(newLayer[1])),
      currentApp,
      step,
    );
  }

  const renameLayer = text.match(INDESIGN_RENAME_LAYER_RE);
  if (renameLayer?.[1] && renameLayer[2]) {
    return withStandaloneInDesignContext(
      indesignRenameLayerActions(cleanTypedText(renameLayer[1]), cleanTypedText(renameLayer[2])),
      currentApp,
      step,
    );
  }

  const selectLayer = text.match(INDESIGN_SELECT_LAYER_RE);
  if (selectLayer?.[1]) {
    const layerName = cleanTypedText(selectLayer[1]);
    return withStandaloneInDesignContext([
      photoshopMenu(['Window', 'Layers'], 'local-indesign-layers-panel'),
      photoshopWait(500),
      photoshopClick(layerName, 'local-indesign-select-layer'),
    ], currentApp, step);
  }

  const moveToLayer = text.match(INDESIGN_MOVE_SELECTION_TO_LAYER_RE);
  if (moveToLayer?.[1]) {
    const layerName = cleanTypedText(moveToLayer[1]);
    return withStandaloneInDesignContext([
      photoshopMenu(['Window', 'Layers'], 'local-indesign-layers-panel'),
      photoshopWait(500),
      photoshopKey('Cmd+X', 'local-cut-selection-shortcut'),
      photoshopClick(layerName, 'local-indesign-select-target-layer'),
      photoshopWait(300),
      photoshopKey('Cmd+Opt+Shift+V', 'local-indesign-paste-in-place'),
    ], currentApp, step);
  }

  const placeOnLayer = text.match(INDESIGN_PLACE_FILE_ON_LAYER_RE);
  if (placeOnLayer) {
    const targetPath = cleanFileDialogPathMatch(placeOnLayer);
    const layerName = cleanTypedText(placeOnLayer[4] || '');
    return withStandaloneInDesignContext([
      photoshopMenu(['Window', 'Layers'], 'local-indesign-layers-panel'),
      photoshopWait(500),
      photoshopClick(layerName, 'local-indesign-select-target-layer'),
      photoshopMenu(['File', 'Place...'], 'local-indesign-place-file'),
      photoshopWait(800),
      ...fileDialogPathEntry(targetPath),
      photoshopWait(400),
      photoshopMenu(['Object', 'Fitting', 'Fill Frame Proportionally'], 'local-indesign-banner-fill-frame'),
    ], currentApp, step);
  }

  const applyStyle = text.match(INDESIGN_APPLY_STYLE_RE);
  if (applyStyle?.[2]) {
    return withStandaloneInDesignContext(
      indesignApplyStyleActions(applyStyle[1], cleanTypedText(applyStyle[2])),
      currentApp,
      step,
    );
  }

  const resizeSelection = text.match(INDESIGN_RESIZE_SELECTION_RE);
  if (resizeSelection?.[1] && resizeSelection[2]) {
    return withStandaloneInDesignContext(
      indesignResizeSelectionActions(resizeSelection[1], resizeSelection[2], resizeSelection[3]),
      currentApp,
      step,
    );
  }

  const textAlign = text.match(INDESIGN_TEXT_ALIGN_RE);
  if (textAlign?.[1]) {
    return withStandaloneInDesignContext([
      photoshopKey(indesignTextAlignmentCombo(textAlign[1]), 'local-indesign-text-align-shortcut'),
    ], currentApp, step);
  }

  const textCase = text.match(INDESIGN_TEXT_CASE_RE);
  if (textCase?.[1]) {
    return withStandaloneInDesignContext([
      photoshopMenu(['Type', 'Change Case', indesignChangeCaseMenuLabel(textCase[1])], 'local-indesign-change-case'),
    ], currentApp, step);
  }

  const alignSelection = text.match(INDESIGN_ALIGN_SELECTION_RE);
  if (alignSelection?.[1]) {
    return withStandaloneInDesignContext(
      indesignAlignSelectionActions(alignSelection[1], alignSelection[2]),
      currentApp,
      step,
    );
  }

  const relinkFile = text.match(INDESIGN_RELINK_FILE_RE);
  if (relinkFile) {
    return withStandaloneInDesignContext([
      {
        route: true,
        kind: 'indesign_relink_asset',
        appQuery: 'InDesign',
        assetPath: cleanFileDialogPathMatch(relinkFile),
        reason: 'local-indesign-relink-asset',
      },
    ], currentApp, step);
  }

  const proofExport = text.match(INDESIGN_PROOF_EXPORT_RE);
  if (proofExport) {
    return withStandaloneInDesignContext(
      [
        {
          route: true,
          kind: 'indesign_export_proof',
          outputPath: cleanTypedText(proofExport[1] || 'proof.pdf'),
          format: 'pdf',
          reason: 'local-indesign-proof-export',
        },
      ],
      currentApp,
      step,
    );
  }

  const packageHandoff = text.match(INDESIGN_PACKAGE_HANDOFF_RE);
  if (packageHandoff) {
    return withStandaloneInDesignContext(indesignPackageHandoffActions(packageHandoff), currentApp, step);
  }

  const exportPageRange = text.match(INDESIGN_EXPORT_PAGE_RANGE_RE);
  if (exportPageRange?.[1] && exportPageRange[2]) {
    return withStandaloneInDesignContext([
      photoshopMenu(['File', 'Export...'], 'local-indesign-export-page-range'),
      photoshopWait(900),
      { route: true, kind: 'paste_text', text: cleanTypedText(exportPageRange[2]), reason: 'local-save-dialog-filename' },
      photoshopKey('Return', 'local-confirm-dialog-shortcut'),
      photoshopWait(1000),
      photoshopSetField('Range', cleanTypedText(exportPageRange[1])),
      photoshopClick('Export', 'local-indesign-export-confirm'),
    ], currentApp, step);
  }

  const duplicatePage = text.match(INDESIGN_DUPLICATE_PAGE_RE);
  if (duplicatePage?.[1]) {
    const isPage = /\bpage\b/i.test(duplicatePage[1]);
    return withStandaloneInDesignContext([
      photoshopMenu(['Window', 'Pages'], 'local-indesign-pages-panel'),
      photoshopWait(500),
      photoshopMenu(['Layout', 'Pages', isPage ? 'Duplicate Page' : 'Duplicate Spread'], 'local-indesign-duplicate-page-or-spread'),
    ], currentApp, step);
  }

  const linksAction = text.match(INDESIGN_LINKS_ACTION_RE);
  if (linksAction?.[1]) {
    const action = indesignLinksActionLabel(linksAction[1]);
    return withStandaloneInDesignContext([
      photoshopMenu(['Window', 'Links'], 'local-indesign-links-panel'),
      photoshopWait(500),
      photoshopClick(action.label, action.reason),
    ], currentApp, step);
  }

  const selectedObjectAction = text.match(INDESIGN_SELECTED_OBJECT_ACTION_RE);
  if (selectedObjectAction) {
    return withStandaloneInDesignContext(indesignSelectedObjectActions(text), currentApp, step);
  }

  const layerAction = text.match(INDESIGN_LAYER_ACTION_RE);
  if (layerAction?.[1] && layerAction[2]) {
    const layerName = cleanTypedText(layerAction[2]);
    return withStandaloneInDesignContext([
      {
        route: true,
        kind: 'indesign_set_layer_state',
        appQuery: 'InDesign',
        targetLabel: layerName,
        layerStateAction: normalizeInDesignLayerStateAction(layerAction[1]),
        reason: 'local-indesign-set-layer-state',
      },
    ], currentApp, step);
  }

  const newSwatch = text.match(INDESIGN_NEW_SWATCH_RE);
  if (newSwatch?.[1] && newSwatch[2]) {
    return withStandaloneInDesignContext(
      indesignNewSwatchActions(cleanTypedText(newSwatch[1]), newSwatch[2]),
      currentApp,
      step,
    );
  }

  const applySwatch = text.match(INDESIGN_APPLY_SWATCH_RE);
  if (applySwatch) {
    const target = applySwatch[1] || applySwatch[3] || '';
    const swatchName = cleanTypedText(applySwatch[2] || applySwatch[4] || '');
    if (swatchName) {
      return withStandaloneInDesignContext(
        indesignApplySwatchActions(target, swatchName),
        currentApp,
        step,
      );
    }
  }

  const textWrap = text.match(INDESIGN_TEXT_WRAP_RE);
  if (textWrap) {
    return withStandaloneInDesignContext(
      indesignTextWrapActions(textWrap[1] || textWrap[2]),
      currentApp,
      step,
    );
  }

  const applyParent = text.match(INDESIGN_APPLY_PARENT_RE);
  if (applyParent?.[1] && applyParent[2]) {
    return withStandaloneInDesignContext(
      indesignApplyParentActions(cleanTypedText(applyParent[1]), applyParent[2]),
      currentApp,
      step,
    );
  }

  const createGuides = text.match(INDESIGN_CREATE_GUIDES_RE);
  if (createGuides) {
    return withStandaloneInDesignContext(
      indesignCreateGuidesActions(createGuides[1], createGuides[2]),
      currentApp,
      step,
    );
  }

  const textToImage = text.match(INDESIGN_TEXT_TO_IMAGE_RE);
  if (textToImage?.[1]) {
    const prompt = cleanTypedText(textToImage[1]);
    return withStandaloneInDesignContext([
      photoshopMenu(['File', 'Generate'], 'local-indesign-generate-panel'),
      photoshopWait(1000),
      photoshopClick('Text to Image', 'local-indesign-text-to-image'),
      photoshopWait(700),
      { route: true, kind: 'paste_text', text: prompt, reason: 'local-indesign-ai-prompt' },
      photoshopClick('Generate', 'local-indesign-ai-generate'),
      photoshopWait(2500),
    ], currentApp, step);
  }

  const generativeExpand = text.match(INDESIGN_GENERATIVE_EXPAND_RE);
  if (generativeExpand) {
    const prompt = cleanTypedText(generativeExpand[1] || '');
    return withStandaloneInDesignContext([
      photoshopMenu(['Window', 'Contextual Task Bar'], 'local-indesign-contextual-task-bar'),
      photoshopWait(500),
      photoshopClick('Generative Expand', 'local-indesign-generative-expand'),
      photoshopWait(800),
      ...(prompt ? [{ route: true, kind: 'paste_text', text: prompt, reason: 'local-indesign-ai-prompt' } as LocalComputerAwarenessIntent] : []),
      photoshopClick('Generate', 'local-indesign-ai-generate'),
      photoshopWait(2500),
    ], currentApp, step);
  }

  const generativeFill = text.match(INDESIGN_GENERATIVE_FILL_RE);
  if (generativeFill) {
    const prompt = cleanTypedText(generativeFill[1] || '');
    return withStandaloneInDesignContext([
      photoshopMenu(['Window', 'Contextual Task Bar'], 'local-indesign-contextual-task-bar'),
      photoshopWait(500),
      photoshopClick('Generative Fill', 'local-indesign-generative-fill'),
      photoshopWait(800),
      ...(prompt ? [{ route: true, kind: 'paste_text', text: prompt, reason: 'local-indesign-ai-prompt' } as LocalComputerAwarenessIntent] : []),
      photoshopClick('Generate', 'local-indesign-ai-generate'),
      photoshopWait(2500),
    ], currentApp, step);
  }

  if (INDESIGN_GENERATE_ALT_TEXT_RE.test(text)) {
    return withStandaloneInDesignContext([
      photoshopMenu(['Object', 'Object Export Options...'], 'local-indesign-object-export-options'),
      photoshopWait(800),
      photoshopClick('Alt Text', 'local-indesign-alt-text-tab'),
      photoshopWait(400),
      photoshopClick('Generate Alt Text', 'local-indesign-generate-alt-text'),
      photoshopWait(1000),
      photoshopClick('Done', 'local-indesign-object-export-options-done'),
    ], currentApp, step);
  }

  if (INDESIGN_BROCHURE_LAYOUT_RE.test(text)) {
    const isTrifold = /\btri-?fold|three\s+panel|brochure\b/i.test(text);
    const pageCount = /\bmagazine\s+spread\b/i.test(text) ? '2' : '1';
    const columns = isTrifold ? '3' : /\bnewsletter\b/i.test(text) ? '2' : '1';
    return withStandaloneInDesignContext([
      photoshopKey('Cmd+N', 'local-new-document-shortcut'),
      photoshopWait(800),
      photoshopSetField('Pages', pageCount),
      photoshopSetField('Columns', columns),
      photoshopClick('Create', 'local-indesign-create-layout-document'),
      photoshopWait(1200),
      photoshopMenu(['Layout', 'Margins and Columns...'], 'local-indesign-margins-columns'),
      photoshopWait(600),
      photoshopSetField('Columns', columns),
      photoshopConfirmDialog(),
      photoshopMenu(['Window', 'Styles', 'Paragraph Styles'], 'local-indesign-paragraph-styles'),
      photoshopMenu(['Window', 'Links'], 'local-indesign-links-panel'),
    ], currentApp, step);
  }

  if (INDESIGN_ACCESSIBLE_EXPORT_PREP_RE.test(text)) {
    return withStandaloneInDesignContext([
      photoshopMenu(['Window', 'Output', 'Preflight'], 'local-indesign-preflight-panel'),
      photoshopWait(400),
      photoshopMenu(['Object', 'Object Export Options...'], 'local-indesign-object-export-options'),
      photoshopWait(800),
      photoshopClick('Alt Text', 'local-indesign-alt-text-tab'),
      photoshopClick('Generate Alt Text', 'local-indesign-generate-alt-text'),
      photoshopWait(1000),
      photoshopClick('Done', 'local-indesign-object-export-options-done'),
      photoshopMenu(['File', 'Export...'], 'local-indesign-export-file'),
    ], currentApp, step);
  }

  const placeFile = text.match(INDESIGN_PLACE_FILE_RE);
  if (placeFile) {
    const targetPath = cleanFileDialogPathMatch(placeFile);
    return withStandaloneInDesignContext([
      photoshopMenu(['File', 'Place...'], 'local-indesign-place-file'),
      photoshopWait(800),
      ...fileDialogPathEntry(targetPath),
    ], currentApp, step);
  }

  const namedExportPreset = text.match(INDESIGN_EXPORT_NAMED_PRESET_RE);
  if (namedExportPreset) {
    const preset = cleanTypedText(namedExportPreset[1] || '');
    const filename = cleanTypedText(namedExportPreset[2] || '');
    return withStandaloneInDesignContext([
      photoshopMenu(['File', 'Adobe PDF Presets', `${preset}...`], 'local-indesign-export-named-pdf-preset'),
      photoshopWait(900),
      ...(filename ? [
        { route: true, kind: 'paste_text', text: filename, reason: 'local-save-dialog-filename' } as LocalComputerAwarenessIntent,
        photoshopKey('Return', 'local-confirm-dialog-shortcut'),
        photoshopWait(1000),
      ] : []),
      photoshopClick('Export', 'local-indesign-export-confirm'),
    ], currentApp, step);
  }

  const exportPreset = text.match(INDESIGN_EXPORT_PRESET_RE);
  if (exportPreset) {
    const preset = String(exportPreset[1] || '').toLowerCase();
    const menuPath = /\binteractive|web\b/.test(preset)
      ? ['File', 'Export...']
      : /\bsmallest\b/.test(preset)
        ? ['File', 'Adobe PDF Presets', 'Smallest File Size...']
        : /\bpress\b/.test(preset)
          ? ['File', 'Adobe PDF Presets', 'Press Quality...']
          : ['File', 'Adobe PDF Presets', 'High Quality Print...'];
    const filename = cleanTypedText(exportPreset[2] || '');
    return withStandaloneInDesignContext([
      photoshopMenu(menuPath, 'local-indesign-export-pdf-preset'),
      photoshopWait(900),
      ...(filename ? [
        { route: true, kind: 'paste_text', text: filename, reason: 'local-save-dialog-filename' } as LocalComputerAwarenessIntent,
        photoshopKey('Return', 'local-confirm-dialog-shortcut'),
        photoshopWait(1000),
      ] : []),
      photoshopClick('Export', 'local-indesign-export-confirm'),
    ], currentApp, step);
  }

  const exportFile = text.match(INDESIGN_EXPORT_FILE_RE);
  if (exportFile?.[1]) {
    const filename = cleanTypedText(exportFile[1]);
    return withStandaloneInDesignContext([
      photoshopMenu(['File', 'Export...'], 'local-indesign-export-file'),
      photoshopWait(900),
      { route: true, kind: 'paste_text', text: filename, reason: 'local-save-dialog-filename' },
      photoshopKey('Return', 'local-confirm-dialog-shortcut'),
      photoshopWait(1000),
      photoshopClick('Export', 'local-indesign-export-confirm'),
    ], currentApp, step);
  }

  const goToPage = text.match(INDESIGN_GO_TO_PAGE_RE);
  if (goToPage?.[1]) {
    return withStandaloneInDesignContext([
      photoshopMenu(['Layout', 'Go to Page...'], 'local-indesign-go-to-page'),
      photoshopWait(500),
      { route: true, kind: 'paste_text', text: goToPage[1], reason: 'local-indesign-page-number' },
      photoshopKey('Return', 'local-confirm-dialog-shortcut'),
    ], currentApp, step);
  }

  const insertPages = text.match(INDESIGN_INSERT_PAGES_RE);
  if (insertPages) {
    const count = String(parseDurationAmount(insertPages[1] || '1'));
    return withStandaloneInDesignContext([
      photoshopMenu(['Layout', 'Pages', 'Insert Pages...'], 'local-indesign-insert-pages'),
      photoshopWait(600),
      photoshopSetField('Pages', count),
      photoshopKey('Return', 'local-confirm-dialog-shortcut'),
    ], currentApp, step);
  }

  if (INDESIGN_FIND_CHANGE_RE.test(text)) {
    return withStandaloneInDesignContext([
      photoshopMenu(['Edit', 'Find/Change...'], 'local-indesign-find-change'),
    ], currentApp, step);
  }

  const batchFindChangePairs = extractInDesignBatchFindChangePairs(text);
  if (batchFindChangePairs.length >= 2) {
    return withStandaloneInDesignContext([
      {
        route: true,
        kind: 'indesign_batch_find_change',
        appQuery: 'InDesign',
        replacements: batchFindChangePairs,
        reason: 'local-indesign-batch-find-change',
      },
    ], currentApp, step);
  }

  const simpleFindChange = text.match(INDESIGN_SIMPLE_FIND_CHANGE_RE);
  const findText = cleanTypedText(simpleFindChange?.[1] || simpleFindChange?.[3] || '');
  const changeText = cleanTypedText(simpleFindChange?.[2] || simpleFindChange?.[4] || '');
  if (findText && changeText) {
    return withStandaloneInDesignContext(
      indesignFindChangeActions(findText, changeText),
      currentApp,
      step,
    );
  }

  const fitFrame = text.match(INDESIGN_FIT_FRAME_RE);
  if (fitFrame) {
    const mode = String(fitFrame[1] || text).toLowerCase();
    const label = /\bframe\s+to\s+content|to\s+content\b/.test(mode)
      ? 'Fit Frame to Content'
      : /\bfill\b|\bframe\s+proportionally\b/.test(text)
        ? 'Fill Frame Proportionally'
        : /\bcenter\b/.test(mode)
          ? 'Center Content'
          : 'Fit Content Proportionally';
    return withStandaloneInDesignContext([
      photoshopMenu(['Object', 'Fitting', label], 'local-indesign-frame-fitting'),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:package|collect)\s+(?:the\s+)?(?:document|indesign\s+file|file|project)\s*$/i.test(text)) {
    return withStandaloneInDesignContext(indesignPackageHandoffActions(null), currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:open|show|toggle)\s+(?:the\s+)?preflight(?:\s+panel)?\s*$/i.test(text)) {
    return withStandaloneInDesignContext([
      photoshopMenu(['Window', 'Output', 'Preflight'], 'local-indesign-preflight-panel'),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:open|show|toggle)\s+(?:the\s+)?links(?:\s+panel)?\s*$/i.test(text)) {
    return withStandaloneInDesignContext([
      photoshopMenu(['Window', 'Links'], 'local-indesign-links-panel'),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:open|show|toggle)\s+(?:the\s+)?pages(?:\s+panel)?\s*$/i.test(text)) {
    return withStandaloneInDesignContext([
      photoshopMenu(['Window', 'Pages'], 'local-indesign-pages-panel'),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:open|show|toggle)\s+(?:the\s+)?paragraph\s+styles(?:\s+panel)?\s*$/i.test(text)) {
    return withStandaloneInDesignContext([
      photoshopMenu(['Window', 'Styles', 'Paragraph Styles'], 'local-indesign-paragraph-styles'),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:open|show|toggle)\s+(?:the\s+)?character\s+styles(?:\s+panel)?\s*$/i.test(text)) {
    return withStandaloneInDesignContext([
      photoshopMenu(['Window', 'Styles', 'Character Styles'], 'local-indesign-character-styles'),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:open|show|toggle)\s+(?:the\s+)?(?:layers?|swatches|stroke|color|gradient|effects|object\s+styles|text\s+wrap|hyperlinks|bookmarks|buttons\s+and\s+forms)(?:\s+panel)?\s*$/i.test(text)) {
    const menuPath = /\bobject\s+styles\b/i.test(text)
      ? ['Window', 'Styles', 'Object Styles']
      : /\btext\s+wrap\b/i.test(text)
        ? ['Window', 'Text Wrap']
        : /\bhyperlinks\b/i.test(text)
          ? ['Window', 'Interactive', 'Hyperlinks']
          : /\bbookmarks\b/i.test(text)
            ? ['Window', 'Interactive', 'Bookmarks']
            : /\bbuttons\s+and\s+forms\b/i.test(text)
              ? ['Window', 'Interactive', 'Buttons and Forms']
              : /\bswatches\b/i.test(text)
                ? ['Window', 'Color', 'Swatches']
                : /\bstroke\b/i.test(text)
                  ? ['Window', 'Stroke']
                  : /\bgradient\b/i.test(text)
                    ? ['Window', 'Color', 'Gradient']
                    : /\beffects\b/i.test(text)
                      ? ['Window', 'Effects']
                      : /\bcolor\b/i.test(text)
                        ? ['Window', 'Color', 'Color']
                        : ['Window', 'Layers'];
    return withStandaloneInDesignContext([
      photoshopMenu(menuPath, 'local-indesign-panel'),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:open|show|change|edit)\s+(?:the\s+)?document\s+setup\s*$/i.test(text)) {
    return withStandaloneInDesignContext([
      photoshopMenu(['File', 'Document Setup...'], 'local-indesign-document-setup'),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:open|show|change|edit)\s+(?:the\s+)?(?:margins?\s+and\s+columns?|columns?\s+and\s+margins?)\s*$/i.test(text)) {
    return withStandaloneInDesignContext([
      photoshopMenu(['Layout', 'Margins and Columns...'], 'local-indesign-margins-columns'),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:create|convert|make)\s+(?:text\s+)?outlines?\s*$/i.test(text)) {
    return withStandaloneInDesignContext([
      photoshopMenu(['Type', 'Create Outlines'], 'local-indesign-create-outlines'),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:find|replace|fix)\s+(?:missing\s+)?fonts?\s*$/i.test(text)) {
    return withStandaloneInDesignContext([
      photoshopMenu(['Type', 'Find/Replace Font...'], 'local-indesign-find-font'),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:check|run)\s+(?:the\s+)?(?:spelling|spell\s*check)\s*$/i.test(text)) {
    return withStandaloneInDesignContext([
      photoshopMenu(['Edit', 'Spelling', 'Check Spelling...'], 'local-indesign-check-spelling'),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:show|hide|toggle)\s+(?:the\s+)?hidden\s+characters?\s*$/i.test(text)) {
    return withStandaloneInDesignContext([
      photoshopMenu(['Type', 'Show Hidden Characters'], 'local-indesign-hidden-characters'),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:insert|add)\s+(?:the\s+)?(?:current\s+)?page\s+number\s*$/i.test(text)) {
    return withStandaloneInDesignContext([
      photoshopMenu(['Type', 'Insert Special Character', 'Markers', 'Current Page Number'], 'local-indesign-current-page-number'),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:insert|add|create)\s+(?:a\s+)?footnote\s*$/i.test(text)) {
    return withStandaloneInDesignContext([
      photoshopMenu(['Type', 'Insert Footnote'], 'local-indesign-insert-footnote'),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:create|generate|make|update)\s+(?:the\s+)?(?:table\s+of\s+contents|toc)\s*$/i.test(text)) {
    return withStandaloneInDesignContext([
      photoshopMenu(['Layout', 'Table of Contents...'], 'local-indesign-table-of-contents'),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:create|generate|make)\s+(?:a\s+)?qr\s+code\s*$/i.test(text)) {
    return withStandaloneInDesignContext([
      photoshopMenu(['Object', 'Generate QR Code...'], 'local-indesign-generate-qr-code'),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:open|show|edit)\s+(?:the\s+)?(?:numbering\s+and\s+section\s+options|section\s+options)\s*$/i.test(text)) {
    return withStandaloneInDesignContext([
      photoshopMenu(['Layout', 'Numbering & Section Options...'], 'local-indesign-numbering-section-options'),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:create|make|open)\s+(?:a\s+)?(?:new\s+)?book\s*$/i.test(text)) {
    return withStandaloneInDesignContext([
      photoshopMenu(['File', 'New', 'Book...'], 'local-indesign-new-book'),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:create|make|open)\s+(?:an?\s+)?alternate\s+layout\s*$/i.test(text)) {
    return withStandaloneInDesignContext([
      photoshopMenu(['Layout', 'Create Alternate Layout...'], 'local-indesign-alternate-layout'),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:relink|update\s+link|update\s+links)\s*(?:file|image|asset|selection|selected\s+link)?\s*$/i.test(text)) {
    return withStandaloneInDesignContext([
      photoshopMenu(['Window', 'Links'], 'local-indesign-links-panel'),
      photoshopWait(400),
      photoshopClick(/\brelink\b/i.test(text) ? 'Relink' : 'Update Link', /\brelink\b/i.test(text) ? 'local-indesign-relink' : 'local-indesign-update-link'),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:open|show|toggle)\s+(?:the\s+)?(?:separations\s+preview|flattener\s+preview)(?:\s+panel)?\s*$/i.test(text)) {
    const panel = /\bflattener\b/i.test(text) ? 'Flattener Preview' : 'Separations Preview';
    return withStandaloneInDesignContext([
      photoshopMenu(['Window', 'Output', panel], 'local-indesign-output-preview-panel'),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:toggle|show|hide)\s+(?:the\s+)?(?:rulers?|guides?|smart\s+guides|baseline\s+grid|document\s+grid)\s*$/i.test(text)) {
    const menuPath = /\bsmart\s+guides\b/i.test(text)
      ? ['View', 'Grids & Guides', 'Smart Guides']
      : /\bbaseline\s+grid\b/i.test(text)
        ? ['View', 'Grids & Guides', 'Show Baseline Grid']
        : /\bdocument\s+grid\b/i.test(text)
          ? ['View', 'Grids & Guides', 'Show Document Grid']
          : /\bguides?\b/i.test(text)
            ? ['View', 'Grids & Guides', 'Show Guides']
            : ['View', 'Show Rulers'];
    return withStandaloneInDesignContext([
      photoshopMenu(menuPath, 'local-indesign-view-toggle'),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:convert)\s+(?:selected\s+)?text\s+to\s+table\s*$/i.test(text)) {
    return withStandaloneInDesignContext([
      photoshopMenu(['Table', 'Convert Text to Table...'], 'local-indesign-convert-text-to-table'),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:insert|create|make)\s+(?:a\s+)?table\s*$/i.test(text)) {
    return withStandaloneInDesignContext([
      photoshopMenu(['Table', 'Insert Table...'], 'local-indesign-insert-table'),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:select|choose|use|switch\s+to|open)\s+(?:the\s+)?type\s+tool\s*$/i.test(text)) {
    return withStandaloneInDesignContext([photoshopKey('T', 'local-indesign-type-tool')], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:select|choose|use|switch\s+to|open)\s+(?:the\s+)?selection\s+tool\s*$/i.test(text)) {
    return withStandaloneInDesignContext([photoshopKey('V', 'local-indesign-selection-tool')], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:select|choose|use|switch\s+to|open)\s+(?:the\s+)?rectangle\s+frame\s+tool\s*$/i.test(text)) {
    return withStandaloneInDesignContext([photoshopKey('F', 'local-indesign-rectangle-frame-tool')], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:preview|toggle\s+preview|switch\s+to\s+preview)(?:\s+mode)?\s*$/i.test(text)) {
    return withStandaloneInDesignContext([photoshopKey('W', 'local-indesign-preview-mode')], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:open|show|toggle)\s+(?:the\s+)?(?:data\s+merge|scripts?|script\s+label|align|pathfinder|transform|info|control|properties)(?:\s+panel)?\s*$/i.test(text)) {
    const menuPath = /\bdata\s+merge\b/i.test(text)
      ? ['Window', 'Utilities', 'Data Merge']
      : /\bscripts?\b/i.test(text)
        ? ['Window', 'Utilities', 'Scripts']
        : /\bscript\s+label\b/i.test(text)
          ? ['Window', 'Utilities', 'Script Label']
          : /\balign\b/i.test(text)
            ? ['Window', 'Object & Layout', 'Align']
            : /\bpathfinder\b/i.test(text)
              ? ['Window', 'Object & Layout', 'Pathfinder']
              : /\btransform\b/i.test(text)
                ? ['Window', 'Object & Layout', 'Transform']
                : /\binfo\b/i.test(text)
                  ? ['Window', 'Info']
                  : /\bcontrol\b/i.test(text)
                    ? ['Window', 'Control']
                    : ['Window', 'Properties'];
    return withStandaloneInDesignContext([
      photoshopMenu(menuPath, 'local-indesign-utility-panel'),
    ], currentApp, step);
  }

  if (/^\s*(?:please\s+)?(?:bring\s+to\s+front|send\s+to\s+back)\s*$/i.test(text)) {
    const label = /\bbring\b/i.test(text) ? 'Bring to Front' : 'Send to Back';
    return withStandaloneInDesignContext([
      photoshopMenu(['Object', 'Arrange', label], 'local-indesign-arrange-object'),
    ], currentApp, step);
  }

  return [];
}

function cleanKeyCombo(value: string): string {
  const normalized = String(value || '')
    .replace(/\b(?:key|keys|keyboard shortcut|shortcut)\b/gi, ' ')
    .replace(/\bcommand\b/gi, 'Cmd')
    .replace(/\bcontrol\b/gi, 'Ctrl')
    .replace(/\boption\b/gi, 'Opt')
    .replace(/\b(?:alt|alternate)\b/gi, 'Opt')
    .replace(/\benter\b/gi, 'Return')
    .replace(/\besc\b/gi, 'Escape')
    .replace(/\bspace\s*bar\b/gi, 'Space')
    .replace(/\bleft\s+arrow\b|\barrow\s+left\b/gi, 'Left')
    .replace(/\bright\s+arrow\b|\barrow\s+right\b/gi, 'Right')
    .replace(/\bup\s+arrow\b|\barrow\s+up\b/gi, 'Up')
    .replace(/\bdown\s+arrow\b|\barrow\s+down\b/gi, 'Down')
    .replace(/\bpage\s+down\b/gi, 'PageDown')
    .replace(/\bpage\s+up\b/gi, 'PageUp')
    .replace(/\s*\+\s*/g, '+')
    .replace(/\s+/g, ' ')
    .trim();
  const parts = normalized.split(/\s+/).filter(Boolean);
  const modifiers = /^(cmd|command|ctrl|control|shift|opt|option|alt|fn|meta|super)$/i;
  if (!normalized.includes('+') && parts.length >= 2 && parts.slice(0, -1).every((part) => modifiers.test(part))) {
    return [...parts.slice(0, -1), parts[parts.length - 1]].join('+');
  }
  return normalized;
}

function looksLikeKeyCombo(value: string): boolean {
  const combo = cleanKeyCombo(value);
  const modifier = '(?:cmd|command|meta|super|shift|opt|option|alt|ctrl|control|fn)';
  const key = '(?:[a-z0-9]|[,.\\-=`\\[\\]]|return|enter|tab|space|delete|escape|esc|left|right|up|down|home|end|pageup|pagedown|page-up|page-down|f1|f2|f3|f4|f5|f6|f7|f8|f9|f10|f11|f12)';
  return new RegExp(`^(?:${modifier}\\+){0,4}${key}$`, 'i').test(combo);
}

function cleanMenuPath(value: string): string[] {
  return String(value || '')
    .split(/\s*(?:>|→|›)\s*/g)
    .map((part) => part
      .replace(/\b(the|a|an)\b/gi, ' ')
      .replace(/\b(menu item|menu|item)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim())
    .filter(Boolean)
    .slice(0, 6);
}

function scrollDeltas(direction: string, amountRaw?: string): { deltaX: number; deltaY: number } {
  const amount = Math.max(80, Math.min(2000, Math.trunc(Number(amountRaw || 520))));
  const dir = direction.toLowerCase();
  if (dir === 'up') return { deltaX: 0, deltaY: -amount };
  if (dir === 'left') return { deltaX: -amount, deltaY: 0 };
  if (dir === 'right') return { deltaX: amount, deltaY: 0 };
  return { deltaX: 0, deltaY: amount };
}

function parseDurationAmount(amountRaw?: string): number {
  const raw = String(amountRaw || '1').trim().toLowerCase();
  if (!raw) return 1;
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) return numeric;
  const words: Record<string, number> = {
    a: 1,
    an: 1,
    half: 0.5,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
    fifteen: 15,
    twenty: 20,
    thirty: 30,
  };
  return words[raw] || 1;
}

function waitDurationMs(amountRaw?: string, unitRaw?: string): number {
  const amount = Math.max(0.5, Math.min(120, parseDurationAmount(amountRaw)));
  const unit = String(unitRaw || 'seconds').toLowerCase();
  const millis = unit === 'ms' || unit.startsWith('millisecond');
  return millis
    ? Math.max(50, Math.min(30_000, Math.round(amount)))
    : Math.max(250, Math.min(30_000, Math.round(amount * 1000)));
}

function parseAppKeyAction(text: string): LocalComputerAwarenessIntent | null {
  for (const action of APP_KEY_ACTIONS) {
    const match = text.match(action.re);
    if (!match) continue;
    return {
      route: true,
      kind: 'press_keys',
      combo: action.combo,
      appQuery: cleanOptionalShortcutAppQuery(match[action.appGroup || 1]),
      reason: action.reason,
    };
  }
  return null;
}

function parseOrdinalTabIndex(value: string | undefined): number | null {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;
  const numeric = Number(raw.replace(/(?:st|nd|rd|th)$/i, ''));
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 9) return numeric;
  const ordinals: Record<string, number> = {
    first: 1,
    second: 2,
    third: 3,
    fourth: 4,
    fifth: 5,
    sixth: 6,
    seventh: 7,
    eighth: 8,
    ninth: 9,
  };
  return ordinals[raw] || null;
}

function parseDynamicAppKeyAction(text: string): LocalComputerAwarenessIntent | null {
  const tabNumber = text.match(/^\s*(?:please\s+)?(?:go\s+to|switch\s+to|activate|select|open)\s+(?:the\s+)?(?:(?:tab|browser\s+tab)\s+)?(\d(?:st|nd|rd|th)?|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth)(?:\s+(?:tab|browser\s+tab))?(?:\s+(?:in|inside|on)\s+(.+?)(?:\s+(?:app|application|window|browser))?)?\s*[.!?]?\s*$/i);
  const index = parseOrdinalTabIndex(tabNumber?.[1]);
  if (index) {
    return {
      route: true,
      kind: 'press_keys',
      combo: `Cmd+${index}`,
      appQuery: cleanOptionalShortcutAppQuery(tabNumber?.[2]),
      reason: 'local-numbered-tab-shortcut',
    };
  }
  return null;
}

function normalizeWindowAction(action: string): LocalComputerAwarenessIntent['windowAction'] {
  const normalized = action.toLowerCase();
  if (normalized.startsWith('min')) return 'minimize';
  if (normalized.startsWith('unmin')) return 'unminimize';
  if (normalized.startsWith('max') || normalized === 'zoom') return 'zoom';
  if (normalized === 'raise') return 'raise';
  return 'focus';
}

function inferBrowsers(message: string): string[] | undefined {
  const browsers: string[] = [];
  if (CHROME_RE.test(message)) browsers.push('chrome');
  if (SAFARI_RE.test(message)) browsers.push('safari');
  if (BRAVE_RE.test(message)) browsers.push('brave');
  if (EDGE_RE.test(message)) browsers.push('edge');
  if (ARC_RE.test(message)) browsers.push('arc');
  if (OPERA_RE.test(message)) browsers.push('opera');
  if (VIVALDI_RE.test(message)) browsers.push('vivaldi');
  return browsers.length > 0 ? Array.from(new Set(browsers)) : undefined;
}

export function detectLocalComputerAwarenessIntent(message: string): LocalComputerAwarenessIntent {
  const text = String(message || '').trim();
  if (!text) return { route: false, kind: null, reason: 'empty' };
  const openUrl = text.match(OPEN_URL_RE);
  if (openUrl?.[1]) return { route: true, kind: 'open_url', url: openUrl[1].trim(), reason: 'local-open-url' };
  const bareUrl = text.match(OPEN_BARE_URL_RE);
  if (bareUrl?.[1]) return { route: true, kind: 'open_url', url: `https://${bareUrl[1].trim()}`, reason: 'local-open-url' };
  const openPath = text.match(OPEN_PATH_RE);
  if (openPath?.[1]) return { route: true, kind: 'open_path', path: openPath[1].trim(), reason: 'local-open-path' };
  if (CLIPBOARD_CLEAR_RE.test(text)) return { route: true, kind: 'clipboard_clear', reason: 'local-clipboard-clear' };
  const clipboardWrite =
    text.match(CLIPBOARD_WRITE_RE) ||
    text.match(CLIPBOARD_WRITE_AFTER_RE) ||
    text.match(CLIPBOARD_SET_TO_RE);
  if (clipboardWrite?.[1]) {
    return { route: true, kind: 'clipboard_write', text: clipboardWrite[1].trim(), reason: 'local-clipboard-write' };
  }
  const dynamicAppKeyAction = parseDynamicAppKeyAction(text);
  if (dynamicAppKeyAction) return dynamicAppKeyAction;
  const appKeyAction = parseAppKeyAction(text);
  if (appKeyAction) return appKeyAction;
  const batchFindChangePairs = extractInDesignBatchFindChangePairs(text);
  if (batchFindChangePairs.length >= 2) {
    return {
      route: true,
      kind: 'indesign_batch_find_change',
      appQuery: 'InDesign',
      replacements: batchFindChangePairs,
      reason: 'local-indesign-batch-find-change',
    };
  }
  const dealerMultiUpdates = extractInDesignDealerMultiUpdates(text);
  if (dealerMultiUpdates.length >= 2) {
    return {
      route: true,
      kind: 'indesign_batch_update_text_layers',
      appQuery: 'InDesign',
      fieldUpdates: dealerMultiUpdates.map((update) => ({
        fieldName: update.field,
        replacementText: update.replacement,
      })),
      reason: 'local-indesign-batch-update-text-layers',
    };
  }
  if (INDESIGN_DOCUMENT_STATUS_RE.test(text)) {
    return {
      route: true,
      kind: 'indesign_document_status',
      appQuery: 'InDesign',
      reason: 'local-indesign-document-status',
    };
  }
  if (INDESIGN_TEXT_INVENTORY_RE.test(text)) {
    return {
      route: true,
      kind: 'indesign_text_inventory',
      appQuery: 'InDesign',
      query: cleanTypedText(text.match(/\b(?:for|matching|about|called|named)\s+["'`]?([^"'`\n\r]{1,120})["'`]?\s*$/i)?.[1] || ''),
      reason: 'local-indesign-text-inventory',
    };
  }
  const mentionsInDesign = /\b(?:indesign|in\s*design|indd|idml)\b/i.test(text);
  const indesignLayerState = mentionsInDesign ? text.match(INDESIGN_LAYER_ACTION_RE) : null;
  if (indesignLayerState?.[1] && indesignLayerState[2]) {
    return {
      route: true,
      kind: 'indesign_set_layer_state',
      appQuery: 'InDesign',
      targetLabel: cleanTypedText(indesignLayerState[2]),
      layerStateAction: normalizeInDesignLayerStateAction(indesignLayerState[1]),
      reason: 'local-indesign-set-layer-state',
    };
  }
  const indesignRelinkAsset = mentionsInDesign
    ? text.match(INDESIGN_RELINK_FILE_RE) || text.match(INDESIGN_BANNER_ASSET_PLACE_RE)
    : null;
  if (indesignRelinkAsset && /(?:relink|replace\s+link|replace|swap|update)/i.test(text)) {
    return {
      route: true,
      kind: 'indesign_relink_asset',
      appQuery: 'InDesign',
      assetPath: cleanFileDialogPathMatch(indesignRelinkAsset),
      reason: 'local-indesign-relink-asset',
    };
  }
  const indesignProofExport = mentionsInDesign ? text.match(INDESIGN_PROOF_EXPORT_RE) : null;
  if (indesignProofExport) {
    return {
      route: true,
      kind: 'indesign_export_proof',
      appQuery: 'InDesign',
      outputPath: cleanTypedText(indesignProofExport[1] || 'proof.pdf'),
      format: 'pdf',
      reason: 'local-indesign-proof-export',
    };
  }
  const indesignPackageHandoff = mentionsInDesign ? text.match(INDESIGN_PACKAGE_HANDOFF_RE) : null;
  if (indesignPackageHandoff) {
    return {
      route: true,
      kind: 'indesign_package_document',
      appQuery: 'InDesign',
      outputFolderPath: inferInDesignPackageOutputFolder(indesignPackageHandoff),
      reason: 'local-indesign-package-document',
    };
  }
  const mentionsPhotoshop = /\b(?:photoshop|psd)\b/i.test(text);
  const photoshopLayerState = mentionsPhotoshop ? text.match(PHOTOSHOP_LAYER_ACTION_RE) : null;
  if (photoshopLayerState?.[1] && photoshopLayerState[2]) {
    return {
      route: true,
      kind: 'photoshop_set_layer_state',
      appQuery: 'Photoshop',
      targetLabel: cleanTypedText(photoshopLayerState[2]),
      layerStateAction: normalizeInDesignLayerStateAction(photoshopLayerState[1]),
      reason: 'local-photoshop-set-layer-state',
    };
  }
  const photoshopTextUpdate = mentionsPhotoshop
    ? text.match(PHOTOSHOP_TEXT_LAYER_UPDATE_RE) || text.match(PHOTOSHOP_NAMED_TEXT_UPDATE_RE)
    : null;
  if (photoshopTextUpdate?.[1] && photoshopTextUpdate[2]) {
    return {
      route: true,
      kind: 'photoshop_update_text_layer',
      appQuery: 'Photoshop',
      targetLabel: cleanTypedText(photoshopTextUpdate[1]),
      text: cleanTypedText(photoshopTextUpdate[2]),
      reason: 'local-photoshop-update-text-layer',
    };
  }
  const photoshopPlace = mentionsPhotoshop ? text.match(PHOTOSHOP_PLACE_FILE_RE) : null;
  if (photoshopPlace) {
    return {
      route: true,
      kind: 'photoshop_place_asset',
      appQuery: 'Photoshop',
      assetPath: cleanFileDialogPathMatch(photoshopPlace),
      reason: 'local-photoshop-place-asset',
    };
  }
  const photoshopExport = mentionsPhotoshop
    ? text.match(PHOTOSHOP_EXPORT_PROOF_RE) || text.match(PHOTOSHOP_EXPORT_AS_FILE_RE) || text.match(PHOTOSHOP_SAVE_FOR_WEB_FILE_RE)
    : null;
  if (photoshopExport?.[1] && /\.(?:png|jpe?g)$/i.test(photoshopExport[1])) {
    const outputPath = cleanTypedText(photoshopExport[1]);
    return {
      route: true,
      kind: 'photoshop_export_proof',
      appQuery: 'Photoshop',
      outputPath,
      format: /\.jpe?g$/i.test(outputPath) ? 'jpg' : 'png',
      reason: 'local-photoshop-export-proof',
    };
  }
  if (PHOTOSHOP_LAYER_INVENTORY_RE.test(text)) {
    return {
      route: true,
      kind: 'photoshop_layer_inventory',
      appQuery: 'Photoshop',
      query: cleanTypedText(text.match(/\b(?:for|matching|about|called|named)\s+["'`]?([^"'`\n\r]{1,120})["'`]?\s*$/i)?.[1] || ''),
      reason: 'local-photoshop-layer-inventory',
    };
  }
  if (PHOTOSHOP_DOCUMENT_STATUS_RE.test(text)) {
    return {
      route: true,
      kind: 'photoshop_document_status',
      appQuery: 'Photoshop',
      reason: 'local-photoshop-document-status',
    };
  }
  if (TAB_AWARENESS_RE.test(text) || (BROWSER_TAB_RE.test(text) && /\b(open|have|current|all|chrome|safari|brave|edge|arc|browser)\b/i.test(text))) {
    return {
      route: true,
      kind: 'browser_tabs',
      browsers: inferBrowsers(text),
      reason: 'local-browser-tab-awareness',
    };
  }
  const mouseDrag = text.match(MOUSE_DRAG_RE);
  if (mouseDrag?.[1] && mouseDrag[2] && mouseDrag[3] && mouseDrag[4]) {
    return {
      route: true,
      kind: 'mouse_drag',
      fromX: Number(mouseDrag[1]),
      fromY: Number(mouseDrag[2]),
      toX: Number(mouseDrag[3]),
      toY: Number(mouseDrag[4]),
      reason: 'local-mouse-drag',
    };
  }
  const mouseMove = text.match(MOUSE_MOVE_RE);
  if (mouseMove?.[1] && mouseMove[2]) {
    return {
      route: true,
      kind: 'mouse_move',
      x: Number(mouseMove[1]),
      y: Number(mouseMove[2]),
      reason: 'local-mouse-move',
    };
  }
  const mouseClick = text.match(MOUSE_CLICK_RE);
  if (mouseClick?.[3] && mouseClick[4]) {
    return {
      route: true,
      kind: 'mouse_click',
      mouseButton: mouseClick[1]?.toLowerCase() === 'right' ? 'right' : 'left',
      clickCount: mouseClick[2]?.toLowerCase() === 'double' ? 2 : 1,
      x: Number(mouseClick[3]),
      y: Number(mouseClick[4]),
      reason: 'local-mouse-click',
    };
  }
  const mouseDown = text.match(MOUSE_DOWN_RE);
  if (mouseDown?.[2] && mouseDown[3]) {
    return {
      route: true,
      kind: 'mouse_down',
      mouseButton: mouseDown[1]?.toLowerCase() === 'right' ? 'right' : 'left',
      x: Number(mouseDown[2]),
      y: Number(mouseDown[3]),
      reason: 'local-mouse-down',
    };
  }
  const mouseUp = text.match(MOUSE_UP_RE);
  if (mouseUp) {
    return {
      route: true,
      kind: 'mouse_up',
      mouseButton: mouseUp[1]?.toLowerCase() === 'right' ? 'right' : 'left',
      x: mouseUp[2] ? Number(mouseUp[2]) : undefined,
      y: mouseUp[3] ? Number(mouseUp[3]) : undefined,
      reason: 'local-mouse-up',
    };
  }
  const mouseScroll = text.match(MOUSE_SCROLL_RE);
  if (mouseScroll?.[1]) {
    const deltas = scrollDeltas(mouseScroll[1], mouseScroll[2]);
    return {
      route: true,
      kind: 'mouse_scroll',
      deltaX: deltas.deltaX,
      deltaY: deltas.deltaY,
      x: mouseScroll[3] ? Number(mouseScroll[3]) : undefined,
      y: mouseScroll[4] ? Number(mouseScroll[4]) : undefined,
      reason: 'local-mouse-scroll',
    };
  }
  const waitUntilReady = text.match(WAIT_UNTIL_READY_RE);
  if (waitUntilReady && /\b(wait|pause)\b/i.test(text)) {
    return {
      route: true,
      kind: 'wait_for_app',
      appQuery: cleanOptionalShortcutAppQuery(waitUntilReady[1]),
      durationMs: waitUntilReady[2] ? waitDurationMs(waitUntilReady[2], waitUntilReady[3]) : 8_000,
      reason: 'local-wait-for-app',
    };
  }
  const waitForApp = text.match(WAIT_FOR_APP_RE);
  if (waitForApp?.[1]) {
    return {
      route: true,
      kind: 'wait_for_app',
      appQuery: cleanOptionalShortcutAppQuery(waitForApp[1]),
      durationMs: waitForApp[2] ? waitDurationMs(waitForApp[2], waitForApp[3]) : 8_000,
      reason: 'local-wait-for-app',
    };
  }
  const wait = text.match(WAIT_RE);
  if (wait && /\b(wait|pause|sleep)\b/i.test(text)) {
    return {
      route: true,
      kind: 'wait',
      durationMs: waitDurationMs(wait[1], wait[2]),
      reason: 'local-wait',
    };
  }
  const typeTextFrontmost = text.match(TYPE_TEXT_FRONTMOST_RE);
  if (typeTextFrontmost?.[1]) {
    return {
      route: true,
      kind: 'type_text',
      text: cleanTypedText(typeTextFrontmost[1]),
      reason: 'local-type-text',
    };
  }
  const pasteTextFrontmost = text.match(PASTE_TEXT_FRONTMOST_RE);
  if (pasteTextFrontmost?.[1]) {
    return {
      route: true,
      kind: 'paste_text',
      text: cleanTypedText(pasteTextFrontmost[1]),
      reason: 'local-paste-text',
    };
  }
  const setFieldFrontmost = text.match(SET_FIELD_TEXT_FRONTMOST_RE);
  if (setFieldFrontmost?.[1] && setFieldFrontmost[2]) {
    return {
      route: true,
      kind: 'set_field_text',
      targetLabel: cleanUiTargetLabel(setFieldFrontmost[1]),
      text: cleanTypedText(setFieldFrontmost[2]),
      reason: 'local-set-field-text',
    };
  }
  const setFieldText = text.match(SET_FIELD_TEXT_IN_APP_RE);
  if (setFieldText?.[1] && setFieldText[2] && setFieldText[3] && !looksLikeWebSurface(setFieldText[3])) {
    return {
      route: true,
      kind: 'set_field_text',
      targetLabel: cleanUiTargetLabel(setFieldText[1]),
      text: cleanTypedText(setFieldText[2]),
      appQuery: cleanAppQuery(setFieldText[3]),
      reason: 'local-set-field-text',
    };
  }
  const pasteText = text.match(PASTE_TEXT_IN_APP_RE);
  if (pasteText?.[1] && pasteText[2] && !looksLikeWebSurface(pasteText[2])) {
    return {
      route: true,
      kind: 'paste_text',
      text: cleanTypedText(pasteText[1]),
      appQuery: cleanAppQuery(pasteText[2]),
      reason: 'local-paste-text',
    };
  }
  const typeText = text.match(TYPE_TEXT_IN_APP_RE);
  if (typeText?.[1] && typeText[2] && !looksLikeWebSurface(typeText[2])) {
    return {
      route: true,
      kind: 'type_text',
      text: cleanTypedText(typeText[1]),
      appQuery: cleanAppQuery(typeText[2]),
      reason: 'local-type-text',
    };
  }
  const pressKeysFrontmost = text.match(PRESS_KEYS_FRONTMOST_RE);
  if (pressKeysFrontmost?.[1] && looksLikeKeyCombo(pressKeysFrontmost[1])) {
    return {
      route: true,
      kind: 'press_keys',
      combo: cleanKeyCombo(pressKeysFrontmost[1]),
      reason: 'local-press-keys',
    };
  }
  const pressKeys = text.match(PRESS_KEYS_IN_APP_RE);
  if (pressKeys?.[1] && pressKeys[2] && looksLikeKeyCombo(pressKeys[1]) && !looksLikeWebSurface(pressKeys[2])) {
    return {
      route: true,
      kind: 'press_keys',
      combo: cleanKeyCombo(pressKeys[1]),
      appQuery: cleanAppQuery(pressKeys[2]),
      reason: 'local-press-keys',
    };
  }
  const pressKeysBare = text.match(PRESS_KEYS_BARE_RE);
  if (pressKeysBare?.[1] && looksLikeKeyCombo(pressKeysBare[1])) {
    return {
      route: true,
      kind: 'press_keys',
      combo: cleanKeyCombo(pressKeysBare[1]),
      reason: 'local-press-keys',
    };
  }
  const menuFrontmost = text.match(MENU_CLICK_FRONTMOST_RE);
  if (menuFrontmost?.[1]) {
    const menuPath = cleanMenuPath(menuFrontmost[1]);
    if (menuPath.length >= 2) {
      return {
        route: true,
        kind: 'menu_click',
        menuPath,
        targetLabel: menuPath.join(' > '),
        reason: 'local-menu-click',
      };
    }
  }
  const menuClick = text.match(MENU_CLICK_IN_APP_RE);
  if (menuClick?.[1] && menuClick[2] && !looksLikeWebSurface(menuClick[2])) {
    const menuPath = cleanMenuPath(menuClick[1]);
    if (menuPath.length >= 2) {
      return {
        route: true,
        kind: 'menu_click',
        menuPath,
        targetLabel: menuPath.join(' > '),
        appQuery: cleanAppQuery(menuClick[2]),
        reason: 'local-menu-click',
      };
    }
  }
  const semanticClickFrontmost = text.match(SEMANTIC_CLICK_FRONTMOST_RE);
  if (semanticClickFrontmost?.[1]) {
    return {
      route: true,
      kind: 'semantic_click',
      targetLabel: cleanUiTargetLabel(semanticClickFrontmost[1]),
      reason: 'local-semantic-click',
    };
  }
  const semanticClick = text.match(SEMANTIC_CLICK_IN_APP_RE);
  if (semanticClick?.[1] && semanticClick[2] && !looksLikeWebSurface(semanticClick[2])) {
    return {
      route: true,
      kind: 'semantic_click',
      targetLabel: cleanUiTargetLabel(semanticClick[1]),
      appQuery: cleanAppQuery(semanticClick[2]),
      reason: 'local-semantic-click',
    };
  }
  const resizeWindow = text.match(WINDOW_RESIZE_RE);
  if (resizeWindow?.[2] && resizeWindow[3]) {
    return {
      route: true,
      kind: 'window_manage',
      appQuery: resizeWindow[1]?.trim(),
      windowAction: 'resize',
      width: Number(resizeWindow[2]),
      height: Number(resizeWindow[3]),
      reason: 'local-window-manage',
    };
  }
  const windowManage = text.match(WINDOW_MANAGE_RE);
  if (windowManage?.[1]) {
    return {
      route: true,
      kind: 'window_manage',
      appQuery: windowManage[3]?.trim(),
      windowAction: normalizeWindowAction(windowManage[1]),
      reason: 'local-window-manage',
    };
  }
  if (WINDOW_STATE_RE.test(text)) return { route: true, kind: 'window_state', reason: 'local-window-awareness' };
  if (RUNNING_APPS_RE.test(text)) return { route: true, kind: 'running_apps', reason: 'local-running-app-awareness' };
  if (CLIPBOARD_RE.test(text)) return { route: true, kind: 'clipboard', reason: 'local-clipboard-awareness' };
  const shortcutRun = text.match(SHORTCUT_RUN_RE);
  if (shortcutRun?.[1]) return { route: true, kind: 'shortcut_run', shortcutName: shortcutRun[1].trim(), reason: 'local-shortcut-run' };
  if (SHORTCUTS_LIST_RE.test(text)) return { route: true, kind: 'shortcuts_list', reason: 'local-shortcuts-list' };
  if (FILE_RENAME_RE.test(text)) return { route: true, kind: 'file_rename', reason: 'local-file-rename' };
  if (FILE_COPY_RE.test(text)) return { route: true, kind: 'file_copy', reason: 'local-file-copy' };
  if (FILE_TRASH_RE.test(text)) return { route: true, kind: 'file_trash', reason: 'local-file-trash' };
  if (FILE_MKDIR_RE.test(text)) return { route: true, kind: 'file_mkdir', reason: 'local-file-mkdir' };
  if (FILE_WRITE_TEXT_RE.test(text)) return { route: true, kind: 'file_write_text', reason: 'local-file-write-text' };
  if (FILE_STAT_RE.test(text)) return { route: true, kind: 'file_stat', reason: 'local-file-stat' };
  const findAndOpenFile = text.match(FILE_FIND_AND_OPEN_RE);
  if (findAndOpenFile?.[1] && findAndOpenFile[2]) {
    const query = cleanFileSearchQuery(findAndOpenFile[1]);
    const extension = query.match(/\.([A-Za-z0-9]{1,12})$/)?.[1]?.toLowerCase();
    return {
      route: true,
      kind: 'open_file_search_match',
      query,
      rootPath: normalizeFileSearchRoot(findAndOpenFile[2]),
      extensions: extension ? [extension] : undefined,
      reason: 'local-file-find-open',
    };
  }
  const googleDriveSearch = text.match(GOOGLE_DRIVE_FILE_SEARCH_RE);
  if (googleDriveSearch?.[1]) {
    const query = cleanFileSearchQuery(googleDriveSearch[1]);
    const extension = query.match(/\.([A-Za-z0-9]{1,12})$/)?.[1]?.toLowerCase();
    return {
      route: true,
      kind: 'file_search',
      rootPath: 'google_drive',
      query,
      extensions: extension ? [extension] : undefined,
      reason: 'local-google-drive-file-search',
    };
  }
  const fileSearchInFor = text.match(FILE_SEARCH_IN_FOR_RE);
  if (fileSearchInFor?.[1] && fileSearchInFor[2]) {
    return {
      route: true,
      kind: 'file_search',
      rootPath: normalizeFileSearchRoot(fileSearchInFor[1]),
      query: cleanFileSearchQuery(fileSearchInFor[2]),
      reason: 'local-file-search',
    };
  }
  const fileSearchForIn = text.match(FILE_SEARCH_FOR_IN_RE);
  if (fileSearchForIn?.[1] && fileSearchForIn[2] && isPathish(fileSearchForIn[2])) {
    return {
      route: true,
      kind: 'file_search',
      query: cleanFileSearchQuery(fileSearchForIn[1]),
      rootPath: normalizeFileSearchRoot(fileSearchForIn[2]),
      reason: 'local-file-search',
    };
  }
  const fileSearchForOn = text.match(FILE_SEARCH_FOR_ON_RE);
  if (fileSearchForOn?.[1] && fileSearchForOn[2]) {
    return {
      route: true,
      kind: 'file_search',
      query: cleanFileSearchQuery(fileSearchForOn[1]),
      rootPath: normalizeFileSearchRoot(fileSearchForOn[2]),
      reason: 'local-file-search',
    };
  }
  const fileList = text.match(FILE_LIST_RE);
  if (fileList?.[1] && isPathish(fileList[1])) {
    return { route: true, kind: 'file_list', path: fileList[1].trim(), reason: 'local-file-list' };
  }
  const fileRead = text.match(FILE_READ_RE);
  if (fileRead?.[1] && isPathish(fileRead[1])) {
    return { route: true, kind: 'file_read', path: fileRead[1].trim(), reason: 'local-file-read' };
  }
  if (A11Y_TREE_RE.test(text)) {
    const appMatch = text.match(A11Y_APP_RE);
    return {
      route: true,
      kind: 'a11y_tree',
      appQuery: appMatch?.[1]?.trim(),
      reason: 'local-a11y-tree',
    };
  }
  if (SCREEN_STATE_RE.test(text)) return { route: true, kind: 'screen_state', reason: 'local-screen-awareness' };
  const bringToFront = text.match(BRING_TO_FRONT_RE);
  if (bringToFront?.[1]) return { route: true, kind: 'focus_app', appQuery: cleanAppQuery(bringToFront[1]), reason: 'local-focus-app' };
  const focusApp = text.match(FOCUS_APP_RE);
  if (focusApp?.[1]) return { route: true, kind: 'focus_app', appQuery: cleanAppQuery(focusApp[1]), reason: 'local-focus-app' };
  const launchApp = text.match(LAUNCH_APP_RE);
  if (launchApp?.[1] && !looksLikeWebSurface(launchApp[1]) && !/^(?:the\s+)?(?:file|image|photo|picture|document|folder)\b/i.test(launchApp[1].trim())) {
    return { route: true, kind: 'launch_app', appQuery: cleanAppQuery(launchApp[1]), reason: 'local-launch-app' };
  }
  return { route: false, kind: null, reason: 'no-local-awareness-match' };
}

export function looksLikeLocalComputerAwarenessRequest(message: string): boolean {
  return detectLocalComputerAwarenessIntent(message).route;
}

function cleanSequenceStep(value: string): string {
  return String(value || '')
    .replace(/^\s*(?:[-*]\s+|\d+[.)]\s+)/, '')
    .replace(/^\s*(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|next|then|finally|lastly|after that)\s*[:,.-]?\s+/i, '')
    .replace(/,\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitLocalComputerAwarenessSequence(text: string): string[] {
  const normalized = String(text || '')
    .replace(/\r/g, '\n')
    .replace(/(?:^|\n)\s*(?:[-*]\s+|\d+[.)]\s+)/g, '\n')
    .replace(/\s+(?=\d+[.)]\s+[A-Za-z])/g, '\n')
    .trim();
  if (!SEQUENCE_MARKER_RE.test(normalized)) return [];
  const parts = normalized
    .split(SEQUENCE_SPLIT_RE)
    .map(cleanSequenceStep)
    .filter((part) => part && SEQUENCE_COMMAND_VERB_RE.test(part))
    .slice(0, 12);
  return parts.length >= 2 ? parts : [];
}

function detectLocalComputerAwarenessSequenceStep(step: string): LocalComputerAwarenessIntent {
  const direct = detectLocalComputerAwarenessIntent(step);
  if (direct.route) {
    if (direct.kind === 'a11y_tree' && /^\s*(?:please\s+)?(?:click|press|select|choose)\b/i.test(step)) {
      const semanticClick = step.match(BARE_SEMANTIC_CLICK_RE);
      if (semanticClick?.[1]) {
        return {
          route: true,
          kind: 'semantic_click',
          targetLabel: cleanUiTargetLabel(semanticClick[1]),
          reason: 'local-semantic-click',
        };
      }
    }
    return direct;
  }
  const setFieldText = step.match(BARE_SET_FIELD_TEXT_RE);
  if (setFieldText?.[1] && setFieldText[2]) {
    return {
      route: true,
      kind: 'set_field_text',
      targetLabel: cleanUiTargetLabel(setFieldText[1]),
      text: cleanTypedText(setFieldText[2]),
      reason: 'local-set-field-text',
    };
  }
  const typeText = step.match(BARE_TYPE_RE);
  if (typeText?.[1]) {
    return {
      route: true,
      kind: 'type_text',
      text: cleanTypedText(typeText[1]),
      reason: 'local-type-text',
    };
  }
  const pasteText = step.match(BARE_PASTE_RE);
  if (pasteText?.[1]) {
    return {
      route: true,
      kind: 'paste_text',
      text: cleanTypedText(pasteText[1]),
      reason: 'local-paste-text',
    };
  }
  const menuClick = step.match(BARE_MENU_CLICK_RE);
  if (menuClick?.[1]) {
    const menuPath = cleanMenuPath(menuClick[1]);
    if (menuPath.length >= 2) {
      return {
        route: true,
        kind: 'menu_click',
        menuPath,
        targetLabel: menuPath.join(' > '),
        reason: 'local-menu-click',
      };
    }
  }
  const semanticClick = step.match(BARE_SEMANTIC_CLICK_RE);
  if (semanticClick?.[1]) {
    return {
      route: true,
      kind: 'semantic_click',
      targetLabel: cleanUiTargetLabel(semanticClick[1]),
      reason: 'local-semantic-click',
    };
  }
  return direct;
}

function expandBrowserNavigationInFocusedApp(text: string, currentApp?: string): LocalComputerAwarenessIntent[] | null {
  if (!isBrowserAppQuery(currentApp)) return null;
  const direct = detectLocalComputerAwarenessSequenceStep(text);
  if (direct.route && direct.kind === 'open_url' && direct.url) {
    return [
      { route: true, kind: 'press_keys', combo: 'Cmd+L', reason: 'local-location-bar-shortcut' },
      { route: true, kind: 'type_text', text: direct.url, reason: 'local-type-text' },
      { route: true, kind: 'press_keys', combo: 'Return', reason: 'local-confirm-dialog-shortcut' },
    ];
  }
  const browserSearch = text.match(BARE_BROWSER_SEARCH_RE);
  if (browserSearch?.[1]) {
    const query = cleanTypedText(browserSearch[1]);
    if (query && !/\b(files?|folders?|desktop|downloads?|documents?|computer|mac|laptop)\b/i.test(query)) {
      return [
        { route: true, kind: 'press_keys', combo: 'Cmd+L', reason: 'local-location-bar-shortcut' },
        { route: true, kind: 'type_text', text: query, reason: 'local-type-text' },
        { route: true, kind: 'press_keys', combo: 'Return', reason: 'local-confirm-dialog-shortcut' },
      ];
    }
  }
  return null;
}

function normalizeBrowserTargetUrl(value: string): string {
  const target = String(value || '').trim();
  if (/^(?:https?:|mailto:|file:)/i.test(target)) return target;
  return `https://${target.replace(/^www\./i, 'www.')}`;
}

function withOptionalAppFocus(
  appQuery: string | undefined,
  actions: LocalComputerAwarenessIntent[],
): LocalComputerAwarenessIntent[] {
  const app = cleanOptionalShortcutAppQuery(appQuery);
  if (!app) return actions;
  return [
    { route: true, kind: 'focus_app', appQuery: app, reason: 'local-focus-app' },
    ...actions.map((action) => action.appQuery ? action : { ...action, appQuery: app }),
  ];
}

function extractTrailingBrowserAppQuery(value: string | undefined): string | undefined {
  const match = String(value || '').match(/\s+(?:in|inside|on)\s+((?:(?:google\s+)?chrome|safari|brave|edge|microsoft\s+edge|arc|opera|vivaldi|browser)(?:\s+(?:app|application|window|browser))?)\s*[.!?]?\s*$/i);
  return cleanOptionalShortcutAppQuery(match?.[1]);
}

function stripTrailingBrowserAppTarget(value: string | undefined): string {
  return String(value || '')
    .replace(/\s+(?:in|inside|on)\s+(?:(?:google\s+)?chrome|safari|brave|edge|microsoft\s+edge|arc|opera|vivaldi|browser)(?:\s+(?:app|application|window|browser))?\s*[.!?]?\s*$/i, '')
    .trim();
}

function browserAppForMacro(explicitApp: string | undefined, currentApp: string | undefined): string | undefined {
  const app = cleanOptionalShortcutAppQuery(explicitApp);
  if (isBrowserAppQuery(app)) return app;
  return isBrowserAppQuery(currentApp) ? currentApp : undefined;
}

function openBrowserUrlActions(url: string, appQuery?: string): LocalComputerAwarenessIntent[] {
  const app = cleanOptionalShortcutAppQuery(appQuery);
  if (isBrowserAppQuery(app)) {
    return withOptionalAppFocus(app, [
      { route: true, kind: 'press_keys', combo: 'Cmd+L', reason: 'local-location-bar-shortcut' },
      { route: true, kind: 'type_text', text: url, reason: 'local-type-text' },
      { route: true, kind: 'press_keys', combo: 'Return', reason: 'local-confirm-dialog-shortcut' },
      photoshopWait(900),
    ]);
  }
  return [
    { route: true, kind: 'open_url', url, reason: 'local-open-url' },
    photoshopWait(900),
  ];
}

function gmailSectionHash(section: string | undefined): string {
  const key = String(section || 'inbox').toLowerCase().replace(/\s+/g, ' ').trim();
  if (key === 'sent') return '#sent';
  if (key === 'draft' || key === 'drafts') return '#drafts';
  if (key === 'starred') return '#starred';
  if (key === 'snoozed') return '#snoozed';
  if (key === 'important') return '#imp';
  if (key === 'spam') return '#spam';
  if (key === 'trash') return '#trash';
  if (key === 'all mail') return '#all';
  return '#inbox';
}

function gmailSectionUrl(section: string | undefined): string {
  return `https://mail.google.com/mail/u/0/${gmailSectionHash(section)}`;
}

function gmailSearchUrl(query: string): string {
  return `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(query)}`;
}

function gmailComposeUrl(to?: string, subject?: string, body?: string): string {
  const params = new URLSearchParams({ view: 'cm', fs: '1' });
  if (to) params.set('to', to);
  if (subject) params.set('su', subject);
  if (body) params.set('body', body);
  return `https://mail.google.com/mail/u/0/?${params.toString()}`;
}

function parseGmailCompose(text: string): {
  to?: string;
  subject?: string;
  body?: string;
  shouldSend: boolean;
  appQuery?: string;
} | null {
  const match = text.match(GMAIL_COMPOSE_INTENT_RE);
  if (!match) return null;
  const verb = String(match[1] || 'compose').toLowerCase();
  const rawTail = String(match[2] || '');
  const appQuery = extractTrailingBrowserAppQuery(rawTail);
  const tail = stripTrailingBrowserAppTarget(rawTail).replace(/^[\s,:-]+/, '');
  const to = cleanTypedText(tail.match(/\bto\s+([^\s,;<>]+@[^\s,;<>]+\.[^\s,;<>]+)/i)?.[1] || '');
  const subject = cleanTypedText(tail.match(/\bsubject\s+["'`]?([\s\S]{1,300}?)(?=\s+(?:body|message|saying|with)\b|$)/i)?.[1] || '');
  const body = cleanTypedText(tail.match(/\b(?:body|message|saying|with)\s+([\s\S]{1,4000})$/i)?.[1] || '');
  return {
    ...(to ? { to } : {}),
    ...(subject ? { subject } : {}),
    ...(body ? { body } : {}),
    shouldSend: verb === 'send',
    appQuery,
  };
}

function expandGmailBrowserMacro(step: string, currentApp?: string): LocalComputerAwarenessIntent[] {
  const text = String(step || '').trim();
  if (!text) return [];

  const compose = parseGmailCompose(text);
  if (compose) {
    const actions = openBrowserUrlActions(
      gmailComposeUrl(compose.to, compose.subject, compose.body),
      browserAppForMacro(compose.appQuery, currentApp),
    );
    if (compose.shouldSend) {
      return [
        ...actions,
        photoshopClick('Send', 'local-gmail-send'),
        photoshopWait(800),
      ];
    }
    return actions;
  }

  const search = text.match(GMAIL_SEARCH_RE) || text.match(GMAIL_SEARCH_TRAILING_RE);
  if (search?.[1]) {
    const query = cleanTypedText(stripTrailingBrowserAppTarget(search[1]));
    if (query) {
      return openBrowserUrlActions(
        gmailSearchUrl(query),
        browserAppForMacro(search[2], currentApp),
      );
    }
  }

  const open = text.match(GMAIL_OPEN_RE) || text.match(GMAIL_LABEL_TRAILING_RE);
  if (open) {
    const section = cleanTypedText(open[1] || '');
    const appQuery = browserAppForMacro(open[2], currentApp);
    if (/^compose$/i.test(section)) {
      return openBrowserUrlActions(gmailComposeUrl(), appQuery);
    }
    return openBrowserUrlActions(gmailSectionUrl(section), appQuery);
  }

  return [];
}

function normalizeWordPressSiteBase(rawSite: string | undefined): string | null {
  const site = cleanTypedText(rawSite || '');
  if (!site) return null;
  try {
    const url = new URL(normalizeBrowserTargetUrl(site));
    url.pathname = url.pathname.replace(/\/(?:wp-admin|wp-json)(?:\/.*)?$/i, '').replace(/\/+$/g, '');
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/g, '');
  } catch {
    return null;
  }
}

function normalizeWordPressSection(rawSection: string | undefined): string {
  const section = String(rawSection || 'dashboard').toLowerCase().replace(/\s+/g, ' ').trim();
  if (section === 'admin' || section === 'dashboard') return 'dashboard';
  if (section === 'post' || section === 'posts' || section === 'all posts') return 'posts';
  if (section === 'new post' || section === 'add new post') return 'new_post';
  if (section === 'page' || section === 'pages' || section === 'all pages') return 'pages';
  if (section === 'new page' || section === 'add new page') return 'new_page';
  if (section === 'media' || section === 'media library') return 'media';
  if (section === 'comment' || section === 'comments') return 'comments';
  if (section === 'plugin' || section === 'plugins') return 'plugins';
  if (section === 'theme' || section === 'themes') return 'themes';
  if (section === 'user' || section === 'users') return 'users';
  if (section === 'category' || section === 'categories') return 'categories';
  if (section === 'tag' || section === 'tags') return 'tags';
  if (section === 'settings') return 'settings';
  return 'dashboard';
}

function wordpressAdminUrl(rawSection: string | undefined, rawSite?: string): string {
  const section = normalizeWordPressSection(rawSection);
  const base = normalizeWordPressSiteBase(rawSite);
  if (base) {
    const selfHostedPaths: Record<string, string> = {
      dashboard: '/wp-admin/',
      posts: '/wp-admin/edit.php',
      new_post: '/wp-admin/post-new.php',
      pages: '/wp-admin/edit.php?post_type=page',
      new_page: '/wp-admin/post-new.php?post_type=page',
      media: '/wp-admin/upload.php',
      comments: '/wp-admin/edit-comments.php',
      plugins: '/wp-admin/plugins.php',
      themes: '/wp-admin/themes.php',
      users: '/wp-admin/users.php',
      settings: '/wp-admin/options-general.php',
      categories: '/wp-admin/edit-tags.php?taxonomy=category',
      tags: '/wp-admin/edit-tags.php?taxonomy=post_tag',
    };
    return `${base}${selfHostedPaths[section] || selfHostedPaths.dashboard}`;
  }

  const wordpressComUrls: Record<string, string> = {
    dashboard: 'https://wordpress.com/home',
    posts: 'https://wordpress.com/posts',
    new_post: 'https://wordpress.com/post',
    pages: 'https://wordpress.com/pages',
    new_page: 'https://wordpress.com/page',
    media: 'https://wordpress.com/media',
    comments: 'https://wordpress.com/comments',
    plugins: 'https://wordpress.com/plugins',
    themes: 'https://wordpress.com/themes',
    users: 'https://wordpress.com/people',
    settings: 'https://wordpress.com/settings/general',
    categories: 'https://wordpress.com/settings/taxonomies',
    tags: 'https://wordpress.com/settings/taxonomies',
  };
  return wordpressComUrls[section] || wordpressComUrls.dashboard;
}

function expandWordPressBrowserMacro(step: string, currentApp?: string): LocalComputerAwarenessIntent[] {
  const text = String(step || '').trim();
  if (!text) return [];

  const newContent = text.match(WORDPRESS_NEW_CONTENT_RE);
  if (newContent?.[1]) {
    const section = /^page$/i.test(newContent[1]) ? 'new_page' : 'new_post';
    return openBrowserUrlActions(
      wordpressAdminUrl(section, newContent[2]),
      browserAppForMacro(newContent[3], currentApp),
    );
  }

  const section = text.match(WORDPRESS_SECTION_RE);
  if (section?.[1]) {
    return openBrowserUrlActions(
      wordpressAdminUrl(section[1], section[2]),
      browserAppForMacro(section[3], currentApp),
    );
  }

  const admin = text.match(WORDPRESS_ADMIN_RE);
  if (admin) {
    return openBrowserUrlActions(
      wordpressAdminUrl('dashboard', admin[1]),
      browserAppForMacro(admin[2], currentApp),
    );
  }

  return [];
}

function expandStandaloneBrowserMacro(text: string): LocalComputerAwarenessIntent[] {
  const gmailMacro = expandGmailBrowserMacro(text);
  if (gmailMacro.length > 1) return gmailMacro;

  const wordpressMacro = expandWordPressBrowserMacro(text);
  if (wordpressMacro.length > 1) return wordpressMacro;

  const newTabUrl =
    text.match(STANDALONE_NEW_TAB_URL_RE) ||
    text.match(STANDALONE_NEW_TAB_TO_URL_RE);
  if (newTabUrl?.[1]) {
    return withOptionalAppFocus(newTabUrl[2], [
      { route: true, kind: 'press_keys', combo: 'Cmd+T', reason: 'local-new-tab-shortcut' },
      { route: true, kind: 'type_text', text: normalizeBrowserTargetUrl(newTabUrl[1]), reason: 'local-type-text' },
      { route: true, kind: 'press_keys', combo: 'Return', reason: 'local-confirm-dialog-shortcut' },
    ]);
  }

  const browserSearch = text.match(STANDALONE_BROWSER_SEARCH_IN_APP_RE);
  if (browserSearch?.[1] && browserSearch[2] && isBrowserAppQuery(cleanOptionalShortcutAppQuery(browserSearch[2]))) {
    const query = cleanTypedText(browserSearch[1]);
    if (query && !/\b(files?|folders?|desktop|downloads?|documents?|computer|mac|laptop)\b/i.test(query)) {
      return withOptionalAppFocus(browserSearch[2], [
        { route: true, kind: 'press_keys', combo: 'Cmd+L', reason: 'local-location-bar-shortcut' },
        { route: true, kind: 'type_text', text: query, reason: 'local-type-text' },
        { route: true, kind: 'press_keys', combo: 'Return', reason: 'local-confirm-dialog-shortcut' },
      ]);
    }
  }

  const copyUrl = text.match(COPY_CURRENT_URL_RE);
  if (copyUrl) {
    return withOptionalAppFocus(copyUrl[1], [
      { route: true, kind: 'press_keys', combo: 'Cmd+L', reason: 'local-location-bar-shortcut' },
      { route: true, kind: 'press_keys', combo: 'Cmd+C', reason: 'local-copy-selection-shortcut' },
    ]);
  }

  const findOnPage = text.match(FIND_ON_CURRENT_PAGE_RE);
  if (findOnPage?.[1]) {
    const query = cleanTypedText(findOnPage[1]);
    if (query && !/\b(files?|folders?|desktop|downloads?|documents?|computer|mac|laptop)\b/i.test(query)) {
      return withOptionalAppFocus(findOnPage[2], [
        { route: true, kind: 'press_keys', combo: 'Cmd+F', reason: 'local-find-shortcut' },
        { route: true, kind: 'type_text', text: query, reason: 'local-type-text' },
      ]);
    }
  }

  return [];
}

function cleanMacDashboardText(value: string | undefined): string {
  return cleanTypedText(value || '')
    .replace(/^(?:for|to|at|in|the)\s+/i, '')
    .replace(/\s+(?:settings|preferences|pane|panel|page|section)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function withMacAppContext(
  appQuery: string,
  actions: LocalComputerAwarenessIntent[],
): LocalComputerAwarenessIntent[] {
  return [
    { route: true, kind: 'launch_app', appQuery, reason: 'local-launch-app' },
    photoshopWait(appQuery === 'System Settings' ? 900 : 500),
    ...actions.map((action) => action.kind === 'wait' || action.appQuery ? action : { ...action, appQuery }),
  ];
}

function finderLocationShortcut(rawLocation: string): { combo: string; label: string } {
  const location = rawLocation.toLowerCase().replace(/\s+/g, ' ').trim();
  if (/^downloads?$/.test(location)) return { combo: 'Cmd+Opt+L', label: 'Downloads' };
  if (/^documents?$/.test(location)) return { combo: 'Cmd+Shift+O', label: 'Documents' };
  if (/^applications?$/.test(location)) return { combo: 'Cmd+Shift+A', label: 'Applications' };
  if (location === 'airdrop') return { combo: 'Cmd+Shift+R', label: 'AirDrop' };
  if (/^recents?$/.test(location)) return { combo: 'Cmd+Shift+F', label: 'Recents' };
  if (location === 'home') return { combo: 'Cmd+Shift+H', label: 'Home' };
  if (location === 'computer') return { combo: 'Cmd+Shift+C', label: 'Computer' };
  if (location === 'network') return { combo: 'Cmd+Shift+K', label: 'Network' };
  if (location === 'icloud' || location === 'icloud drive') return { combo: 'Cmd+Shift+I', label: 'iCloud Drive' };
  return { combo: 'Cmd+Shift+D', label: 'Desktop' };
}

function expandMacDashboardMacro(step: string, currentApp?: string): LocalComputerAwarenessIntent[] {
  const text = String(step || '').trim();
  if (!text) return [];

  const spotlightSearch = text.match(MAC_SPOTLIGHT_SEARCH_RE);
  const spotlight = text.match(MAC_SPOTLIGHT_RE);
  const spotlightQuery = cleanMacDashboardText(spotlightSearch?.[1] || spotlight?.[1]);
  if (spotlightSearch || spotlight) {
    return [
      photoshopKey('Cmd+Space', 'local-mac-spotlight'),
      photoshopWait(300),
      ...(spotlightQuery ? [
        { route: true, kind: 'paste_text', text: spotlightQuery, reason: 'local-mac-spotlight-query' } as LocalComputerAwarenessIntent,
        photoshopKey('Return', 'local-confirm-dialog-shortcut'),
      ] : []),
    ];
  }

  if (MAC_MISSION_CONTROL_RE.test(text)) {
    return [
      photoshopKey('Ctrl+Up', 'local-mac-mission-control'),
      photoshopWait(500),
    ];
  }

  if (MAC_APP_WINDOWS_RE.test(text)) {
    return [
      photoshopKey('Ctrl+Down', 'local-mac-application-windows'),
      photoshopWait(500),
    ];
  }

  if (MAC_SHOW_DESKTOP_RE.test(text)) {
    return [
      photoshopKey('Cmd+F3', 'local-mac-show-desktop'),
      photoshopWait(350),
    ];
  }

  if (MAC_LAUNCHPAD_RE.test(text)) {
    return [
      photoshopKey('F4', 'local-mac-launchpad'),
      photoshopWait(500),
    ];
  }

  if (MAC_APP_SWITCHER_RE.test(text)) {
    return [
      photoshopKey('Cmd+Tab', 'local-mac-app-switcher'),
      photoshopWait(350),
    ];
  }

  if (MAC_LOCK_SCREEN_RE.test(text)) {
    return [
      photoshopKey('Ctrl+Cmd+Q', 'local-mac-lock-screen'),
      photoshopWait(300),
    ];
  }

  const screenshot = text.match(MAC_SCREENSHOT_RE);
  if (screenshot) {
    const mode = cleanMacDashboardText(screenshot[1] || screenshot[2]).toLowerCase();
    if (/\btoolbar|tool|app\b/.test(mode)) {
      return [photoshopKey('Cmd+Shift+5', 'local-mac-screenshot-toolbar'), photoshopWait(500)];
    }
    if (/\bwindow\b/.test(mode)) {
      return [
        photoshopKey('Cmd+Shift+4', 'local-mac-screenshot-window-start'),
        photoshopWait(250),
        photoshopKey('Space', 'local-mac-screenshot-window-mode'),
      ];
    }
    if (/\bselection|selected|area|region\b/.test(mode)) {
      return [photoshopKey('Cmd+Shift+4', 'local-mac-screenshot-selection'), photoshopWait(300)];
    }
    if (/\bfull\s*screen|screen\b/.test(mode)) {
      return [photoshopKey('Cmd+Shift+3', 'local-mac-screenshot-screen'), photoshopWait(300)];
    }
    return [];
  }

  const finderLocation = text.match(MAC_FINDER_LOCATION_RE) || text.match(MAC_FINDER_LOCATION_TRAILING_RE);
  if (finderLocation?.[1]) {
    const shortcut = finderLocationShortcut(finderLocation[1]);
    return withMacAppContext('Finder', [
      photoshopKey(shortcut.combo, `local-mac-finder-${shortcut.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`),
    ]);
  }

  const finderView = text.match(MAC_FINDER_VIEW_RE);
  if (finderView?.[1] && (/\bfinder\b/i.test(text) || /\bfinder\b/i.test(currentApp || ''))) {
    const view = finderView[1].toLowerCase();
    const combo = view === 'list'
      ? 'Cmd+2'
      : view === 'column'
        ? 'Cmd+3'
        : view === 'gallery'
          ? 'Cmd+4'
          : 'Cmd+1';
    const actions = [photoshopKey(combo, `local-mac-finder-${view}-view`)];
    return /\bfinder\b/i.test(currentApp || '') ? actions : withMacAppContext('Finder', actions);
  }

  if (MAC_FINDER_ACTION_RE.test(text)) {
    const combo = /\bnew\s+(?:finder\s+)?window\b/i.test(text)
      ? 'Cmd+N'
      : /\bnew\s+folder\b/i.test(text)
        ? 'Cmd+Shift+N'
        : /\bquick\s+look|preview\b/i.test(text)
          ? 'Space'
          : /\binfo|file\s+info\b/i.test(text)
            ? 'Cmd+I'
            : 'Cmd+F';
    const reason = combo === 'Cmd+N'
      ? 'local-mac-finder-new-window'
      : combo === 'Cmd+Shift+N'
        ? 'local-mac-finder-new-folder'
        : combo === 'Space'
          ? 'local-mac-finder-quick-look'
          : combo === 'Cmd+I'
            ? 'local-mac-finder-get-info'
            : 'local-mac-finder-search';
    const actions = [photoshopKey(combo, reason)];
    return /\bfinder\b/i.test(currentApp || '') ? actions : withMacAppContext('Finder', actions);
  }

  const settingsMain = text.match(MAC_SYSTEM_SETTINGS_MAIN_RE);
  const settingsPane = text.match(MAC_SYSTEM_SETTINGS_PANE_RE);
  if (settingsMain || settingsPane) {
    const query = cleanMacDashboardText(settingsPane?.[1] || settingsMain?.[1]);
    return withMacAppContext('System Settings', query ? [
      photoshopKey('Cmd+F', 'local-mac-system-settings-search'),
      photoshopWait(250),
      { route: true, kind: 'paste_text', text: query, reason: 'local-mac-system-settings-query' },
      photoshopWait(250),
      photoshopKey('Return', 'local-confirm-dialog-shortcut'),
    ] : []);
  }

  return [];
}

function expandLocalComputerAwarenessSequenceStep(step: string, currentApp?: string): LocalComputerAwarenessIntent[] {
  const googleDriveInDesignWorkflow = expandGoogleDriveInDesignWorkflow(step, currentApp);
  if (googleDriveInDesignWorkflow.length > 0) return googleDriveInDesignWorkflow;
  const gmailMacro = expandGmailBrowserMacro(step, currentApp);
  if (gmailMacro.length > 1) return gmailMacro;
  const wordpressMacro = expandWordPressBrowserMacro(step, currentApp);
  if (wordpressMacro.length > 1) return wordpressMacro;
  const browserNavigation = expandBrowserNavigationInFocusedApp(step, currentApp);
  if (browserNavigation) return browserNavigation;
  const standaloneBrowserMacro = expandStandaloneBrowserMacro(step);
  if (standaloneBrowserMacro.length > 1) return standaloneBrowserMacro;
  const macDashboardMacro = expandMacDashboardMacro(step, currentApp);
  if (macDashboardMacro.length > 0) return macDashboardMacro;
  if (/\bphotoshop\b/i.test(currentApp || '')) {
    const contextualPhotoshopTask = expandPhotoshopTaskMacro(step, currentApp);
    if (contextualPhotoshopTask.length > 0) return contextualPhotoshopTask;
  }
  if (/\bindesign\b/i.test(currentApp || '')) {
    const contextualInDesignTask = expandInDesignTaskMacro(step, currentApp);
    if (contextualInDesignTask.length > 0) return contextualInDesignTask;
  }
  const saveAsNamedFile = step.match(BARE_SAVE_AS_NAMED_FILE_RE);
  if (saveAsNamedFile?.[1]) {
    const filename = cleanTypedText(saveAsNamedFile[1]);
    const isImageExport = /\.(?:jpe?g|png|gif|webp|tiff?|bmp|heic)$/i.test(filename);
    const isPhotoshop = /\bphotoshop\b/i.test(currentApp || '');
    if (isPhotoshop && isImageExport) {
      return buildPhotoshopSaveForWebExportActions(filename);
    }
    return [
      { route: true, kind: 'press_keys', combo: 'Cmd+Shift+S', reason: 'local-save-as-shortcut' },
      { route: true, kind: 'wait', durationMs: 1000, reason: 'local-wait' },
      { route: true, kind: 'paste_text', text: filename, reason: 'local-save-dialog-filename' },
      { route: true, kind: 'press_keys', combo: 'Return', reason: 'local-confirm-dialog-shortcut' },
    ];
  }
  const photoshopTask = expandPhotoshopTaskMacro(step, currentApp);
  if (photoshopTask.length > 0) return photoshopTask;
  const indesignTask = expandInDesignTaskMacro(step, currentApp);
  if (indesignTask.length > 0) return indesignTask;
  const replaceAllText = step.match(BARE_REPLACE_ALL_TEXT_RE);
  if (replaceAllText?.[1]) {
    return [
      { route: true, kind: 'press_keys', combo: 'Cmd+A', reason: 'local-select-all-shortcut' },
      { route: true, kind: 'paste_text', text: cleanTypedText(replaceAllText[1]), reason: 'local-paste-text' },
    ];
  }
  if (BARE_CLEAR_TEXT_RE.test(step)) {
    return [
      { route: true, kind: 'press_keys', combo: 'Cmd+A', reason: 'local-select-all-shortcut' },
      { route: true, kind: 'press_keys', combo: 'Delete', reason: 'local-delete-selection-shortcut' },
    ];
  }
  if (/\bphotoshop\b/i.test(currentApp || '') && !/\bphotoshop\b/i.test(step)) {
    const contextualPhotoshopDirect = detectLocalComputerAwarenessSequenceStep(`${step} in Photoshop`);
    if (
      contextualPhotoshopDirect.route &&
      contextualPhotoshopDirect.kind &&
      [
        'photoshop_document_status',
        'photoshop_layer_inventory',
        'photoshop_set_layer_state',
        'photoshop_update_text_layer',
        'photoshop_place_asset',
        'photoshop_export_proof',
      ].includes(contextualPhotoshopDirect.kind)
    ) {
      return [{ ...contextualPhotoshopDirect, appQuery: currentApp }];
    }
  }
  const direct = detectLocalComputerAwarenessSequenceStep(step);
  if (direct.route) return [direct];
  const findText = step.match(BARE_FIND_TEXT_RE);
  if (findText?.[1]) {
    const query = cleanTypedText(findText[1]);
    if (query && !/\b(files?|folders?|desktop|downloads?|documents?|computer|mac|laptop)\b/i.test(query)) {
      return [
        { route: true, kind: 'press_keys', combo: 'Cmd+F', reason: 'local-find-shortcut' },
        { route: true, kind: 'type_text', text: query, reason: 'local-type-text' },
      ];
    }
  }
  return [direct];
}

export function detectLocalComputerAwarenessIntentSequence(message: string): LocalComputerAwarenessIntent[] {
  const text = String(message || '').trim();
  const standaloneGoogleDriveInDesignWorkflow = expandGoogleDriveInDesignWorkflow(text, undefined);
  if (standaloneGoogleDriveInDesignWorkflow.length > 1) return standaloneGoogleDriveInDesignWorkflow;
  const standalonePhotoshopFileWorkflow = expandPhotoshopFileSearchWorkflow(text);
  if (standalonePhotoshopFileWorkflow.length > 1) return standalonePhotoshopFileWorkflow;
  const standaloneMacro = expandStandaloneBrowserMacro(text);
  if (standaloneMacro.length > 1) return standaloneMacro;
  const standaloneMacDashboardMacro = expandMacDashboardMacro(text, undefined);
  if (standaloneMacDashboardMacro.length > 1) return standaloneMacDashboardMacro;
  const standaloneInDesignDocumentWorkflow = expandInDesignDocumentWorkflow(text, undefined);
  if (standaloneInDesignDocumentWorkflow.length > 1) return standaloneInDesignDocumentWorkflow;
  const rawSteps = splitLocalComputerAwarenessSequence(text);
  if (rawSteps.length < 2) {
    const standalonePhotoshopMacro = expandPhotoshopTaskMacro(text, undefined);
    if (standalonePhotoshopMacro.length > 1) return standalonePhotoshopMacro;
    const standaloneInDesignMacro = expandInDesignTaskMacro(text, undefined);
    return standaloneInDesignMacro.length > 1 ? standaloneInDesignMacro : [];
  }
  const intents: LocalComputerAwarenessIntent[] = [];
  let currentApp: string | undefined;
  for (const step of rawSteps) {
    const expanded = expandLocalComputerAwarenessSequenceStep(step, currentApp);
    for (const intent of expanded) {
      if (!intent.route || !intent.kind) return [];
      const withContext = { ...intent };
      if (
        currentApp &&
        !withContext.appQuery &&
        withContext.kind &&
        ['semantic_click', 'menu_click', 'type_text', 'paste_text', 'set_field_text', 'indesign_find_change', 'indesign_batch_find_change', 'indesign_document_status', 'indesign_text_inventory', 'indesign_set_layer_state', 'indesign_batch_update_text_layers', 'indesign_update_text_layer', 'indesign_relink_asset', 'indesign_package_document', 'indesign_export_proof', 'photoshop_document_status', 'photoshop_layer_inventory', 'photoshop_set_layer_state', 'photoshop_update_text_layer', 'photoshop_place_asset', 'photoshop_export_proof', 'press_keys', 'a11y_tree', 'window_manage', 'wait_for_app'].includes(withContext.kind)
      ) {
        withContext.appQuery = currentApp;
      }
      if ((withContext.kind === 'launch_app' || withContext.kind === 'focus_app' || withContext.kind === 'window_manage' || withContext.kind === 'a11y_tree' || withContext.kind === 'wait_for_app') && withContext.appQuery) {
        currentApp = withContext.appQuery;
      }
      intents.push(withContext);
    }
  }
  return intents.length >= 2 ? intents : [];
}

export function shouldRunLocalComputerAwarenessIntentSequence(
  message: string,
  options?: { hasReadyCapabilityBuildout?: boolean },
): boolean {
  if (options?.hasReadyCapabilityBuildout) return false;
  return detectLocalComputerAwarenessIntentSequence(message).length > 1;
}

export function renderLocalComputerAwarenessIntent(intent: LocalComputerAwarenessIntent): string {
  switch (intent.kind) {
    case 'launch_app':
      return `open ${intent.appQuery || ''}`.trim();
    case 'focus_app':
      return `focus ${intent.appQuery || ''}`.trim();
    case 'open_url':
      return `open ${intent.url || ''}`.trim();
    case 'open_path':
      return `open ${intent.path || ''}`.trim();
    case 'open_file_search_match':
      return `find and open ${intent.query || 'file'} under ${intent.rootPath === 'google_drive' ? 'Google Drive' : intent.rootPath || '~'}`.trim();
    case 'clipboard_write':
      return `copy ${intent.text || ''} to clipboard`.trim();
    case 'clipboard_clear':
      return 'clear clipboard';
    case 'window_manage':
      return intent.windowAction === 'resize'
        ? `resize ${intent.appQuery || ''} window to ${intent.width}x${intent.height}`.trim()
        : `${intent.windowAction || 'focus'} ${intent.appQuery || 'active'} window`;
    case 'a11y_tree':
      return `show clickable elements in ${intent.appQuery || 'the current app'}`.trim();
    case 'screen_state':
      return 'take screenshot';
    case 'semantic_click':
      return `click ${intent.targetLabel || ''} in ${intent.appQuery || 'the current app'}`.trim();
    case 'menu_click':
      return `click ${(intent.menuPath || []).join(' > ')} in ${intent.appQuery || 'the current app'}`.trim();
    case 'type_text':
      return `type ${JSON.stringify(intent.text || '')} in ${intent.appQuery || 'the current app'}`;
    case 'paste_text':
      return `paste ${JSON.stringify(intent.text || '')} in ${intent.appQuery || 'the current app'}`;
    case 'set_field_text':
      return `set ${intent.targetLabel || 'field'} to ${JSON.stringify(intent.text || '')} in ${intent.appQuery || 'the current app'}`;
    case 'indesign_find_change':
      return `find/change ${JSON.stringify(intent.query || '')} to ${JSON.stringify(intent.text || '')} in ${intent.appQuery || 'InDesign'}`;
    case 'indesign_batch_find_change':
      return `batch find/change ${(intent.replacements || []).map((pair) => `${JSON.stringify(pair.findText)} to ${JSON.stringify(pair.changeText)}`).join(', ')} in ${intent.appQuery || 'InDesign'}`;
    case 'indesign_document_status':
      return `inspect InDesign document status in ${intent.appQuery || 'InDesign'}`;
    case 'indesign_text_inventory':
      return `inspect InDesign text frames${intent.query ? ` matching ${JSON.stringify(intent.query)}` : ''} in ${intent.appQuery || 'InDesign'}`;
    case 'indesign_set_layer_state':
      return `${intent.layerStateAction || 'set'} InDesign layer ${JSON.stringify(intent.targetLabel || '')}`;
    case 'indesign_batch_update_text_layers':
      return `batch update InDesign fields ${(intent.fieldUpdates || []).map((update) => `${JSON.stringify(update.fieldName)} to ${JSON.stringify(update.replacementText)}`).join(', ')}`;
    case 'indesign_update_text_layer':
      return `set InDesign ${intent.targetLabel || 'text layer'} to ${JSON.stringify(intent.text || '')}`;
    case 'indesign_relink_asset':
      return `relink InDesign asset${intent.linkQuery ? ` matching ${JSON.stringify(intent.linkQuery)}` : ''} to ${intent.assetPath || ''}`.trim();
    case 'indesign_package_document':
      return `package InDesign document to ${intent.outputFolderPath || intent.outputPath || ''}`.trim();
    case 'indesign_export_proof':
      return `export InDesign proof PDF to ${intent.outputPath || ''}`.trim();
    case 'photoshop_document_status':
      return `inspect Photoshop document status in ${intent.appQuery || 'Photoshop'}`;
    case 'photoshop_layer_inventory':
      return `inspect Photoshop layers${intent.query ? ` matching ${JSON.stringify(intent.query)}` : ''} in ${intent.appQuery || 'Photoshop'}`;
    case 'photoshop_set_layer_state':
      return `${intent.layerStateAction || 'set'} Photoshop layer ${JSON.stringify(intent.targetLabel || '')}`;
    case 'photoshop_update_text_layer':
      return `set Photoshop ${intent.targetLabel || 'text layer'} to ${JSON.stringify(intent.text || '')}`;
    case 'photoshop_place_asset':
      return `place Photoshop asset ${intent.assetPath || ''}${intent.targetLabel ? ` as ${intent.targetLabel}` : ''}`.trim();
    case 'photoshop_export_proof':
      return `export Photoshop proof to ${intent.outputPath || ''}`.trim();
    case 'press_keys':
      return `press ${intent.combo || ''} in ${intent.appQuery || 'the current app'}`;
    case 'mouse_move':
      return `move mouse to ${intent.x},${intent.y}`;
    case 'mouse_click':
      return `${intent.mouseButton === 'right' ? 'right ' : ''}${intent.clickCount === 2 ? 'double ' : ''}click at ${intent.x},${intent.y}`.trim();
    case 'mouse_down':
      return `${intent.mouseButton === 'right' ? 'right ' : ''}mouse down at ${intent.x},${intent.y}`.trim();
    case 'mouse_up':
      return typeof intent.x === 'number' && typeof intent.y === 'number'
        ? `${intent.mouseButton === 'right' ? 'right ' : ''}mouse up at ${intent.x},${intent.y}`.trim()
        : `${intent.mouseButton === 'right' ? 'right ' : ''}mouse up`.trim();
    case 'mouse_drag':
      return `drag from ${intent.fromX},${intent.fromY} to ${intent.toX},${intent.toY}`;
    case 'mouse_scroll':
      return `scroll ${Number(intent.deltaY || 0) < 0 || Number(intent.deltaX || 0) < 0 ? 'up' : 'down'} by ${Math.max(Math.abs(Number(intent.deltaY || 0)), Math.abs(Number(intent.deltaX || 0))) || 520}`;
    case 'wait':
      return `wait ${Math.max(1, Math.round((intent.durationMs || 1000) / 1000))} seconds`;
    case 'wait_for_app':
      return `wait for ${intent.appQuery || 'the app'} to open for ${Math.max(1, Math.round((intent.durationMs || 8000) / 1000))} seconds`;
    default:
      return intent.reason;
  }
}

export function getLocalComputerAwarenessRisk(intent: LocalComputerAwarenessIntent): 'safe' | 'review' | 'external_side_effect' {
  switch (intent.kind) {
    case 'browser_tabs':
    case 'window_state':
    case 'running_apps':
    case 'clipboard':
    case 'screen_state':
    case 'file_list':
    case 'file_read':
    case 'file_search':
    case 'file_stat':
    case 'shortcuts_list':
    case 'a11y_tree':
    case 'wait_for_app':
    case 'indesign_document_status':
    case 'indesign_text_inventory':
    case 'photoshop_document_status':
    case 'photoshop_layer_inventory':
      return 'safe';
    case 'shortcut_run':
      return 'external_side_effect';
    case 'launch_app':
    case 'focus_app':
    case 'open_url':
    case 'open_path':
    case 'open_file_search_match':
    case 'clipboard_write':
    case 'clipboard_clear':
    case 'window_manage':
    case 'semantic_click':
      if (
        /\b(local-gmail-send|local-wordpress-(?:publish|update|schedule|delete|trash))\b/i.test(intent.reason || '') ||
        /\b(send|publish|update|schedule|delete|trash|remove)\b/i.test(intent.targetLabel || '')
      ) {
        return 'external_side_effect';
      }
      return 'review';
    case 'menu_click':
    case 'type_text':
    case 'paste_text':
    case 'set_field_text':
    case 'indesign_find_change':
    case 'indesign_batch_find_change':
    case 'indesign_set_layer_state':
    case 'indesign_batch_update_text_layers':
    case 'indesign_update_text_layer':
    case 'indesign_relink_asset':
    case 'indesign_package_document':
    case 'indesign_export_proof':
    case 'photoshop_update_text_layer':
    case 'photoshop_set_layer_state':
    case 'photoshop_place_asset':
    case 'photoshop_export_proof':
    case 'press_keys':
    case 'wait':
    case 'mouse_move':
    case 'mouse_click':
    case 'mouse_down':
    case 'mouse_up':
    case 'mouse_drag':
    case 'mouse_scroll':
    case 'file_rename':
    case 'file_copy':
    case 'file_trash':
    case 'file_mkdir':
    case 'file_write_text':
      return 'review';
    default:
      return 'safe';
  }
}

export function requiresLocalComputerAwarenessApproval(intent: LocalComputerAwarenessIntent): boolean {
  return getLocalComputerAwarenessRisk(intent) !== 'safe';
}
