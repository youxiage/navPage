import { createSessionToken, normalizeHttpUrl, secretsEqual, verifySessionToken } from './security.js';

const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: HEADERS });
}

async function readJson(request) {
  if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    throw new HttpError(415, '请求必须使用 JSON 格式');
  }
  try { return await request.json(); } catch { throw new HttpError(400, 'JSON 内容无效'); }
}

function requireText(value, label, maxLength) {
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, `${label}不能为空`);
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new HttpError(400, `${label}内容过长`);
  return normalized;
}

function optionalText(value, label, maxLength) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > maxLength) throw new HttpError(400, `${label}格式不正确`);
  return value.trim() || null;
}

function integer(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function parseOrderedIds(value) {
  if (!Array.isArray(value) || value.length > 500) throw new HttpError(400, '排序数据格式不正确');
  const ids = value.map(Number);
  if (ids.some((id) => !Number.isInteger(id) || id <= 0) || new Set(ids).size !== ids.length) {
    throw new HttpError(400, '排序数据包含无效 ID');
  }
  return ids;
}

async function isAdmin(request, env) {
  const header = request.headers.get('authorization');
  return header?.startsWith('Bearer ') ? verifySessionToken(header.slice(7), env.JWT_SECRET) : false;
}

async function requireAdmin(request, env) {
  if (!await isAdmin(request, env)) throw new HttpError(401, '需要管理员权限');
}

function validateSameOrigin(request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) throw new HttpError(403, '不允许跨站请求');
}

async function handleLogin(request, env) {
  if (request.method !== 'POST') throw new HttpError(405, '方法不允许');
  validateSameOrigin(request);
  const clientKey = request.headers.get('cf-connecting-ip') || 'unknown';
  const rateLimit = await env.LOGIN_RATE_LIMITER.limit({ key: clientKey });
  if (!rateLimit.success) throw new HttpError(429, '登录尝试过于频繁，请稍后再试');
  const { password } = await readJson(request);
  if (typeof password !== 'string' || !await secretsEqual(password, env.ADMIN_PASSWORD)) throw new HttpError(401, '密码错误');
  return json({ token: await createSessionToken(env.JWT_SECRET) });
}

async function handleGroups(request, env, url) {
  const id = Number(url.pathname.match(/^\/api\/groups\/(\d+)$/)?.[1] || 0);
  if (request.method === 'GET' && url.pathname === '/api/groups') {
    const query = await isAdmin(request, env)
      ? 'SELECT * FROM Groups ORDER BY order_num ASC, id ASC'
      : 'SELECT * FROM Groups WHERE is_private = FALSE ORDER BY order_num ASC, id ASC';
    return json((await env.DB.prepare(query).all()).results);
  }
  validateSameOrigin(request);
  await requireAdmin(request, env);
  if (request.method === 'POST' && url.pathname === '/api/groups/reorder') {
    const ids = parseOrderedIds((await readJson(request)).ids);
    const existingIds = (await env.DB.prepare('SELECT id FROM Groups ORDER BY order_num ASC, id ASC').all()).results.map((group) => group.id);
    if (ids.length !== existingIds.length || existingIds.some((id) => !ids.includes(id))) {
      throw new HttpError(400, '分组排序数据与现有分组不一致');
    }
    if (ids.length) {
      await env.DB.batch(ids.map((id, index) => env.DB.prepare('UPDATE Groups SET order_num = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(index + 1, id)));
    }
    return json({ success: true });
  }
  if (request.method === 'POST' && url.pathname === '/api/groups') {
    const body = await readJson(request);
    const name = requireText(body.name, '分组名称', 80);
    const order = integer(body.order_num);
    const isPrivate = Boolean(body.is_private);
    const result = await env.DB.prepare('INSERT INTO Groups (name, order_num, is_private) VALUES (?, ?, ?)')
      .bind(name, order, isPrivate ? 1 : 0).run();
    return json({ id: result.meta.last_row_id, name, order_num: order, is_private: isPrivate }, 201);
  }
  if (!id) throw new HttpError(400, '缺少有效的分组 ID');
  if (request.method === 'PUT') {
    const body = await readJson(request);
    const name = requireText(body.name, '分组名称', 80);
    const order = integer(body.order_num);
    const isPrivate = Boolean(body.is_private);
    const result = await env.DB.prepare('UPDATE Groups SET name = ?, order_num = ?, is_private = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(name, order, isPrivate ? 1 : 0, id).run();
    if (!result.meta.changes) throw new HttpError(404, '分组不存在');
    return json({ id, name, order_num: order, is_private: isPrivate });
  }
  if (request.method === 'DELETE') {
    const group = await env.DB.prepare('SELECT order_num FROM Groups WHERE id = ?').bind(id).first();
    if (!group) throw new HttpError(404, '分组不存在');
    await env.DB.batch([
      env.DB.prepare('DELETE FROM Links WHERE group_id = ?').bind(id),
      env.DB.prepare('DELETE FROM Groups WHERE id = ?').bind(id),
      env.DB.prepare('UPDATE Groups SET order_num = order_num - 1 WHERE order_num > ?').bind(group.order_num),
    ]);
    return json({ success: true });
  }
  throw new HttpError(405, '方法不允许');
}

function parseLink(body) {
  let url;
  let logo = null;
  try {
    url = normalizeHttpUrl(body.url);
    if (body.logo) logo = normalizeHttpUrl(body.logo);
  } catch (error) { throw new HttpError(400, error.message); }
  const groupId = integer(body.group_id, NaN);
  if (!Number.isInteger(groupId) || groupId <= 0) throw new HttpError(400, '请选择有效分组');
  return {
    name: requireText(body.name, '链接名称', 120), url, logo,
    description: optionalText(body.description, '链接描述', 500),
    groupId, order: integer(body.order_num),
  };
}

async function handleLinks(request, env, url) {
  const id = Number(url.pathname.match(/^\/api\/links\/(\d+)$/)?.[1] || 0);
  if (request.method === 'GET' && url.pathname === '/api/links') {
    const conditions = await isAdmin(request, env) ? [] : ['Groups.is_private = FALSE'];
    const bindings = [];
    if (url.searchParams.has('group_id')) {
      conditions.push('Links.group_id = ?');
      bindings.push(integer(url.searchParams.get('group_id'), -1));
    }
    let query = 'SELECT Links.*, Groups.name AS group_name FROM Links LEFT JOIN Groups ON Links.group_id = Groups.id';
    if (conditions.length) query += ` WHERE ${conditions.join(' AND ')}`;
    query += ' ORDER BY Links.order_num ASC, Links.id ASC';
    return json((await env.DB.prepare(query).bind(...bindings).all()).results);
  }
  validateSameOrigin(request);
  await requireAdmin(request, env);
  if (request.method === 'POST' && url.pathname === '/api/links/reorder') {
    const body = await readJson(request);
    const groupId = integer(body.group_id, NaN);
    const ids = parseOrderedIds(body.ids);
    if (!Number.isInteger(groupId) || groupId <= 0) throw new HttpError(400, '缺少有效的分组 ID');
    const existingIds = (await env.DB.prepare('SELECT id FROM Links WHERE group_id = ? ORDER BY order_num ASC, id ASC').bind(groupId).all()).results.map((link) => link.id);
    if (ids.length !== existingIds.length || existingIds.some((id) => !ids.includes(id))) {
      throw new HttpError(400, '链接排序数据与当前分组不一致');
    }
    if (ids.length) {
      await env.DB.batch(ids.map((id, index) => env.DB.prepare('UPDATE Links SET order_num = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND group_id = ?').bind(index + 1, id, groupId)));
    }
    return json({ success: true });
  }
  if (request.method === 'POST' && url.pathname === '/api/links') {
    const link = parseLink(await readJson(request));
    if (!await env.DB.prepare('SELECT id FROM Groups WHERE id = ?').bind(link.groupId).first()) throw new HttpError(400, '所选分组不存在');
    if (!link.order) {
      const maximum = await env.DB.prepare('SELECT COALESCE(MAX(order_num), 0) AS value FROM Links WHERE group_id = ?').bind(link.groupId).first();
      link.order = Number(maximum.value) + 1;
    }
    const result = await env.DB.prepare('INSERT INTO Links (name, url, logo, description, group_id, order_num) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(link.name, link.url, link.logo, link.description, link.groupId, link.order).run();
    return json({ id: result.meta.last_row_id, name: link.name, url: link.url, logo: link.logo, description: link.description, group_id: link.groupId, order_num: link.order }, 201);
  }
  if (!id) throw new HttpError(400, '缺少有效的链接 ID');
  if (request.method === 'PUT') {
    const link = parseLink(await readJson(request));
    const result = await env.DB.prepare('UPDATE Links SET name = ?, url = ?, logo = ?, description = ?, group_id = ?, order_num = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(link.name, link.url, link.logo, link.description, link.groupId, link.order, id).run();
    if (!result.meta.changes) throw new HttpError(404, '链接不存在');
    return json({ id, name: link.name, url: link.url, logo: link.logo, description: link.description, group_id: link.groupId, order_num: link.order });
  }
  if (request.method === 'DELETE') {
    const result = await env.DB.prepare('DELETE FROM Links WHERE id = ?').bind(id).run();
    if (!result.meta.changes) throw new HttpError(404, '链接不存在');
    return json({ success: true });
  }
  throw new HttpError(405, '方法不允许');
}

function decodeHtmlText(value) {
  return value.replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#(?:0*39|x0*27);/gi, "'").replace(/\s+/g, ' ').trim();
}

async function readLimitedText(response, limit = 256 * 1024) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) { await reader.cancel(); throw new HttpError(413, '网页内容过大'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

async function fetchWebsiteInfo(inputUrl) {
  let target;
  try { target = normalizeHttpUrl(inputUrl, { blockPrivate: true }); }
  catch (error) { throw new HttpError(400, error.message); }
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const response = await fetch(target, { redirect: 'manual', headers: { Accept: 'text/html,application/xhtml+xml' }, signal: AbortSignal.timeout(6000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location || redirects === 3) throw new HttpError(400, '网页重定向次数过多');
      try { target = normalizeHttpUrl(new URL(location, target).toString(), { blockPrivate: true }); }
      catch (error) { throw new HttpError(400, error.message); }
      continue;
    }
    if (!response.ok) throw new HttpError(400, '目标网页无法访问');
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) throw new HttpError(400, '目标地址不是网页');
    const html = await readLimitedText(response);
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '';
    const description = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i)?.[1]
      || html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["'][^>]*>/i)?.[1] || '';
    return { title: decodeHtmlText(title).slice(0, 120), description: decodeHtmlText(description).slice(0, 500) };
  }
  throw new HttpError(400, '无法获取网页信息');
}

async function handleFetchInfo(request, env) {
  if (request.method !== 'POST') throw new HttpError(405, '方法不允许');
  validateSameOrigin(request);
  await requireAdmin(request, env);
  return json(await fetchWebsiteInfo((await readJson(request)).url));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/login') return await handleLogin(request, env);
      if (url.pathname === '/api/verify') {
        if (request.method !== 'GET') throw new HttpError(405, '方法不允许');
        await requireAdmin(request, env);
        return json({ valid: true });
      }
      if (url.pathname === '/api/fetch-info') return await handleFetchInfo(request, env);
      if (url.pathname === '/api/groups' || url.pathname.startsWith('/api/groups/')) return await handleGroups(request, env, url);
      if (url.pathname === '/api/links' || url.pathname.startsWith('/api/links/')) return await handleLinks(request, env, url);
      return json({ error: '接口不存在' }, 404);
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      console.error(JSON.stringify({ event: 'request_error', path: url.pathname, message: error.message }));
      return json({ error: '服务暂时不可用' }, 500);
    }
  },
};
