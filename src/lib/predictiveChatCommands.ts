import { detectLocalComputerAwarenessIntentSequence } from './localComputerAwarenessIntent';

export type PredictiveChatCommand = {
  id: string;
  label: string;
  text: string;
  hint: string;
  app: 'Photoshop' | 'InDesign' | 'Gmail' | 'WordPress' | 'Engineering' | 'General';
  color: string;
  source: 'starter' | 'match' | 'next_step';
};

type PredictiveCommandSeed = Omit<PredictiveChatCommand, 'source'> & {
  tags: string[];
  priority: number;
};

const PHOTOSHOP_COMMANDS: PredictiveCommandSeed[] = [
  {
    id: 'ps-open-file',
    label: 'Open image',
    text: 'Open Photoshop and open ~/Desktop/image.png',
    hint: 'Open a local image through the desktop bridge',
    app: 'Photoshop',
    color: '#38bdf8',
    tags: ['open', 'file', 'image', 'photo', 'desktop'],
    priority: 95,
  },
  {
    id: 'ps-save-web',
    label: 'Save for web',
    text: 'Open Photoshop and save the image as export.jpg',
    hint: 'Use the Save for Web path before the filename dialog',
    app: 'Photoshop',
    color: '#22c55e',
    tags: ['save', 'export', 'jpg', 'web', 'image'],
    priority: 94,
  },
  {
    id: 'ps-generative-fill',
    label: 'Generative fill',
    text: 'Open Photoshop and use generative fill to add ',
    hint: 'Run Photoshop AI fill on the active selection',
    app: 'Photoshop',
    color: '#f97316',
    tags: ['generate', 'generative', 'fill', 'ai', 'edit', 'add'],
    priority: 93,
  },
  {
    id: 'ps-fill-selection',
    label: 'Fill selection',
    text: 'Open Photoshop and fill selected area with ',
    hint: 'Use Generative Fill on the active highlighted/selected area',
    app: 'Photoshop',
    color: '#fb7185',
    tags: ['selected', 'selection', 'highlighted', 'area', 'generative', 'fill', 'ai'],
    priority: 94,
  },
  {
    id: 'ps-box-fill',
    label: 'Box select + fill',
    text: 'Open Photoshop and select area from 100,100 to 500,500 then generative fill with ',
    hint: 'Create a rectangular marquee selection from coordinates, then run Generative Fill',
    app: 'Photoshop',
    color: '#38bdf8',
    tags: ['rectangle', 'box', 'marquee', 'select', 'coordinates', 'generative', 'fill'],
    priority: 90,
  },
  {
    id: 'ps-remove-selection',
    label: 'Remove selection',
    text: 'Open Photoshop and remove highlighted section with generative fill',
    hint: 'Run blank-prompt Generative Fill to remove the selected area',
    app: 'Photoshop',
    color: '#f97316',
    tags: ['remove', 'erase', 'delete', 'selected', 'highlighted', 'area', 'generative'],
    priority: 89,
  },
  {
    id: 'ps-selection-brush',
    label: 'Selection Brush',
    text: 'Open Photoshop and use selection brush tool for generative fill',
    hint: 'Prep the Selection Brush workflow so the user can paint the area before filling',
    app: 'Photoshop',
    color: '#a3e635',
    tags: ['selection', 'brush', 'highlight', 'paint', 'mask', 'generative', 'fill'],
    priority: 88,
  },
  {
    id: 'ps-brush-fill',
    label: 'Brush select + fill',
    text: 'Open Photoshop and use selection brush from 100,100 to 500,500 then generative fill with ',
    hint: 'Paint a deterministic Selection Brush stroke from coordinates, then run Generative Fill',
    app: 'Photoshop',
    color: '#22c55e',
    tags: ['selection', 'brush', 'stroke', 'coordinates', 'highlight', 'paint', 'generative', 'fill'],
    priority: 91,
  },
  {
    id: 'ps-ai-edit',
    label: 'AI edit image',
    text: 'Open Photoshop and AI edit the image to ',
    hint: 'Use Photoshop AI on the active image or selection',
    app: 'Photoshop',
    color: '#fb923c',
    tags: ['ai', 'edit', 'image', 'photo', 'firefly', 'change', 'modify'],
    priority: 93,
  },
  {
    id: 'ps-generate-image',
    label: 'Generate image',
    text: 'Open Photoshop and generate image of ',
    hint: 'Create a new Photoshop AI image from a prompt',
    app: 'Photoshop',
    color: '#f59e0b',
    tags: ['generate', 'create', 'make', 'image', 'ai', 'firefly'],
    priority: 92,
  },
  {
    id: 'ps-replace-bg',
    label: 'Replace background',
    text: 'Open Photoshop and replace background with ',
    hint: 'Select subject, invert selection, and use Generative Fill for a new background',
    app: 'Photoshop',
    color: '#06b6d4',
    tags: ['replace', 'change', 'swap', 'background', 'generative', 'fill', 'ai'],
    priority: 92,
  },
  {
    id: 'ps-social-canvas',
    label: 'Social canvas',
    text: 'Open Photoshop and create Instagram post canvas with ',
    hint: 'Create a preset-sized Photoshop document and seed it with AI image generation',
    app: 'Photoshop',
    color: '#f43f5e',
    tags: ['instagram', 'social', 'canvas', 'post', 'story', 'ad', 'thumbnail', 'hero'],
    priority: 91,
  },
  {
    id: 'ps-remove-bg',
    label: 'Remove background',
    text: 'Open Photoshop and remove background',
    hint: 'Select subject, then run the Remove Background quick action',
    app: 'Photoshop',
    color: '#ec4899',
    tags: ['remove', 'background', 'cutout', 'subject'],
    priority: 91,
  },
  {
    id: 'ps-harmonize',
    label: 'Harmonize',
    text: 'Open Photoshop and harmonize selected object with background',
    hint: 'Use Photoshop AI Harmonize from the contextual task bar',
    app: 'Photoshop',
    color: '#84cc16',
    tags: ['harmonize', 'match', 'lighting', 'color', 'background', 'object', 'ai'],
    priority: 86,
  },
  {
    id: 'ps-style-transfer',
    label: 'Style transfer',
    text: 'Open Photoshop and apply style transfer',
    hint: 'Open Neural Filters and select Style Transfer',
    app: 'Photoshop',
    color: '#a78bfa',
    tags: ['style', 'transfer', 'neural', 'filter', 'art', 'look'],
    priority: 79,
  },
  {
    id: 'ps-smart-object',
    label: 'Smart Object',
    text: 'Open Photoshop and convert layer to smart object',
    hint: 'Convert the current layer before non-destructive edits',
    app: 'Photoshop',
    color: '#a855f7',
    tags: ['smart', 'object', 'layer', 'convert', 'non destructive'],
    priority: 78,
  },
  {
    id: 'ps-adjustments',
    label: 'Curves layer',
    text: 'Open Photoshop and add curves adjustment layer',
    hint: 'Add a non-destructive curves adjustment',
    app: 'Photoshop',
    color: '#fb7185',
    tags: ['curves', 'adjustment', 'color', 'tone', 'contrast'],
    priority: 76,
  },
  {
    id: 'ps-automation',
    label: 'Image Processor',
    text: 'Open Photoshop and run image processor',
    hint: 'Open Photoshop batch/image processing workflow',
    app: 'Photoshop',
    color: '#06b6d4',
    tags: ['batch', 'processor', 'automation', 'resize', 'bulk'],
    priority: 70,
  },
  {
    id: 'ps-select-sky',
    label: 'Select sky',
    text: 'Open Photoshop and select sky',
    hint: 'Use Photoshop selection helpers before AI fill or sky replacement',
    app: 'Photoshop',
    color: '#0ea5e9',
    tags: ['select', 'sky', 'mask', 'background', 'replace'],
    priority: 69,
  },
  {
    id: 'ps-export-layers',
    label: 'Export layers',
    text: 'Open Photoshop and export layers to files',
    hint: 'Run the Photoshop layer export workflow',
    app: 'Photoshop',
    color: '#10b981',
    tags: ['export', 'layers', 'files', 'batch', 'automation'],
    priority: 84,
  },
  {
    id: 'ps-resolution',
    label: 'Set resolution',
    text: 'Open Photoshop and set image resolution to 300 dpi',
    hint: 'Open Image Size and set print/web resolution',
    app: 'Photoshop',
    color: '#eab308',
    tags: ['resolution', 'dpi', 'ppi', 'print', 'image size'],
    priority: 67,
  },
];

const INDESIGN_COMMANDS: PredictiveCommandSeed[] = [
  {
    id: 'id-text-to-image',
    label: 'Text to Image',
    text: 'Open InDesign and generate image of ',
    hint: 'Use InDesign Firefly Text to Image inside the layout workflow',
    app: 'InDesign',
    color: '#fb7185',
    tags: ['text', 'image', 'generate', 'firefly', 'ai', 'layout'],
    priority: 95,
  },
  {
    id: 'id-generative-expand',
    label: 'Generative Expand',
    text: 'Open InDesign and generative expand selected image',
    hint: 'Use InDesign Generative Expand on the selected placed image',
    app: 'InDesign',
    color: '#f97316',
    tags: ['generative', 'expand', 'image', 'frame', 'firefly', 'ai'],
    priority: 94,
  },
  {
    id: 'id-generative-fill',
    label: 'Generative Fill',
    text: 'Open InDesign and generative fill with ',
    hint: 'Use InDesign Generative Fill from the contextual task bar',
    app: 'InDesign',
    color: '#f59e0b',
    tags: ['generative', 'fill', 'firefly', 'ai', 'image', 'graphic'],
    priority: 94,
  },
  {
    id: 'id-place',
    label: 'Place asset',
    text: 'Open InDesign and place ~/Desktop/logo.png',
    hint: 'Place a local image or asset into the layout',
    app: 'InDesign',
    color: '#ff4f9a',
    tags: ['place', 'import', 'insert', 'image', 'asset', 'logo'],
    priority: 94,
  },
  {
    id: 'id-banner-workspace',
    label: 'Banner workspace',
    text: 'Open InDesign and prep banner workflow',
    hint: 'Open Layers, Links, Object Styles, Paragraph Styles, Data Merge, Align, Preflight, and Properties',
    app: 'InDesign',
    color: '#0f766e',
    tags: ['banner', 'banners', 'ads', 'creative', 'layers', 'workflow', 'workspace', 'designer'],
    priority: 96,
  },
  {
    id: 'id-object-layer-options',
    label: 'Object layer options',
    text: 'Open InDesign and show object layer options for selected graphic',
    hint: 'Control layer visibility for selected placed PSD, PDF, AI, or graphic assets',
    app: 'InDesign',
    color: '#2563eb',
    tags: ['object', 'layer', 'options', 'psd', 'placed', 'layers', 'variant'],
    priority: 95,
  },
  {
    id: 'id-banner-text',
    label: 'Banner text',
    text: 'Open InDesign and set selected banner headline to ',
    hint: 'Paste replacement headline, CTA, body, offer, or disclaimer copy into the selected text frame',
    app: 'InDesign',
    color: '#db2777',
    tags: ['banner', 'headline', 'title', 'cta', 'copy', 'text', 'layers'],
    priority: 94,
  },
  {
    id: 'id-dealer-disclaimer',
    label: 'Dealer disclaimer',
    text: 'Change disclaimer to ',
    hint: 'Target the Disclaimer layer in the open InDesign dealership banner and paste new legal copy',
    app: 'InDesign',
    color: '#111827',
    tags: ['dealer', 'dealership', 'disclaimer', 'legal', 'fine print', 'banner', 'copy'],
    priority: 98,
  },
  {
    id: 'id-dealer-open-edit',
    label: 'Open file + edit',
    text: 'Find dealer-banner.indd on my Desktop and change disclaimer to ',
    hint: 'Find the InDesign file locally, open it, then run the deterministic dealership edit macro',
    app: 'InDesign',
    color: '#334155',
    tags: ['dealer', 'dealership', 'indd', 'open file', 'desktop', 'disclaimer', 'banner'],
    priority: 98,
  },
  {
    id: 'id-indesign-open-file',
    label: 'Open InDesign file',
    text: 'Open InDesign file ~/Desktop/banner.indd',
    hint: 'Open an InDesign document by path or local file search before running edits',
    app: 'InDesign',
    color: '#475569',
    tags: ['indesign', 'indd', 'open file', 'desktop', 'document'],
    priority: 97,
  },
  {
    id: 'id-dealer-apr',
    label: 'APR / lease offer',
    text: 'Update APR to ',
    hint: 'Target the offer layer for APR, lease, payment, rebate, or incentive changes',
    app: 'InDesign',
    color: '#0ea5e9',
    tags: ['dealer', 'apr', 'finance', 'lease', 'payment', 'rebate', 'offer'],
    priority: 97,
  },
  {
    id: 'id-dealer-price',
    label: 'Sale price',
    text: 'Update sale price to ',
    hint: 'Target the Price layer in the open InDesign banner',
    app: 'InDesign',
    color: '#16a34a',
    tags: ['dealer', 'price', 'sale price', 'msrp', 'vehicle', 'banner'],
    priority: 96,
  },
  {
    id: 'id-dealer-find-replace',
    label: 'Find / replace legal',
    text: 'Replace "old disclaimer" with "new disclaimer" in InDesign',
    hint: 'Open InDesign Find/Change and run Change All for exact text replacement',
    app: 'InDesign',
    color: '#7c3aed',
    tags: ['dealer', 'find', 'replace', 'legal', 'disclaimer', 'change all'],
    priority: 95,
  },
  {
    id: 'id-dealer-proof',
    label: 'Dealer proof setup',
    text: 'Prep dealership banner for legal review',
    hint: 'Open Layers, Links, Styles, Preflight, and Find/Change for review',
    app: 'InDesign',
    color: '#f97316',
    tags: ['dealer', 'dealership', 'proof', 'legal', 'review', 'preflight', 'banner'],
    priority: 94,
  },
  {
    id: 'id-banner-asset',
    label: 'Replace banner asset',
    text: 'Open InDesign and replace selected banner image with ~/Desktop/hero.png',
    hint: 'Place a replacement image/logo/background into the selected banner frame and fit it',
    app: 'InDesign',
    color: '#ea580c',
    tags: ['banner', 'image', 'asset', 'logo', 'background', 'replace', 'place'],
    priority: 94,
  },
  {
    id: 'id-relink-asset',
    label: 'Relink asset',
    text: 'Open InDesign and relink selected image to ~/Desktop/new-hero.png',
    hint: 'Open Links, relink the selected placed asset, choose a local file, then fit the frame',
    app: 'InDesign',
    color: '#0284c7',
    tags: ['relink', 'link', 'links', 'image', 'asset', 'logo', 'missing link', 'replace'],
    priority: 95,
  },
  {
    id: 'id-resize-banner',
    label: 'Resize banner',
    text: 'Open InDesign and resize selected banner to 300x250',
    hint: 'Open Transform and set selected object width and height',
    app: 'InDesign',
    color: '#0f766e',
    tags: ['resize', 'banner', 'ad', 'creative', '300x250', 'transform', 'size'],
    priority: 95,
  },
  {
    id: 'id-apply-style',
    label: 'Apply style',
    text: 'Open InDesign and apply paragraph style Disclaimer Small',
    hint: 'Open the style panel and click a paragraph, character, or object style',
    app: 'InDesign',
    color: '#7c3aed',
    tags: ['style', 'paragraph style', 'character style', 'object style', 'copy', 'brand'],
    priority: 92,
  },
  {
    id: 'id-align-center',
    label: 'Align to page',
    text: 'Open InDesign and align selected object to page center',
    hint: 'Open Align, align to page, then center horizontally and vertically',
    app: 'InDesign',
    color: '#2563eb',
    tags: ['align', 'center', 'page', 'object', 'frame', 'layout'],
    priority: 91,
  },
  {
    id: 'id-new-banner-doc',
    label: 'New banner doc',
    text: 'Open InDesign and create new 300x250 banner with 0.125 in bleed',
    hint: 'Create a production-sized InDesign document and open Layers/Preflight',
    app: 'InDesign',
    color: '#1d4ed8',
    tags: ['new document', 'document size', 'banner size', '300x250', 'bleed', 'production'],
    priority: 95,
  },
  {
    id: 'id-document-setup',
    label: 'Doc setup',
    text: 'Open InDesign and set document bleed to 0.125 in',
    hint: 'Open Document Setup and set document bleed fields deterministically',
    app: 'InDesign',
    color: '#334155',
    tags: ['document setup', 'bleed', 'margins', 'columns', 'page size'],
    priority: 93,
  },
  {
    id: 'id-create-layer',
    label: 'Create layer',
    text: 'Open InDesign and create layer Legal',
    hint: 'Open Layers, create a new layer, and name it',
    app: 'InDesign',
    color: '#475569',
    tags: ['layer', 'new layer', 'create layer', 'legal', 'organization'],
    priority: 90,
  },
  {
    id: 'id-create-swatch',
    label: 'Create swatch',
    text: 'Open InDesign and create swatch Toyota Red #eb0a1e',
    hint: 'Create an RGB color swatch from a hex value',
    app: 'InDesign',
    color: '#dc2626',
    tags: ['swatch', 'color', 'brand color', 'hex', 'rgb'],
    priority: 89,
  },
  {
    id: 'id-text-wrap',
    label: 'Text wrap',
    text: 'Open InDesign and wrap text around selected image',
    hint: 'Open Text Wrap and apply a wrap mode to the selected frame/object',
    app: 'InDesign',
    color: '#0f766e',
    tags: ['text wrap', 'wrap text', 'image wrap', 'object wrap'],
    priority: 88,
  },
  {
    id: 'id-parent-pages',
    label: 'Parent pages',
    text: 'Open InDesign and apply parent A-Parent to pages 1-3',
    hint: 'Open Pages and apply a parent/master page to a page range',
    app: 'InDesign',
    color: '#7c3aed',
    tags: ['parent page', 'master page', 'pages', 'apply parent'],
    priority: 87,
  },
  {
    id: 'id-create-guides',
    label: 'Guide grid',
    text: 'Open InDesign and create guides 3 rows and 4 columns',
    hint: 'Open Create Guides and set a row/column grid',
    app: 'InDesign',
    color: '#0891b2',
    tags: ['guides', 'guide grid', 'rows', 'columns', 'layout'],
    priority: 86,
  },
  {
    id: 'id-variable-banners',
    label: 'Variable banners',
    text: 'Open InDesign and set up variable banners with data merge',
    hint: 'Open the Data Merge, Layers, Links, Pages, Styles, and Preflight panels for banner variants',
    app: 'InDesign',
    color: '#0891b2',
    tags: ['banner', 'data', 'merge', 'variable', 'batch', 'variants', 'automation'],
    priority: 93,
  },
  {
    id: 'id-data-merge-source',
    label: 'Data source',
    text: 'Open InDesign and set data merge source to ~/Desktop/vehicles.csv',
    hint: 'Open Data Merge, select a CSV/spreadsheet source, and preview records',
    app: 'InDesign',
    color: '#0369a1',
    tags: ['data', 'merge', 'csv', 'spreadsheet', 'source', 'vehicles', 'batch'],
    priority: 95,
  },
  {
    id: 'id-create-merged-document',
    label: 'Merge records',
    text: 'Open InDesign and create merged document',
    hint: 'Create the merged output document from the current Data Merge source',
    app: 'InDesign',
    color: '#0d9488',
    tags: ['data', 'merge', 'merged document', 'records', 'batch', 'output'],
    priority: 92,
  },
  {
    id: 'id-banner-export',
    label: 'Export banner',
    text: 'Open InDesign and export selected banner as banner.jpg',
    hint: 'Open export flow for the selected banner/page/spread',
    app: 'InDesign',
    color: '#16a34a',
    tags: ['banner', 'export', 'jpg', 'png', 'pdf', 'handoff'],
    priority: 91,
  },
  {
    id: 'id-banner-alt-layout',
    label: 'Banner variant',
    text: 'Open InDesign and create banner variant',
    hint: 'Open Create Alternate Layout for additional banner sizes or campaign variants',
    app: 'InDesign',
    color: '#9333ea',
    tags: ['banner', 'variant', 'alternate', 'layout', 'size', 'version'],
    priority: 90,
  },
  {
    id: 'id-proof-pdf',
    label: 'Proof PDF',
    text: 'Open InDesign and export proof pdf as dealer-proof.pdf',
    hint: 'Open Preflight, export a review/proof PDF, and confirm export options',
    app: 'InDesign',
    color: '#dc2626',
    tags: ['proof', 'pdf', 'legal review', 'client review', 'export', 'dealer'],
    priority: 94,
  },
  {
    id: 'id-export-page-range',
    label: 'Export pages',
    text: 'Open InDesign and export pages 1-3 as proof.pdf',
    hint: 'Export a specific page range and set the Range field before final export',
    app: 'InDesign',
    color: '#be123c',
    tags: ['export', 'pages', 'range', 'proof', 'pdf', 'review'],
    priority: 92,
  },
  {
    id: 'id-export-preset',
    label: 'PDF preset',
    text: 'Open InDesign and export pdf using preset Dealer Proof as dealer-proof.pdf',
    hint: 'Use a named Adobe PDF preset and export the current document',
    app: 'InDesign',
    color: '#ea580c',
    tags: ['pdf preset', 'export preset', 'dealer proof', 'proof', 'pdf'],
    priority: 91,
  },
  {
    id: 'id-package-handoff',
    label: 'Package handoff',
    text: 'Open InDesign and package document for handoff',
    hint: 'Open Preflight and Links before starting Package for production handoff',
    app: 'InDesign',
    color: '#0891b2',
    tags: ['package', 'handoff', 'production', 'vendor', 'links', 'preflight'],
    priority: 93,
  },
  {
    id: 'id-update-links',
    label: 'Update links',
    text: 'Open InDesign and update all links',
    hint: 'Open Links and run update/relink/edit-original actions without an LLM',
    app: 'InDesign',
    color: '#0ea5e9',
    tags: ['links', 'update links', 'missing link', 'relink', 'edit original'],
    priority: 91,
  },
  {
    id: 'id-group-selection',
    label: 'Group selection',
    text: 'Open InDesign and group selected objects',
    hint: 'Use Object > Group for selected frames or banner elements',
    app: 'InDesign',
    color: '#64748b',
    tags: ['group', 'ungroup', 'objects', 'selection', 'layout'],
    priority: 86,
  },
  {
    id: 'id-lock-layer',
    label: 'Lock layer',
    text: 'Open InDesign and lock layer Legal',
    hint: 'Open Layers, target the named layer, and run a layer lock/visibility action',
    app: 'InDesign',
    color: '#475569',
    tags: ['lock', 'unlock', 'hide', 'show', 'layer', 'legal'],
    priority: 86,
  },
  {
    id: 'id-brochure-layout',
    label: 'Brochure layout',
    text: 'Open InDesign and create tri-fold brochure layout',
    hint: 'Create a document with brochure columns and open production panels',
    app: 'InDesign',
    color: '#ec4899',
    tags: ['brochure', 'trifold', 'tri-fold', 'layout', 'columns', 'template'],
    priority: 92,
  },
  {
    id: 'id-export-pdf',
    label: 'Export PDF',
    text: 'Open InDesign and export high quality pdf as brochure.pdf',
    hint: 'Use InDesign PDF export presets',
    app: 'InDesign',
    color: '#f97316',
    tags: ['export', 'pdf', 'print', 'interactive', 'brochure'],
    priority: 93,
  },
  {
    id: 'id-alt-text',
    label: 'Generate alt text',
    text: 'Open InDesign and generate alt text',
    hint: 'Open Object Export Options and generate image alt text',
    app: 'InDesign',
    color: '#22c55e',
    tags: ['alt', 'text', 'accessibility', 'accessible', 'image', 'pdf'],
    priority: 91,
  },
  {
    id: 'id-accessible-pdf',
    label: 'Accessible PDF prep',
    text: 'Open InDesign and prepare accessible PDF',
    hint: 'Run preflight, generate alt text, and open export prep',
    app: 'InDesign',
    color: '#14b8a6',
    tags: ['accessible', 'accessibility', 'pdf', 'preflight', 'alt text', 'export'],
    priority: 90,
  },
  {
    id: 'id-preflight',
    label: 'Preflight',
    text: 'Open InDesign and show preflight panel',
    hint: 'Check layout output readiness',
    app: 'InDesign',
    color: '#22c55e',
    tags: ['preflight', 'check', 'proof', 'print', 'errors'],
    priority: 89,
  },
  {
    id: 'id-package',
    label: 'Package',
    text: 'Open InDesign and package document',
    hint: 'Collect fonts, links, and package assets',
    app: 'InDesign',
    color: '#38bdf8',
    tags: ['package', 'collect', 'fonts', 'links', 'handoff'],
    priority: 88,
  },
  {
    id: 'id-fit-content',
    label: 'Fit content',
    text: 'Open InDesign and fit content proportionally',
    hint: 'Fit selected content inside its frame',
    app: 'InDesign',
    color: '#a855f7',
    tags: ['fit', 'frame', 'content', 'image', 'proportionally'],
    priority: 96,
  },
  {
    id: 'id-insert-pages',
    label: 'Insert pages',
    text: 'Open InDesign and insert 3 pages',
    hint: 'Open Insert Pages and set a page count',
    app: 'InDesign',
    color: '#f59e0b',
    tags: ['insert', 'add', 'pages', 'layout'],
    priority: 78,
  },
  {
    id: 'id-toc',
    label: 'Table of contents',
    text: 'Open InDesign and create table of contents',
    hint: 'Open the layout TOC command',
    app: 'InDesign',
    color: '#14b8a6',
    tags: ['toc', 'table', 'contents', 'book', 'layout'],
    priority: 74,
  },
  {
    id: 'id-fonts',
    label: 'Find fonts',
    text: 'Open InDesign and find missing fonts',
    hint: 'Open Find/Replace Font for production cleanup',
    app: 'InDesign',
    color: '#eab308',
    tags: ['font', 'fonts', 'missing', 'replace', 'type'],
    priority: 72,
  },
  {
    id: 'id-hidden-chars',
    label: 'Hidden chars',
    text: 'Open InDesign and show hidden characters',
    hint: 'Reveal invisible formatting marks for layout cleanup',
    app: 'InDesign',
    color: '#f43f5e',
    tags: ['hidden', 'characters', 'formatting', 'type', 'cleanup'],
    priority: 71,
  },
  {
    id: 'id-data-merge',
    label: 'Data Merge',
    text: 'Open InDesign and show data merge panel',
    hint: 'Open Data Merge for catalogs, labels, and variable layouts',
    app: 'InDesign',
    color: '#0ea5e9',
    tags: ['data', 'merge', 'catalog', 'labels', 'automation'],
    priority: 94,
  },
  {
    id: 'id-page-number',
    label: 'Page number',
    text: 'Open InDesign and insert current page number',
    hint: 'Insert the current page marker into selected text',
    app: 'InDesign',
    color: '#8b5cf6',
    tags: ['page', 'number', 'marker', 'master', 'parent'],
    priority: 69,
  },
  {
    id: 'id-output-preview',
    label: 'Separations',
    text: 'Open InDesign and show separations preview',
    hint: 'Open output preview before print/PDF handoff',
    app: 'InDesign',
    color: '#22c55e',
    tags: ['separations', 'preview', 'output', 'print', 'cmyk'],
    priority: 68,
  },
];

const MAC_COMMANDS: PredictiveCommandSeed[] = [
  {
    id: 'mac-spotlight',
    label: 'Spotlight search',
    text: 'Search Spotlight for Photoshop',
    hint: 'Open Spotlight, paste the query, and submit',
    app: 'General',
    color: '#60a5fa',
    tags: ['mac', 'spotlight', 'search', 'open', 'app'],
    priority: 84,
  },
  {
    id: 'mac-mission-control',
    label: 'Mission Control',
    text: 'Show Mission Control',
    hint: 'Use the macOS window overview shortcut',
    app: 'General',
    color: '#a78bfa',
    tags: ['mac', 'mission', 'control', 'windows', 'spaces', 'dashboard'],
    priority: 83,
  },
  {
    id: 'mac-finder-downloads',
    label: 'Finder Downloads',
    text: 'Open Finder Downloads',
    hint: 'Focus Finder and jump to Downloads',
    app: 'General',
    color: '#38bdf8',
    tags: ['mac', 'finder', 'downloads', 'folder', 'files'],
    priority: 82,
  },
  {
    id: 'mac-system-settings',
    label: 'Accessibility',
    text: 'Open System Settings Accessibility',
    hint: 'Open System Settings and search the Accessibility pane',
    app: 'General',
    color: '#f59e0b',
    tags: ['mac', 'system', 'settings', 'accessibility', 'permissions'],
    priority: 81,
  },
  {
    id: 'mac-screenshot-selection',
    label: 'Screenshot area',
    text: 'Take selection screenshot',
    hint: 'Start the macOS selected-area screenshot tool',
    app: 'General',
    color: '#22c55e',
    tags: ['mac', 'screenshot', 'screen', 'selection', 'area'],
    priority: 80,
  },
  {
    id: 'mac-finder-list-view',
    label: 'Finder list',
    text: 'Set Finder to list view',
    hint: 'Switch Finder to list view',
    app: 'General',
    color: '#14b8a6',
    tags: ['mac', 'finder', 'list', 'view', 'files'],
    priority: 76,
  },
];

const GMAIL_COMMANDS: PredictiveCommandSeed[] = [
  {
    id: 'gmail-inbox',
    label: 'Open inbox',
    text: 'Open Gmail inbox',
    hint: 'Open Gmail through the desktop/browser bridge',
    app: 'Gmail',
    color: '#ea4335',
    tags: ['gmail', 'email', 'mail', 'inbox', 'open'],
    priority: 91,
  },
  {
    id: 'gmail-compose',
    label: 'Draft email',
    text: 'Draft Gmail to ',
    hint: 'Open a Gmail compose URL with recipient, subject, and body when provided',
    app: 'Gmail',
    color: '#fbbc04',
    tags: ['gmail', 'email', 'compose', 'draft', 'write', 'message'],
    priority: 90,
  },
  {
    id: 'gmail-search',
    label: 'Search Gmail',
    text: 'Search Gmail for ',
    hint: 'Jump directly to Gmail search results instead of a generic web search',
    app: 'Gmail',
    color: '#4285f4',
    tags: ['gmail', 'email', 'mail', 'search', 'find'],
    priority: 89,
  },
  {
    id: 'gmail-drafts',
    label: 'Open drafts',
    text: 'Open Gmail drafts',
    hint: 'Open the Gmail drafts mailbox',
    app: 'Gmail',
    color: '#34a853',
    tags: ['gmail', 'email', 'drafts', 'draft', 'mailbox'],
    priority: 82,
  },
  {
    id: 'gmail-sent',
    label: 'Open sent',
    text: 'Open Gmail sent',
    hint: 'Open sent mail in Gmail',
    app: 'Gmail',
    color: '#a855f7',
    tags: ['gmail', 'email', 'sent', 'mailbox'],
    priority: 80,
  },
];

const WORDPRESS_COMMANDS: PredictiveCommandSeed[] = [
  {
    id: 'wp-open-admin',
    label: 'Open admin',
    text: 'Open WordPress dashboard',
    hint: 'Open WordPress admin in the browser bridge',
    app: 'WordPress',
    color: '#21759b',
    tags: ['wordpress', 'wp', 'admin', 'dashboard', 'cms'],
    priority: 92,
  },
  {
    id: 'wp-new-post',
    label: 'New post',
    text: 'Open WordPress new post',
    hint: 'Open the WordPress post editor without publishing',
    app: 'WordPress',
    color: '#3858e9',
    tags: ['wordpress', 'wp', 'post', 'new', 'editor', 'blog'],
    priority: 91,
  },
  {
    id: 'wp-draft',
    label: 'AI draft post',
    text: '/wp draft ',
    hint: 'Use the connected WordPress API path to create a draft',
    app: 'WordPress',
    color: '#22c55e',
    tags: ['wordpress', 'wp', 'draft', 'post', 'article', 'write'],
    priority: 90,
  },
  {
    id: 'wp-list',
    label: 'List posts',
    text: '/wp list',
    hint: 'List recent WordPress posts from the connected site',
    app: 'WordPress',
    color: '#f59e0b',
    tags: ['wordpress', 'wp', 'list', 'posts', 'recent'],
    priority: 84,
  },
  {
    id: 'wp-media',
    label: 'Media library',
    text: 'Open WordPress media library',
    hint: 'Open the media library for uploads and asset review',
    app: 'WordPress',
    color: '#06b6d4',
    tags: ['wordpress', 'wp', 'media', 'library', 'image', 'upload'],
    priority: 82,
  },
  {
    id: 'wp-status',
    label: 'WP status',
    text: '/wp status',
    hint: 'Check connected WordPress credentials and site status',
    app: 'WordPress',
    color: '#64748b',
    tags: ['wordpress', 'wp', 'status', 'connected', 'credentials'],
    priority: 81,
  },
];

const ENGINEERING_COMMANDS: PredictiveCommandSeed[] = [
  {
    id: 'eng-open-cad',
    label: 'Open CAD app',
    text: 'Open AutoCAD and inspect the current drawing state',
    hint: 'Launch or focus the CAD app, then observe window, a11y, and screen state before edits',
    app: 'Engineering',
    color: '#0f766e',
    tags: ['autocad', 'cad', 'open', 'inspect', 'drawing', 'engineering', 'desktop'],
    priority: 92,
  },
  {
    id: 'eng-floor-plan',
    label: 'Draft floor plan',
    text: 'Open AutoCAD and create a 2D floor plan with two rooms and dimensions',
    hint: 'Use the engineering/CAD control loop with units, scale, and screenshot checkpoints',
    app: 'Engineering',
    color: '#2563eb',
    tags: ['autocad', 'cad', 'floor', 'plan', '2d', 'dimensions', 'draw', 'draft'],
    priority: 91,
  },
  {
    id: 'eng-dimension-check',
    label: 'Check dimensions',
    text: 'Open AutoCAD and verify the drawing units, scale, layers, and key dimensions',
    hint: 'Read-first CAD verification before making or exporting engineering changes',
    app: 'Engineering',
    color: '#7c3aed',
    tags: ['autocad', 'cad', 'dimension', 'dimensions', 'units', 'scale', 'layers', 'verify'],
    priority: 90,
  },
  {
    id: 'eng-export-dxf',
    label: 'Export DXF',
    text: 'Open AutoCAD and export the drawing as DXF after approval',
    hint: 'Verify destination path and request approval before save/export/overwrite',
    app: 'Engineering',
    color: '#ea580c',
    tags: ['autocad', 'cad', 'export', 'dxf', 'dwg', 'save', 'approval'],
    priority: 86,
  },
  {
    id: 'eng-parametric-sketch',
    label: 'Parametric sketch',
    text: 'Open Fusion 360 and create a parametric sketch with constraints and dimensions',
    hint: 'Use engineering app control with one modeling operation per checkpoint',
    app: 'Engineering',
    color: '#0891b2',
    tags: ['fusion', 'fusion 360', 'cad', 'parametric', 'sketch', 'constraints', 'dimensions', 'model'],
    priority: 84,
  },
];

const GENERAL_COMMANDS: PredictiveCommandSeed[] = [
  {
    id: 'desktop-tabs',
    label: 'See local tabs',
    text: 'Tell me all the tabs I have open in Chrome right now',
    hint: 'Use the local desktop bridge, not Browserbase',
    app: 'General',
    color: '#22d3ee',
    tags: ['tabs', 'chrome', 'browser', 'local', 'computer'],
    priority: 66,
  },
  {
    id: 'desktop-apps',
    label: 'Open apps',
    text: 'What apps are open on my computer?',
    hint: 'Read local running applications',
    app: 'General',
    color: '#94a3b8',
    tags: ['apps', 'open', 'computer', 'desktop'],
    priority: 62,
  },
];

const ALL_COMMANDS = [
  ...PHOTOSHOP_COMMANDS,
  ...INDESIGN_COMMANDS,
  ...MAC_COMMANDS,
  ...GMAIL_COMMANDS,
  ...WORDPRESS_COMMANDS,
  ...ENGINEERING_COMMANDS,
  ...GENERAL_COMMANDS,
];

function normalize(value: string): string {
  return String(value || '').toLowerCase().replace(/[^a-z0-9./~ -]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function inferApp(input: string): PredictiveChatCommand['app'] | null {
  if (/\bindesign|in\s*design\b/i.test(input)) {
    return 'InDesign';
  }
  if (/\bphotoshop|photo\s*shop\b/i.test(input)) {
    return 'Photoshop';
  }
  if (/\bgmail|email|emails|mailbox|inbox|sent mail|draft email|compose\b/i.test(input)) {
    return 'Gmail';
  }
  if (/\bwordpress|wp\b|wp-admin|blog|cms|posts?|publish|draft post|media library\b/i.test(input)) {
    return 'WordPress';
  }
  if (/\b(auto\s*cad|autocad|cad|fusion\s*360|solid\s*works|solidworks|matlab|simulink|simscape|sketch\s*up|sketchup|freecad|librecad|qcad|rhino(?:ceros)?|revit|civil\s*3d|inventor|onshape|dwg|dxf|mlx|slx|floor plan|technical drawing|engineering drawing|mechanical drawing|blueprint|dimensioned drawing|parametric sketch|simulation|toolbox)\b/i.test(input)) {
    return 'Engineering';
  }
  if (/\bimage|photo|picture|generative fill|generative expand|save for web|background|harmoni[sz]e|style transfer|smart portrait|social canvas|selected area|highlighted area|selection brush|marquee\b/i.test(input)) {
    return 'Photoshop';
  }
  if (/\bindesign|in\s*design|\.indd\b|layout|brochure|preflight|package|handoff|place|relink|replace link|missing link|update links?|edit original|apply style|paragraph style|character style|object style|proof pdf|page range|pdf preset|export preset|pdf|pages?\b|parent page|master page|document setup|document size|page size|bleed|margins?|columns?|guides?|text wrap|swatches?|brand color|new layer|rename layer|text to image|alt text|accessible|accessibility|tri-?fold|data merge|merged document|csv|spreadsheet|object layer options|placed psd|variable banners?|resize (?:selected )?(?:banner|ad|creative|frame)|align selected|center selected|group selected|ungroup selected|lock layer|unlock layer|hide layer|show layer|banner (?:workflow|workspace|layers?|variants?|text|headline|asset|export)\b|dealership|dealer|automotive|disclaimer|fine print|legal copy|lease terms?|finance apr|apr|monthly payment|sale price|msrp|stock number|vin|rebate|incentive/i.test(input)) {
    return 'InDesign';
  }
  if (/\b(mac|finder|spotlight|mission control|system settings|system preferences|screenshot|desktop|downloads|launchpad)\b/i.test(input)) {
    return 'General';
  }
  return null;
}

function commandScore(seed: PredictiveCommandSeed, query: string, inferredApp: PredictiveChatCommand['app'] | null): number {
  if (!query) return seed.priority;
  const haystack = normalize([seed.label, seed.text, seed.hint, seed.tags.join(' ')].join(' '));
  const words = query.split(' ').filter(Boolean);
  const directHits = words.filter((word) => haystack.includes(word)).length;
  const prefixHits = seed.tags.filter((tag) => normalize(tag).startsWith(query)).length;
  let score = seed.priority + directHits * 12 + prefixHits * 8;
  if (inferredApp && seed.app === inferredApp) score += 35;
  if (inferredApp && seed.app !== inferredApp && seed.app !== 'General') score -= 30;
  if (haystack.includes(query)) score += 20;
  return score;
}

function nextStepCommands(input: string): PredictiveCommandSeed[] {
  const sequence = detectLocalComputerAwarenessIntentSequence(input);
  const last = sequence[sequence.length - 1];
  const targetText = normalize([input, last?.appQuery, last?.reason, last?.targetLabel, last?.menuPath?.join(' ')].filter(Boolean).join(' '));
  if (!targetText) return [];

  if (/\b(auto\s*cad|autocad|cad|fusion\s*360|solid\s*works|solidworks|matlab|simulink|simscape|sketch\s*up|sketchup|freecad|librecad|qcad|rhino(?:ceros)?|revit|civil\s*3d|inventor|onshape|dwg|dxf|mlx|slx|engineering drawing|technical drawing|floor plan|parametric sketch|simulation|toolbox)\b/i.test(targetText)) {
    if (/\b(export|save|dxf|dwg|step|stl|overwrite)\b/i.test(targetText)) {
      return ENGINEERING_COMMANDS.filter((cmd) => ['eng-export-dxf', 'eng-dimension-check', 'eng-open-cad'].includes(cmd.id));
    }
    if (/\b(dimension|units?|scale|layers?|verify|inspect|check)\b/i.test(targetText)) {
      return ENGINEERING_COMMANDS.filter((cmd) => ['eng-dimension-check', 'eng-open-cad', 'eng-export-dxf'].includes(cmd.id));
    }
    if (/\b(fusion|parametric|constraint|extrude|3d|model)\b/i.test(targetText)) {
      return ENGINEERING_COMMANDS.filter((cmd) => ['eng-parametric-sketch', 'eng-dimension-check', 'eng-open-cad'].includes(cmd.id));
    }
    if (/\b(floor plan|site plan|blueprint|draw|draft|create|make|2d)\b/i.test(targetText)) {
      return ENGINEERING_COMMANDS.filter((cmd) => ['eng-floor-plan', 'eng-dimension-check', 'eng-export-dxf'].includes(cmd.id));
    }
    return ENGINEERING_COMMANDS.filter((cmd) => ['eng-open-cad', 'eng-dimension-check', 'eng-floor-plan'].includes(cmd.id));
  }

  if (targetText.includes('photoshop')) {
    if (targetText.includes('select subject')) {
      return PHOTOSHOP_COMMANDS.filter((cmd) => ['ps-remove-bg', 'ps-replace-bg', 'ps-harmonize', 'ps-fill-selection'].includes(cmd.id));
    }
    if (targetText.includes('save')) {
      return PHOTOSHOP_COMMANDS.filter((cmd) => ['ps-save-web'].includes(cmd.id));
    }
    if (targetText.includes('selected area') || targetText.includes('highlighted area') || targetText.includes('selection brush') || targetText.includes('marquee') || targetText.includes('rectangular selection')) {
      return PHOTOSHOP_COMMANDS.filter((cmd) => ['ps-fill-selection', 'ps-remove-selection', 'ps-generative-fill', 'ps-box-fill', 'ps-selection-brush', 'ps-brush-fill'].includes(cmd.id));
    }
    if (targetText.includes('export layers')) {
      return [];
    }
    if (targetText.includes('open photoshop') || targetText.includes('launch photoshop')) {
      return PHOTOSHOP_COMMANDS.filter((cmd) => ['ps-open-file', 'ps-fill-selection', 'ps-selection-brush', 'ps-brush-fill', 'ps-ai-edit'].includes(cmd.id));
    }
    return PHOTOSHOP_COMMANDS.filter((cmd) => ['ps-fill-selection', 'ps-generative-fill', 'ps-remove-selection', 'ps-ai-edit'].includes(cmd.id));
  }

  if (/\.indd\b/.test(targetText)) {
    return INDESIGN_COMMANDS.filter((cmd) => [
      'id-indesign-open-file',
      'id-dealer-open-edit',
      'id-dealer-disclaimer',
      'id-dealer-find-replace',
      'id-dealer-proof',
      'id-banner-workspace',
    ].includes(cmd.id));
  }

  if (targetText.includes('indesign')) {
    if (/\bpdf preset|export preset|dealer proof\b/.test(targetText)) {
      return INDESIGN_COMMANDS.filter((cmd) => ['id-export-preset', 'id-proof-pdf', 'id-export-page-range', 'id-package-handoff', 'id-preflight'].includes(cmd.id));
    }
    if (/\bdealer|dealership|automotive|disclaimer|fine print|legal|apr|finance|lease|payment|sale price|msrp|stock|vin|rebate|incentive\b/.test(targetText)) {
      return INDESIGN_COMMANDS.filter((cmd) => [
        'id-dealer-open-edit',
        'id-indesign-open-file',
        'id-dealer-disclaimer',
        'id-dealer-apr',
        'id-dealer-price',
        'id-dealer-find-replace',
        'id-dealer-proof',
        'id-proof-pdf',
        'id-package-handoff',
        'id-banner-export',
      ].includes(cmd.id));
    }
    if (/\brelink|replace link|missing link|links?\b/.test(targetText)) {
      return INDESIGN_COMMANDS.filter((cmd) => ['id-relink-asset', 'id-update-links', 'id-banner-asset', 'id-package-handoff', 'id-preflight'].includes(cmd.id));
    }
    if (/\bresize|transform|300x250|728x90|160x600|300x600|320x50\b/.test(targetText)) {
      return INDESIGN_COMMANDS.filter((cmd) => ['id-new-banner-doc', 'id-resize-banner', 'id-document-setup', 'id-align-center', 'id-banner-export', 'id-banner-workspace'].includes(cmd.id));
    }
    if (/\bdocument setup|document size|page size|bleed|margins?|columns?\b/.test(targetText)) {
      return INDESIGN_COMMANDS.filter((cmd) => ['id-document-setup', 'id-new-banner-doc', 'id-create-guides', 'id-proof-pdf', 'id-preflight'].includes(cmd.id));
    }
    if (/\bswatch|brand color|fill color|stroke color|text color\b/.test(targetText)) {
      return INDESIGN_COMMANDS.filter((cmd) => ['id-create-swatch', 'id-apply-style', 'id-banner-workspace', 'id-proof-pdf'].includes(cmd.id));
    }
    if (/\btext wrap|wrap text|image wrap|object wrap\b/.test(targetText)) {
      return INDESIGN_COMMANDS.filter((cmd) => ['id-text-wrap', 'id-fit-content', 'id-align-center', 'id-banner-workspace'].includes(cmd.id));
    }
    if (/\bparent page|master page|apply parent|guide grid|guides?\b/.test(targetText)) {
      return INDESIGN_COMMANDS.filter((cmd) => ['id-parent-pages', 'id-create-guides', 'id-banner-workspace', 'id-preflight'].includes(cmd.id));
    }
    if (/\b(?:replace|swap|update)\b.*\b(?:banner|image|photo|asset|logo|background|hero)\b|\b(?:banner|image|photo|asset|logo|background|hero)\b.*\b(?:replace|swap|update)\b/.test(targetText)) {
      return INDESIGN_COMMANDS.filter((cmd) => ['id-banner-asset', 'id-relink-asset', 'id-fit-content', 'id-text-wrap', 'id-banner-export', 'id-preflight'].includes(cmd.id));
    }
    if (/\bstyle|paragraph style|character style|object style\b/.test(targetText)) {
      return INDESIGN_COMMANDS.filter((cmd) => ['id-apply-style', 'id-create-swatch', 'id-banner-text', 'id-dealer-disclaimer', 'id-accessible-pdf'].includes(cmd.id));
    }
    if (/\bproof|handoff|package|production|vendor\b/.test(targetText)) {
      return INDESIGN_COMMANDS.filter((cmd) => ['id-proof-pdf', 'id-export-page-range', 'id-export-preset', 'id-package-handoff', 'id-preflight', 'id-package', 'id-output-preview'].includes(cmd.id));
    }
    if (/\bbanner|display ad|creative|campaign|object layer options|placed psd|layer comp|variable\b/.test(targetText)) {
      return INDESIGN_COMMANDS.filter((cmd) => [
        'id-new-banner-doc',
        'id-banner-workspace',
        'id-object-layer-options',
        'id-banner-text',
        'id-dealer-disclaimer',
        'id-banner-asset',
        'id-variable-banners',
        'id-banner-export',
        'id-banner-alt-layout',
        'id-create-layer',
        'id-create-guides',
      ].includes(cmd.id));
    }
    if (targetText.includes('place')) {
      return INDESIGN_COMMANDS.filter((cmd) => ['id-fit-content', 'id-text-wrap', 'id-generative-expand', 'id-object-layer-options', 'id-relink-asset', 'id-alt-text', 'id-preflight'].includes(cmd.id));
    }
    if (targetText.includes('data merge')) {
      return INDESIGN_COMMANDS.filter((cmd) => ['id-data-merge-source', 'id-create-merged-document', 'id-data-merge', 'id-variable-banners', 'id-banner-workspace', 'id-preflight', 'id-export-pdf'].includes(cmd.id));
    }
    if (/\bgroup|ungroup|lock|unlock|hide layer|show layer\b/.test(targetText)) {
      return INDESIGN_COMMANDS.filter((cmd) => ['id-group-selection', 'id-lock-layer', 'id-create-layer', 'id-banner-workspace', 'id-preflight'].includes(cmd.id));
    }
    if (targetText.includes('open indesign') || targetText.includes('launch indesign')) {
      return INDESIGN_COMMANDS.filter((cmd) => ['id-indesign-open-file', 'id-banner-workspace', 'id-text-to-image', 'id-place', 'id-resize-banner', 'id-proof-pdf', 'id-brochure-layout', 'id-export-pdf'].includes(cmd.id));
    }
    return INDESIGN_COMMANDS.filter((cmd) => ['id-generative-fill', 'id-alt-text', 'id-preflight', 'id-export-pdf'].includes(cmd.id));
  }

  if (/\bfinder|spotlight|mission control|system settings|screenshot\b/i.test(targetText)) {
    return MAC_COMMANDS.filter((cmd) => ['mac-spotlight', 'mac-mission-control', 'mac-finder-downloads', 'mac-system-settings'].includes(cmd.id));
  }

  if (/\bgmail|email|emails|mailbox|inbox\b/i.test(targetText)) {
    if (/\bcompose|draft|write|send\b/i.test(targetText)) {
      return GMAIL_COMMANDS.filter((cmd) => ['gmail-compose', 'gmail-drafts', 'gmail-sent'].includes(cmd.id));
    }
    if (/\bsearch|find\b/i.test(targetText)) {
      return GMAIL_COMMANDS.filter((cmd) => ['gmail-search', 'gmail-inbox', 'gmail-drafts'].includes(cmd.id));
    }
    return GMAIL_COMMANDS.filter((cmd) => ['gmail-inbox', 'gmail-compose', 'gmail-search'].includes(cmd.id));
  }

  if (/\bwordpress|wp-admin|\bwp\b|cms|blog\b/i.test(targetText)) {
    if (/\bnew post|post editor|create\b/i.test(targetText)) {
      return WORDPRESS_COMMANDS.filter((cmd) => ['wp-new-post', 'wp-draft', 'wp-media'].includes(cmd.id));
    }
    if (/\bstatus|credential|connected\b/i.test(targetText)) {
      return WORDPRESS_COMMANDS.filter((cmd) => ['wp-status', 'wp-open-admin', 'wp-list'].includes(cmd.id));
    }
    return WORDPRESS_COMMANDS.filter((cmd) => ['wp-open-admin', 'wp-new-post', 'wp-draft', 'wp-list'].includes(cmd.id));
  }

  return [];
}

export function getPredictiveChatCommands(input: string, opts?: { limit?: number }): PredictiveChatCommand[] {
  const limit = Math.max(1, Math.min(8, opts?.limit || 5));
  const raw = String(input || '');
  const trimmed = raw.trim();
  if (trimmed.startsWith('/')) return [];

  const query = normalize(trimmed);
  const inferredApp = inferApp(trimmed);
  const nextSteps = nextStepCommands(trimmed);
  const nextIds = new Set(nextSteps.map((cmd) => cmd.id));
  const ranked = ALL_COMMANDS
    .map((seed) => ({
      seed,
      score: commandScore(seed, query, inferredApp) + (nextIds.has(seed.id) ? 55 : 0),
      source: nextIds.has(seed.id) ? 'next_step' as const : query ? 'match' as const : 'starter' as const,
    }))
    .filter(({ seed, score }) => {
      if (!query) return seed.app !== 'General' || seed.priority >= 80;
      if (inferredApp && seed.app !== inferredApp && seed.app !== 'General') return score >= 75;
      return score >= 72;
    })
    .sort((a, b) => {
      const aNext = a.source === 'next_step' ? 1 : 0;
      const bNext = b.source === 'next_step' ? 1 : 0;
      return bNext - aNext || b.score - a.score || a.seed.label.localeCompare(b.seed.label);
    });

  const seen = new Set<string>();
  const out: PredictiveChatCommand[] = [];
  for (const { seed, source } of ranked) {
    if (seen.has(seed.id)) continue;
    seen.add(seed.id);
    out.push({
      id: seed.id,
      label: seed.label,
      text: seed.text,
      hint: seed.hint,
      app: seed.app,
      color: seed.color,
      source,
    });
    if (out.length >= limit) break;
  }
  return out;
}
