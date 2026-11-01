const bytes = value => new TextEncoder().encode(value).length;
const short = (value, maximum) => typeof value === 'string' && value.length <= maximum;
const version = value => typeof value === 'string' && /^[a-f0-9]{12}$/.test(value);
function origin(value) {
  if (value == null) return undefined;
  if (!short(value.author, 320) || !value.author.trim() || !short(value.title, 640) || !value.title.trim() || !version(value.version)) throw Error('来源格式不完整。');
  const result = {author: value.author, title: value.title, version: value.version};
  if (value.sourceURL != null) {
    if (!short(value.sourceURL, 2048)) throw Error('来源链接过长。');
    const url = new URL(value.sourceURL);
    if (url.protocol !== 'https:' || url.username || url.password) throw Error('来源链接不受支持。');
    result.sourceURL = value.sourceURL;
  }
  return result;
}
export async function validateSnapshot(value) {
  if (value?.format !== 'commandsssh.note' || value.formatVersion !== 1) throw Error('不支持的笔记格式。');
  if (!short(value.title, 640) || !value.title.trim() || !short(value.body, 204800) || bytes(value.body) > 204800 ||
      !short(value.author, 320) || !value.author.trim() || !version(value.version) || !Array.isArray(value.tags) || value.tags.length > 12 ||
      value.tags.some(tag => !short(tag, 160) || !tag) || (value.commandID != null && (!short(value.commandID, 256) || bytes(value.commandID) > 256))) throw Error('笔记内容格式不完整。');
  const content = {body: value.body};
  if (value.commandID != null) content.commandID = value.commandID;
  content.tags = value.tags; content.title = value.title;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(content)));
  const actual = [...new Uint8Array(digest).slice(0, 6)].map(n => n.toString(16).padStart(2, '0')).join('');
  if (actual !== value.version) throw Error('内容版本不匹配，暂不展示此副本。');
  const result = {format: value.format, formatVersion: 1, title: value.title, body: value.body, tags: value.tags,
    author: value.author, version: value.version};
  if (value.commandID != null) result.commandID = value.commandID;
  const credit = origin(value.origin); if (credit) result.origin = credit;
  return result;
}
export function publicPayload(record) {
  if (record?.recordType !== 'CommandsSSHPublicNoteV1' || record?.fields?.visibility?.value !== 'public') return null;
  const payload = record.fields?.payload?.value;
  if (typeof payload !== 'string' || bytes(payload) > 524288) throw Error('公开笔记超过支持范围。');
  return JSON.parse(payload);
}
export function publicID(fragment) {
  const id = fragment.replace(/^#/, '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw Error('分享链接不完整。');
  return id.toUpperCase();
}

export function readerEndpoint(settings, pageURL) {
  if (settings?.enabled !== true) throw Error('公开阅读服务尚未启用，当前不能读取线上笔记。');
  const path = {development:'/commandsssh-support/shared-notes-dev/notes.html',production:'/commandsssh-support/shared-notes/notes.html'}[settings.environment];
  const page = new URL(pageURL);
  if (!path || page.protocol !== 'https:' || page.hostname !== 'maycrow.github.io' || page.port || page.username || page.password || page.pathname !== path || page.search ||
      settings.container !== 'iCloud.com.maycrow.commandsssh' || typeof settings.apiToken !== 'string' || !settings.apiToken.trim() || settings.apiToken.length > 2048 || /[\u0000-\u001f\u007f]/.test(settings.apiToken)) {
    throw Error('共享环境与阅读页配置不一致，已停止读取。');
  }
  return `https://api.apple-cloudkit.com/database/1/${settings.container}/${settings.environment}/public/records/lookup?ckAPIToken=${encodeURIComponent(settings.apiToken)}`;
}
