/**
 * push.js — Web Push desde el Worker (sin dependencias externas)
 *
 * Implementa el envío de notificaciones push con:
 *   - Cifrado del contenido  "aes128gcm"  (RFC 8188 + RFC 8291)
 *   - Autenticación VAPID     (RFC 8292)   con JWT ES256
 *
 * Todo con la Web Crypto API que Cloudflare Workers ofrece de serie, así
 * que no hace falta ninguna librería de npm.
 *
 * Uso:
 *   await sendPush(subscription, { title, body, ... }, env)
 * donde `subscription` es el PushSubscription.toJSON() del navegador:
 *   { endpoint, keys: { p256dh, auth } }
 * y `env` contiene VAPID_PRIVATE_JWK (secreto) y VAPID_SUBJECT.
 */

const enc = new TextEncoder();
const { subtle } = crypto;

/* ---------- utilidades base64url ---------- */
export function b64urlToBytes(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function bytesToB64url(bytes) {
  let bin = "";
  const b = new Uint8Array(bytes);
  for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function concat(...arrs) {
  let len = 0;
  for (const a of arrs) len += a.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}

/* ---------- HKDF (extract + expand en una sola llamada) ---------- */
async function hkdf(salt, ikm, info, length) {
  const key = await subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8);
  return new Uint8Array(bits);
}

/* ---------- Cifrado del payload (aes128gcm, RFC 8291) ---------- */
export async function encryptPayload(subscription, plaintext) {
  const uaPublic = b64urlToBytes(subscription.keys.p256dh); // 65 bytes
  const authSecret = b64urlToBytes(subscription.keys.auth); // 16 bytes

  // Clave efímera del servidor de aplicación (ECDH P-256).
  const asKeyPair = await subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await subtle.exportKey("raw", asKeyPair.publicKey)); // 65

  const uaKey = await subtle.importKey(
    "raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(
    await subtle.deriveBits({ name: "ECDH", public: uaKey }, asKeyPair.privateKey, 256));

  // IKM = HKDF(salt=auth, ikm=ecdh, info="WebPush: info\0"||ua_pub||as_pub)
  const keyInfo = concat(enc.encode("WebPush: info"), new Uint8Array([0]), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdh, keyInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, concat(enc.encode("Content-Encoding: aes128gcm"), new Uint8Array([0])), 16);
  const nonce = await hkdf(salt, ikm, concat(enc.encode("Content-Encoding: nonce"), new Uint8Array([0])), 12);

  // Un único registro: plaintext || 0x02 (delimitador de último registro).
  const record = concat(plaintext, new Uint8Array([2]));
  const aesKey = await subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const ciphertext = new Uint8Array(
    await subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, aesKey, record));

  // Cabecera aes128gcm: salt(16) | rs(4, BE) | idlen(1) | keyid(as_pub 65) | ciphertext
  const rs = 4096;
  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  header[16] = (rs >>> 24) & 255; header[17] = (rs >>> 16) & 255;
  header[18] = (rs >>> 8) & 255;  header[19] = rs & 255;
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, ciphertext);
}

/* ---------- JWT VAPID (ES256, RFC 8292) ---------- */
export async function vapidAuth(endpoint, env) {
  const aud = new URL(endpoint).origin;
  const header = { typ: "JWT", alg: "ES256" };
  const claims = {
    aud,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: env.VAPID_SUBJECT || "mailto:recuerdame@example.com",
  };
  const signingInput =
    bytesToB64url(enc.encode(JSON.stringify(header))) + "." +
    bytesToB64url(enc.encode(JSON.stringify(claims)));

  const jwk = typeof env.VAPID_PRIVATE_JWK === "string"
    ? JSON.parse(env.VAPID_PRIVATE_JWK) : env.VAPID_PRIVATE_JWK;
  const key = await subtle.importKey(
    "jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = new Uint8Array(await subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, key, enc.encode(signingInput)));

  const jwt = signingInput + "." + bytesToB64url(sig);
  return "vapid t=" + jwt + ", k=" + env.VAPID_PUBLIC;
}

/* ---------- Envío ---------- */
/**
 * Envía un push. Devuelve { ok, status }.
 * status 404/410 → la suscripción caducó y debería borrarse.
 */
export async function sendPush(subscription, payloadObj, env) {
  const plaintext = enc.encode(JSON.stringify(payloadObj));
  const body = await encryptPayload(subscription, plaintext);
  const auth = await vapidAuth(subscription.endpoint, env);

  const res = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      "Authorization": auth,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      "TTL": "2419200",
      "Urgency": payloadObj.urgency || "high",
    },
    body,
  });
  return { ok: res.ok, status: res.status };
}
