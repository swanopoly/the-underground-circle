import assert from 'node:assert/strict';
import {
  inferDesktopAppForAttachment,
  resolveDefaultDesktopAttachmentApp,
  resolveExplicitDesktopAttachmentApp,
} from '../src/lib/chatDesktopAttachmentRouting';

const pdf = { name: 'report.pdf', mimeType: 'application/pdf' };
const png = { name: 'image.png', mimeType: 'image/png' };
const docx = { name: 'draft.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
const xlsx = { name: 'budget.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };

assert.equal(resolveExplicitDesktopAttachmentApp('Open the attached PDF in Preview.'), 'Preview');
assert.equal(resolveExplicitDesktopAttachmentApp('Open this image using Preview.'), 'Preview');
assert.equal(resolveExplicitDesktopAttachmentApp('Open the attached document in Pages.'), 'Pages');
assert.equal(resolveExplicitDesktopAttachmentApp('Open the attached spreadsheet with Numbers.'), 'Numbers');
assert.equal(resolveExplicitDesktopAttachmentApp('Open the attached file in Preview and Pages.'), null);
assert.equal(resolveExplicitDesktopAttachmentApp('Preview the attached image.'), null);
assert.equal(resolveExplicitDesktopAttachmentApp('Open this in an arbitrary app.'), null);
assert.equal(resolveExplicitDesktopAttachmentApp('Open this with page numbers.'), null);
assert.equal(resolveExplicitDesktopAttachmentApp('Open this in a Preview helper.'), null);

assert.equal(inferDesktopAppForAttachment(pdf, 'Open the attached PDF in Preview.'), 'Preview');
assert.equal(inferDesktopAppForAttachment(png, 'Open this image using Preview.'), 'Preview');
assert.equal(inferDesktopAppForAttachment(docx, 'Open the attached document in Pages.'), 'Pages');
assert.equal(inferDesktopAppForAttachment(xlsx, 'Open the attached spreadsheet with Numbers.'), 'Numbers');

assert.equal(resolveDefaultDesktopAttachmentApp(pdf), 'Preview');
assert.equal(resolveDefaultDesktopAttachmentApp(png), 'Preview');
assert.equal(resolveDefaultDesktopAttachmentApp(docx), 'Microsoft Word');
assert.equal(resolveDefaultDesktopAttachmentApp(xlsx), 'Microsoft Excel');
assert.equal(inferDesktopAppForAttachment(pdf, 'Open the attached PDF.'), 'Preview');
assert.equal(inferDesktopAppForAttachment(png, 'Open this image.'), 'Preview');
assert.equal(inferDesktopAppForAttachment(docx, 'Open the attached document.'), 'Microsoft Word');
assert.equal(inferDesktopAppForAttachment(xlsx, 'Open the attached spreadsheet.'), 'Microsoft Excel');

console.log('Desktop attachment app identity smoke passed.');
