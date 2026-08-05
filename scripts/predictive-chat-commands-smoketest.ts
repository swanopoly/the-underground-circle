import { getPredictiveChatCommands } from '../src/lib/predictiveChatCommands';

function assert(condition: unknown, label: string, detail?: string): void {
  if (!condition) {
    throw new Error(detail ? `${label}: ${detail}` : label);
  }
  console.log(`pass: ${label}`);
}

const photoshopSave = getPredictiveChatCommands('photoshop save', { limit: 4 });
assert(photoshopSave.some((cmd) => cmd.id === 'ps-save-web'), 'predictive: Photoshop save suggests Save for Web');
assert(photoshopSave.every((cmd) => cmd.app !== 'InDesign'), 'predictive: Photoshop query filters InDesign noise');

const photoshopNext = getPredictiveChatCommands('Open Photoshop and select subject', { limit: 4 });
assert(photoshopNext[0]?.source === 'next_step', 'predictive: Photoshop sequence produces next-step suggestions');
assert(photoshopNext.some((cmd) => cmd.id === 'ps-remove-bg'), 'predictive: select subject suggests remove background');
assert(photoshopNext.some((cmd) => cmd.id === 'ps-replace-bg'), 'predictive: select subject suggests AI background replacement');

const photoshopAiEdit = getPredictiveChatCommands('photoshop ai edit image', { limit: 5 });
assert(photoshopAiEdit.some((cmd) => cmd.id === 'ps-ai-edit'), 'predictive: Photoshop AI edit suggests AI edit macro');
assert(photoshopAiEdit.some((cmd) => cmd.id === 'ps-generative-fill'), 'predictive: Photoshop AI edit keeps Generative Fill available');

const photoshopSelectionFill = getPredictiveChatCommands('photoshop highlighted area generative fill', { limit: 5 });
assert(photoshopSelectionFill.some((cmd) => cmd.id === 'ps-fill-selection'), 'predictive: Photoshop highlighted area suggests selection fill macro');
assert(photoshopSelectionFill.some((cmd) => cmd.id === 'ps-remove-selection'), 'predictive: Photoshop highlighted area suggests remove-selection macro');

const photoshopBoxFill = getPredictiveChatCommands('photoshop rectangular selection coordinates generative fill', { limit: 5 });
assert(photoshopBoxFill.some((cmd) => cmd.id === 'ps-box-fill'), 'predictive: Photoshop coordinate selection suggests box fill macro');

const photoshopSelectionBrush = getPredictiveChatCommands('photoshop selection brush generative fill', { limit: 5 });
assert(photoshopSelectionBrush.some((cmd) => cmd.id === 'ps-selection-brush'), 'predictive: Photoshop selection brush suggests brush prep macro');
assert(photoshopSelectionBrush.some((cmd) => cmd.id === 'ps-brush-fill'), 'predictive: Photoshop selection brush suggests brush fill macro');

const photoshopSocial = getPredictiveChatCommands('photoshop instagram canvas', { limit: 5 });
assert(photoshopSocial.some((cmd) => cmd.id === 'ps-social-canvas'), 'predictive: Photoshop social canvas suggests preset canvas macro');

const indesignPdf = getPredictiveChatCommands('indesign export pdf', { limit: 4 });
assert(indesignPdf.some((cmd) => cmd.id === 'id-export-pdf'), 'predictive: InDesign export suggests PDF export');
assert(indesignPdf.every((cmd) => cmd.app !== 'Photoshop'), 'predictive: InDesign query filters Photoshop noise');

const indesignNext = getPredictiveChatCommands('Open InDesign and place ~/Desktop/logo.png', { limit: 4 });
assert(indesignNext[0]?.source === 'next_step', 'predictive: InDesign place produces next-step suggestions');
assert(indesignNext.some((cmd) => cmd.id === 'id-fit-content'), 'predictive: place asset suggests fit content');
assert(indesignNext.some((cmd) => cmd.id === 'id-generative-expand'), 'predictive: place asset suggests generative expand');

const indesignAi = getPredictiveChatCommands('indesign text to image', { limit: 5 });
assert(indesignAi.some((cmd) => cmd.id === 'id-text-to-image'), 'predictive: InDesign Text to Image suggests Firefly macro');
assert(indesignAi.every((cmd) => cmd.app !== 'Photoshop'), 'predictive: explicit InDesign AI query filters Photoshop noise');

const indesignAccessible = getPredictiveChatCommands('indesign accessible pdf alt text', { limit: 5 });
assert(indesignAccessible.some((cmd) => cmd.id === 'id-alt-text'), 'predictive: InDesign accessibility suggests alt text macro');
assert(indesignAccessible.some((cmd) => cmd.id === 'id-accessible-pdf'), 'predictive: InDesign accessibility suggests accessible PDF prep');

const macFinder = getPredictiveChatCommands('finder downloads', { limit: 4 });
assert(macFinder.some((cmd) => cmd.id === 'mac-finder-downloads'), 'predictive: Finder query suggests Downloads macro');

const macSettings = getPredictiveChatCommands('system settings accessibility', { limit: 4 });
assert(macSettings.some((cmd) => cmd.id === 'mac-system-settings'), 'predictive: System Settings query suggests Accessibility macro');

const photoshopLayers = getPredictiveChatCommands('photoshop export layers', { limit: 4 });
assert(photoshopLayers.some((cmd) => cmd.id === 'ps-export-layers'), 'predictive: Photoshop export layers suggests layer export macro');

const indesignDataMerge = getPredictiveChatCommands('indesign data merge', { limit: 4 });
assert(indesignDataMerge.some((cmd) => cmd.id === 'id-data-merge'), 'predictive: InDesign data merge suggests panel macro');
assert(indesignDataMerge.some((cmd) => cmd.id === 'id-data-merge-source'), 'predictive: InDesign data merge suggests source macro');

const indesignBanner = getPredictiveChatCommands('indesign banner layers', { limit: 6 });
assert(indesignBanner.some((cmd) => cmd.id === 'id-banner-workspace'), 'predictive: InDesign banner layers suggests banner workspace');
assert(indesignBanner.some((cmd) => cmd.id === 'id-object-layer-options'), 'predictive: InDesign banner layers suggests object layer options');

const indesignBannerText = getPredictiveChatCommands('indesign banner headline cta', { limit: 6 });
assert(indesignBannerText.some((cmd) => cmd.id === 'id-banner-text'), 'predictive: InDesign banner headline suggests banner text macro');
assert(indesignBannerText.some((cmd) => cmd.id === 'id-variable-banners'), 'predictive: InDesign banner headline keeps variable banner workflow available');

const indesignBannerAsset = getPredictiveChatCommands('indesign replace banner image', { limit: 6 });
assert(indesignBannerAsset.some((cmd) => cmd.id === 'id-banner-asset'), 'predictive: InDesign replace banner image suggests asset replacement macro');
assert(indesignBannerAsset.some((cmd) => cmd.id === 'id-banner-export'), 'predictive: InDesign replace banner image suggests export follow-up');

const indesignRelink = getPredictiveChatCommands('indesign relink missing image', { limit: 6 });
assert(indesignRelink.some((cmd) => cmd.id === 'id-relink-asset'), 'predictive: InDesign relink suggests relink macro');
assert(indesignRelink.some((cmd) => cmd.id === 'id-preflight' || cmd.id === 'id-package-handoff'), 'predictive: InDesign relink keeps production checks nearby');

const indesignResize = getPredictiveChatCommands('indesign resize banner 300x250 align', { limit: 6 });
assert(indesignResize.some((cmd) => cmd.id === 'id-resize-banner'), 'predictive: InDesign resize suggests transform macro');
assert(indesignResize.some((cmd) => cmd.id === 'id-align-center'), 'predictive: InDesign resize suggests align follow-up');

const indesignProof = getPredictiveChatCommands('indesign proof handoff package', { limit: 6 });
assert(indesignProof.some((cmd) => cmd.id === 'id-proof-pdf'), 'predictive: InDesign proof suggests proof PDF macro');
assert(indesignProof.some((cmd) => cmd.id === 'id-package-handoff'), 'predictive: InDesign proof suggests handoff package macro');
assert(indesignProof.some((cmd) => cmd.id === 'id-export-page-range'), 'predictive: InDesign proof suggests page range export macro');

const indesignLinks = getPredictiveChatCommands('indesign update links edit original', { limit: 6 });
assert(indesignLinks.some((cmd) => cmd.id === 'id-update-links'), 'predictive: InDesign links suggests update links macro');
assert(indesignLinks.some((cmd) => cmd.id === 'id-relink-asset'), 'predictive: InDesign links keeps relink macro nearby');

const indesignObjectOps = getPredictiveChatCommands('indesign group selected objects lock layer', { limit: 6 });
assert(indesignObjectOps.some((cmd) => cmd.id === 'id-group-selection'), 'predictive: InDesign object ops suggests group macro');
assert(indesignObjectOps.some((cmd) => cmd.id === 'id-lock-layer'), 'predictive: InDesign object ops suggests layer macro');

const indesignDocumentSetup = getPredictiveChatCommands('indesign document setup bleed margins 300x250', { limit: 8 });
assert(indesignDocumentSetup.some((cmd) => cmd.id === 'id-new-banner-doc'), 'predictive: InDesign document setup suggests sized banner doc');
assert(indesignDocumentSetup.some((cmd) => cmd.id === 'id-document-setup'), 'predictive: InDesign document setup suggests bleed/margins macro');

const indesignBrandColor = getPredictiveChatCommands('indesign create swatch brand color', { limit: 6 });
assert(indesignBrandColor.some((cmd) => cmd.id === 'id-create-swatch'), 'predictive: InDesign brand color suggests create swatch');

const indesignLayoutHelpers = getPredictiveChatCommands('indesign text wrap parent page guide grid', { limit: 8 });
assert(indesignLayoutHelpers.some((cmd) => cmd.id === 'id-text-wrap'), 'predictive: InDesign layout helpers suggest text wrap');
assert(indesignLayoutHelpers.some((cmd) => cmd.id === 'id-parent-pages'), 'predictive: InDesign layout helpers suggest parent pages');
assert(indesignLayoutHelpers.some((cmd) => cmd.id === 'id-create-guides'), 'predictive: InDesign layout helpers suggest guide grid');

const indesignPdfPreset = getPredictiveChatCommands('indesign export pdf preset dealer proof', { limit: 8 });
assert(indesignPdfPreset.some((cmd) => cmd.id === 'id-export-preset'), 'predictive: InDesign proof suggests named PDF preset');

const dealerDisclaimer = getPredictiveChatCommands('change dealership disclaimer', { limit: 6 });
assert(dealerDisclaimer.some((cmd) => cmd.id === 'id-dealer-disclaimer'), 'predictive: dealership disclaimer suggests dealer disclaimer macro');
assert(dealerDisclaimer.some((cmd) => cmd.id === 'id-dealer-find-replace'), 'predictive: dealership disclaimer suggests exact find/replace macro');

const dealerOpenEdit = getPredictiveChatCommands('find dealer-banner.indd on desktop and change disclaimer', { limit: 8 });
assert(dealerOpenEdit.some((cmd) => cmd.id === 'id-dealer-open-edit'), 'predictive: referenced InDesign file suggests open + edit macro');
assert(dealerOpenEdit.some((cmd) => cmd.id === 'id-indesign-open-file'), 'predictive: referenced InDesign file suggests open file macro');

const dealerOffer = getPredictiveChatCommands('update dealer apr payment', { limit: 6 });
assert(dealerOffer.some((cmd) => cmd.id === 'id-dealer-apr'), 'predictive: dealer APR suggests APR macro');
assert(dealerOffer.some((cmd) => cmd.id === 'id-dealer-price'), 'predictive: dealer APR keeps price macro nearby');

const gmailCompose = getPredictiveChatCommands('gmail compose', { limit: 4 });
assert(gmailCompose.some((cmd) => cmd.id === 'gmail-compose'), 'predictive: Gmail compose suggests draft email macro');
assert(gmailCompose.every((cmd) => cmd.app !== 'Photoshop' && cmd.app !== 'InDesign'), 'predictive: Gmail query filters design-app noise');

const gmailSearch = getPredictiveChatCommands('search email invoice', { limit: 4 });
assert(gmailSearch.some((cmd) => cmd.id === 'gmail-search'), 'predictive: email search suggests Gmail search macro');

const wordpressPost = getPredictiveChatCommands('wordpress new post', { limit: 4 });
assert(wordpressPost.some((cmd) => cmd.id === 'wp-new-post'), 'predictive: WordPress new post suggests editor macro');
assert(wordpressPost.some((cmd) => cmd.id === 'wp-draft'), 'predictive: WordPress new post suggests API draft option');

const wordpressStatus = getPredictiveChatCommands('wp status', { limit: 4 });
assert(wordpressStatus.some((cmd) => cmd.id === 'wp-status'), 'predictive: WP status suggests connected-site status command');

const autocadFloorPlan = getPredictiveChatCommands('autocad floor plan dimensions', { limit: 5 });
assert(autocadFloorPlan.some((cmd) => cmd.id === 'eng-floor-plan'), 'predictive: AutoCAD floor plan suggests CAD drafting macro');
assert(autocadFloorPlan.every((cmd) => cmd.app !== 'Photoshop' && cmd.app !== 'InDesign'), 'predictive: AutoCAD query filters creative-app noise');

const fusionSketch = getPredictiveChatCommands('fusion 360 parametric sketch constraints', { limit: 5 });
assert(fusionSketch.some((cmd) => cmd.id === 'eng-parametric-sketch'), 'predictive: Fusion 360 suggests parametric sketch macro');
assert(fusionSketch.some((cmd) => cmd.id === 'eng-dimension-check'), 'predictive: Fusion 360 keeps measurement checkpoint nearby');

const cadExport = getPredictiveChatCommands('export cad drawing as dxf', { limit: 5 });
assert(cadExport.some((cmd) => cmd.id === 'eng-export-dxf'), 'predictive: CAD export suggests approval-gated DXF export');

const slash = getPredictiveChatCommands('/help', { limit: 4 });
assert(slash.length === 0, 'predictive: slash commands defer to slash palette');

console.log('\nAll predictive chat command smoke cases passed.');
