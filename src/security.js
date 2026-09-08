const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function importHmacKey(secret, usages) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, usages);
}

export async function createSessionToken(secret, ttlSeconds = 12 * 60 * 60) {
  const now = Math.floor(Date.now() / 1000);
  const header = toBase64Url(encoder.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const payload = toBase64Url(encoder.encode(JSON.stringify({ admin: true, iat: now, exp: now + ttlSeconds })));
  const data = `${header}.${payload}`;
  const key = await importHmacKey(secret, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  return `${data}.${toBase64Url(new Uint8Array(signature))}`;
}

export async function verifySessionToken(token, secret) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const [headerPart, payloadPart, signaturePart] = parts;
    const header = JSON.parse(decoder.decode(fromBase64Url(headerPart)));
    if (header.alg !== 'HS256' || header.typ !== 'JWT') return false;
    const key = await importHmacKey(secret, ['verify']);
    const valid = await crypto.subtle.verify(
      'HMAC', key, fromBase64Url(signaturePart), encoder.encode(`${headerPart}.${payloadPart}`),
    );
    if (!valid) return false;
    const payload = JSON.parse(decoder.decode(fromBase64Url(payloadPart)));
    const now = Math.floor(Date.now() / 1000);
    return payload.admin === true && Number.isInteger(payload.iat) && Number.isInteger(payload.exp)
      && payload.iat <= now + 30 && payload.exp > now;
  } catch {
    return false;
  }
}

export async function secretsEqual(left, right) {
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(left)),
    crypto.subtle.digest('SHA-256', encoder.encode(right)),
  ]);
  if (typeof crypto.subtle.timingSafeEqual === 'function') {
    return crypto.subtle.timingSafeEqual(leftHash, rightHash);
  }
  const leftBytes = new Uint8Array(leftHash);
  const rightBytes = new Uint8Array(rightHash);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

function isPrivateHostname(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true;
  if (host === '::' || host === '::1' || host.startsWith('fc') || host.startsWith('fd') || /^fe[89ab]/.test(host)) return true;
  const octets = host.split('.').map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;
  return octets[0] === 0 || octets[0] === 10 || octets[0] === 127
    || (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127)
    || (octets[0] === 169 && octets[1] === 254)
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168) || octets[0] >= 224;
}

export function normalizeHttpUrl(value, { blockPrivate = false } = {}) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('网址格式不正确');
  let url;
  try { url = new URL(value); } catch { throw new Error('网址格式不正确'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('只支持 HTTP 或 HTTPS 网址');
  }
  if (blockPrivate && isPrivateHostname(url.hostname)) throw new Error('不能访问本地或内部地址');
  return url.toString();
}
