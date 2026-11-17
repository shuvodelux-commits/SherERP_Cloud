#!/usr/bin/env node
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

// M01 original-source-preserving accessibility patch, compiled HTML only.
// Refuse unexpected upstream markup/function boundaries instead of silently
// altering an unreviewed source or changing public RPC/auth behavior.
function replaceOnce(html,original,revised,label){
  const oldCount=html.split(original).length-1;
  const newCount=html.split(revised).length-1;
  if(oldCount===0&&newCount===1)return html;
  if(oldCount!==1||newCount!==0)
    throw new Error('Compiled M01 '+label+' boundary missing or ambiguous');
  return html.replace(original,revised);
}

const OPEN_ORIGINAL=[
  '    sheet.hidden = false;',
  "    document.body.classList.add('mobile-sheet-open');",
  "    syncMobileNavigation_('more');",
  '  }',
  '',
  '  function closeMobileMore_() {'
].join('\n');
const OPEN_PATCHED=[
  '    sheet.hidden = false;',
  "    document.body.classList.add('mobile-sheet-open');",
  "    syncMobileNavigation_('more');",
  "    var closeButton = sheet.querySelector('.mobile-sheet-close');",
  '    if (closeButton) closeButton.focus();',
  '  }',
  '',
  '  function closeMobileMore_() {'
].join('\n');
const CLOSE_ORIGINAL=[
  "  function closeMobileMore_() {",
  "    var sheet = document.getElementById('mobileMoreSheet');",
  '    if (sheet) sheet.hidden = true;',
  "    document.body.classList.remove('mobile-sheet-open');",
  '    syncMobileNavigation_(currentPage);',
  '  }'
].join('\n');
const CLOSE_PATCHED=[
  "  function closeMobileMore_() {",
  "    var sheet = document.getElementById('mobileMoreSheet');",
  '    var wasOpen = !!sheet && !sheet.hidden;',
  '    if (sheet) sheet.hidden = true;',
  "    document.body.classList.remove('mobile-sheet-open');",
  '    syncMobileNavigation_(currentPage);',
  '    if (wasOpen) {',
  '      var opener = document.querySelector(\'#mobileBottomNav [data-mobile-page="more"]\');',
  '      if (opener && opener.getClientRects().length) opener.focus();',
  '    }',
  '  }'
].join('\n');
const KEY_ORIGINAL="      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMobileMore_(); });";
const KEY_PATCHED=KEY_ORIGINAL+`\n      // Keyboard modal scope: no Tab navigation into underlying ERP controls.
      document.addEventListener('keydown', function (event) {
        if (event.key !== 'Tab') return;
        var sheet = document.getElementById('mobileMoreSheet');
        if (!sheet || sheet.hidden) return;
        var dialog = sheet.querySelector('[role="dialog"][aria-modal="true"]');
        if (!dialog) return;
        var focusable = Array.prototype.filter.call(
          dialog.querySelectorAll('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'),
          function (el) { return el.getClientRects().length > 0; }
        );
        if (!focusable.length) return;
        var first = focusable[0];
        var last = focusable[focusable.length - 1];
        if (!dialog.contains(document.activeElement)) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      });`;

export function patchM01Accessibility(html){
  if(typeof html!=='string')throw new TypeError('Missing compiled original UI');
  let patched=html;
  patched=replaceOnce(patched,
    '<!DOCTYPE html>\n<html>\n<head>',
    '<!DOCTYPE html>\n<html lang="en">\n<head>',
    'document language');
  patched=replaceOnce(patched,
    '<head>\n  <base target="_top">',
    '<head>\n  <title>Hardware Store ERP</title>\n  <base target="_top">',
    'document title');
  patched=replaceOnce(patched,
    '    <label>Mobile Number</label>\n    <input id="loginMobile"',
    '    <label for="loginMobile">Mobile Number</label>\n    <input id="loginMobile"',
    'phone label');
  patched=replaceOnce(patched,
    '    <label>Password</label>\n    <div class="login-password-row">',
    '    <label for="loginPassword">Password</label>\n    <div class="login-password-row">',
    'password label');
  patched=replaceOnce(patched,OPEN_ORIGINAL,OPEN_PATCHED,'More focus entry');
  patched=replaceOnce(patched,CLOSE_ORIGINAL,CLOSE_PATCHED,'More focus restoration');
  patched=replaceOnce(patched,KEY_ORIGINAL,KEY_PATCHED,'More Tab trap');
  return patched;
}

if(process.argv[1] && resolve(process.argv[1])===new URL(import.meta.url).pathname){
  const file=process.argv[2]||'dist/index.html';
  try{
    const original=await readFile(file,'utf8');
    await writeFile(file,patchM01Accessibility(original),'utf8');
    console.log('M01 compiled accessibility patch applied: '+file);
  }catch(error){
    console.error('M01 accessibility patch refused: '+error.message);
    process.exitCode=1;
  }
}
