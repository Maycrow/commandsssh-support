import {config} from './config.mjs';
import {validateSnapshot, publicPayload, publicID, readerEndpoint} from './note-format.mjs';
const $ = id => document.getElementById(id);
let downloadURL;
let epoch = 0; let activeRequest;
export function clearReading(message) {
  if (downloadURL) { URL.revokeObjectURL(downloadURL); downloadURL = undefined; }
  document.title = '共享笔记 · CommandsSSH';
  $('note').hidden = true; $('body').replaceChildren(); $('title').textContent = '';
  $('credit').textContent = ''; $('tags').textContent = ''; $('author').textContent = '';
  $('download').removeAttribute('href'); $('open-app').removeAttribute('href');
  $('status').textContent = message; $('status').hidden = false;
}
export async function renderSnapshot(value, id, isCurrent = () => true) {
  const note = await validateSnapshot(value);
  if (!isCurrent()) return;
  document.title = note.title + ' · 共享笔记';
  $('title').textContent = note.title;
  $('author').textContent = `分享者 ${note.author} · 内容版本 ${note.version}`;
  $('tags').textContent = note.tags.map(t => '#' + t).join('  ');
  $('credit').textContent = note.origin ? `原始来源：${note.origin.author} · ${note.origin.title} · ${note.origin.version}` : '';
  const pre = document.createElement('pre'); pre.textContent = note.body; $('body').replaceChildren(pre);
  const blob = new Blob([JSON.stringify(note, null, 2)], {type: 'application/vnd.commandsssh.note+json'});
  if (downloadURL) URL.revokeObjectURL(downloadURL);
  downloadURL = URL.createObjectURL(blob);
  $('download').href = downloadURL; $('download').download = 'shared-note.csnote';
  $('open-app').href = 'commandsssh://shared-note/' + publicID(id);
  $('status').hidden = true; $('note').hidden = false;
}
async function boundedJSON(response) {
  if (!response.ok || !response.body) throw Error('无法读取公开内容，请稍后重试。');
  const reader = response.body.getReader(); const parts = []; let size = 0;
  try {
    for (;;) { const {value, done} = await reader.read(); if (done) break;
      size += value.length; if (size > 2097152) throw Error('返回内容过大。'); parts.push(value); }
  } finally { await reader.cancel().catch(() => {}); }
  const buffer = new Uint8Array(size); let offset = 0;
  for (const part of parts) { buffer.set(part, offset); offset += part.length; }
  return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(buffer));
}
export async function loadPublicNote() {
  const request = ++epoch; activeRequest?.abort(); activeRequest = new AbortController();
  const signal = activeRequest.signal;
  clearReading('正在读取公开笔记…');
  try {
    const id = publicID(location.hash);
    const url = readerEndpoint(config, location.href);
    const response = await fetch(url, {signal, method: 'POST', headers: {'Content-Type': 'text/plain'}, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
      body: JSON.stringify({records: [{recordName: 'note-' + id}]})});
    const result = await boundedJSON(response);
    if (!Array.isArray(result.records) || result.records.length !== 1) throw Error('未能确认公开状态，请检查链接或稍后重试。');
    if (epoch !== request) return;
    const record = result.records[0];
    if (record.serverErrorCode && !['NOT_FOUND', 'UNKNOWN_ITEM'].includes(record.serverErrorCode)) throw Error('读取失败，暂时无法确认公开状态。');
    const snapshot = publicPayload(record);
    if (!snapshot) { clearReading('此笔记未公开、已撤回，或链接已失效。'); return; }
    await renderSnapshot(snapshot, id, () => epoch === request);
  } catch (error) { if (epoch === request) clearReading(error.message || '暂时无法读取。'); }
}
if (document.documentElement.dataset.mode !== 'synthetic-preview') {
  loadPublicNote(); window.addEventListener('hashchange', loadPublicNote);
  // Recheck when returning; a withdrawn note must not remain visible from an earlier in-page view.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') loadPublicNote();
    else { ++epoch; activeRequest?.abort(); clearReading('返回后将重新确认公开状态。'); }
  });
  window.addEventListener('pageshow', event => { if (event.persisted) loadPublicNote(); });
}
