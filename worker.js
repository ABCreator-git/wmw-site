// ============================================================
// Words and Music on Wheels — API (Cloudflare Worker)
// Accounts with ownership: users can only edit/delete their own
// poems. One admin email can see all users and manage any poem.
// ============================================================
// Setup in Cloudflare Dashboard for this Worker:
//   1. Settings → Variables → KV Namespace Bindings
//        Variable name: POEMS_KV   →  Namespace: wmw_poems
//   2. Settings → Variables → Environment Variables (Secret, encrypted)
//        AUTH_SECRET      → a long random string (signs session tokens)
//   3. Settings → Variables → Environment Variables (plain text)
//        GOOGLE_CLIENT_ID → your Google OAuth Web Client ID
//        ADMIN_EMAIL      → your own email (e.g. ash.bhagat0511@gmail.com)
//        This is the ONLY account that can see all users / manage
//        any poem. Everyone else only sees and controls their own.
//   4. Deploy.
// ============================================================

const ALLOWED_ORIGIN = "https://ashishbhagat.com";
const SESSION_DAYS = 30;

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

// ---------- base64url helpers ----------
function bufToB64url(buf) {
  let bin = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlToBuf(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}
function strToB64url(str) { return bufToB64url(new TextEncoder().encode(str)); }
function b64urlToStr(str) { return new TextDecoder().decode(b64urlToBuf(str)); }

// ---------- password hashing (PBKDF2) ----------
async function hashPassword(password, saltB64) {
  const enc = new TextEncoder();
  const salt = saltB64 ? new Uint8Array(b64urlToBuf(saltB64)) : crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, keyMaterial, 256);
  return { hash: bufToB64url(bits), salt: bufToB64url(salt) };
}
async function verifyPassword(password, saltB64, expectedHashB64) {
  const { hash } = await hashPassword(password, saltB64);
  if (hash.length !== expectedHashB64.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= hash.charCodeAt(i) ^ expectedHashB64.charCodeAt(i);
  return diff === 0;
}

// ---------- session tokens ----------
async function hmacSign(data, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return bufToB64url(sig);
}
async function createSessionToken(email, env) {
  const payload = { email, exp: Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000 };
  const payloadB64 = strToB64url(JSON.stringify(payload));
  const sig = await hmacSign(payloadB64, env.AUTH_SECRET);
  return payloadB64 + "." + sig;
}
async function verifySessionToken(token, env) {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;
  const expectedSig = await hmacSign(payloadB64, env.AUTH_SECRET);
  if (expectedSig !== sig) return null;
  try {
    const payload = JSON.parse(b64urlToStr(payloadB64));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload.email;
  } catch (e) { return null; }
}

// ---------- Google ID token verification ----------
async function verifyGoogleIdToken(idToken, env) {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("Malformed token");
  const header = JSON.parse(b64urlToStr(parts[0]));
  const payload = JSON.parse(b64urlToStr(parts[1]));

  if (payload.aud !== env.GOOGLE_CLIENT_ID) throw new Error("Wrong audience");
  if (payload.iss !== "accounts.google.com" && payload.iss !== "https://accounts.google.com") throw new Error("Wrong issuer");
  if (!payload.exp || payload.exp * 1000 < Date.now()) throw new Error("Token expired");

  const certsRes = await fetch("https://www.googleapis.com/oauth2/v3/certs");
  const certs = await certsRes.json();
  const jwk = certs.keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error("Signing key not found");

  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const signedData = new TextEncoder().encode(parts[0] + "." + parts[1]);
  const signature = b64urlToBuf(parts[2]);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, signedData);
  if (!valid) throw new Error("Invalid signature");
  if (!payload.email) throw new Error("No email in token");
  return { email: payload.email, name: payload.name || "" };
}

// ---------- user storage ----------
async function getUser(env, email) {
  const raw = await env.POEMS_KV.get("user:" + email.toLowerCase());
  return raw ? JSON.parse(raw) : null;
}
async function saveUser(env, user) {
  await env.POEMS_KV.put("user:" + user.email.toLowerCase(), JSON.stringify(user));
}
async function listUsers(env) {
  const list = await env.POEMS_KV.list({ prefix: "user:" });
  const users = await Promise.all(
    list.keys.map((k) => env.POEMS_KV.get(k.name).then((raw) => JSON.parse(raw)))
  );
  // never expose password hashes/salts, even to the admin
  return users.map((u) => ({ email: u.email, name: u.name || "", provider: u.provider, createdAt: u.createdAt }));
}

// ---------- poems storage ----------
async function getPoems(env) {
  const raw = await env.POEMS_KV.get("poems");
  return raw ? JSON.parse(raw) : [];
}
async function savePoems(env, poems) {
  await env.POEMS_KV.put("poems", JSON.stringify(poems));
}

async function requireSession(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  return await verifySessionToken(token, env);
}
function isAdmin(email, env) {
  return !!email && !!env.ADMIN_EMAIL && email.toLowerCase() === env.ADMIN_EMAIL.toLowerCase();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method;

    if (method === "OPTIONS") return new Response(null, { headers: corsHeaders() });

    // ---------- AUTH ----------
    if (method === "POST" && url.pathname === "/auth/signup") {
      const body = await request.json().catch(() => null);
      if (!body || !body.email || !body.password) return json({ error: "Email and password required" }, 400);
      const email = String(body.email).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Invalid email" }, 400);
      if (String(body.password).length < 8) return json({ error: "Password must be at least 8 characters" }, 400);
      const name = String(body.name || "").trim().slice(0, 80);

      if (await getUser(env, email)) return json({ error: "An account with this email already exists" }, 409);

      const { hash, salt } = await hashPassword(body.password);
      await saveUser(env, { email, name, hash, salt, provider: "password", createdAt: Date.now() });
      const token = await createSessionToken(email, env);
      return json({ token, email, name, isAdmin: isAdmin(email, env) }, 201);
    }

    if (method === "POST" && url.pathname === "/auth/login") {
      const body = await request.json().catch(() => null);
      if (!body || !body.email || !body.password) return json({ error: "Email and password required" }, 400);
      const email = String(body.email).trim().toLowerCase();
      const user = await getUser(env, email);
      if (!user || user.provider !== "password") return json({ error: "Invalid email or password" }, 401);
      if (!(await verifyPassword(body.password, user.salt, user.hash))) return json({ error: "Invalid email or password" }, 401);
      const token = await createSessionToken(email, env);
      return json({ token, email, name: user.name || "", isAdmin: isAdmin(email, env) });
    }

    if (method === "POST" && url.pathname === "/auth/google") {
      const body = await request.json().catch(() => null);
      if (!body || !body.credential) return json({ error: "Missing credential" }, 400);
      try {
        const { email, name } = await verifyGoogleIdToken(body.credential, env);
        let user = await getUser(env, email);
        if (!user) {
          user = { email, name: name || "", provider: "google", createdAt: Date.now() };
          await saveUser(env, user);
        }
        const token = await createSessionToken(email, env);
        return json({ token, email, name: user.name || "", isAdmin: isAdmin(email, env) });
      } catch (e) {
        return json({ error: "Google sign-in failed: " + e.message }, 401);
      }
    }

    // ---------- PUBLIC POEMS FEED ----------
    if (method === "GET" && url.pathname === "/poems") {
      return json(await getPoems(env));
    }

    // Everything below requires a logged-in session
    const sessionEmail = await requireSession(request, env);
    if (!sessionEmail) return json({ error: "Unauthorized" }, 401);
    const admin = isAdmin(sessionEmail, env);

    // ---------- "MY POEMS" (own posts only) ----------
    if (method === "GET" && url.pathname === "/poems/mine") {
      const poems = await getPoems(env);
      return json(poems.filter((p) => (p.author || "").toLowerCase() === sessionEmail.toLowerCase()));
    }

    if (method === "POST" && url.pathname === "/poems") {
      const body = await request.json().catch(() => null);
      if (!body || !body.title || !Array.isArray(body.body)) return json({ error: "Missing title or body lines" }, 400);
      const poems = await getPoems(env);
      const newPoem = {
        id: crypto.randomUUID(),
        date: body.date || "",
        title: body.title,
        body: body.body,
        sign: body.sign || "— A.B.",
        author: sessionEmail,
      };
      poems.push(newPoem);
      await savePoems(env, poems);
      return json(newPoem, 201);
    }

    if (method === "PUT" && url.pathname.startsWith("/poems/")) {
      const id = url.pathname.split("/poems/")[1];
      const body = await request.json().catch(() => null);
      if (!body) return json({ error: "Invalid body" }, 400);
      const poems = await getPoems(env);
      const idx = poems.findIndex((p) => p.id === id);
      if (idx === -1) return json({ error: "Not found" }, 404);
      if (!admin && (poems[idx].author || "").toLowerCase() !== sessionEmail.toLowerCase()) {
        return json({ error: "You can only edit your own poems" }, 403);
      }
      poems[idx] = { ...poems[idx], ...body, id, author: poems[idx].author };
      await savePoems(env, poems);
      return json(poems[idx]);
    }

    if (method === "DELETE" && url.pathname.startsWith("/poems/")) {
      const id = url.pathname.split("/poems/")[1];
      const poems = await getPoems(env);
      const target = poems.find((p) => p.id === id);
      if (!target) return json({ error: "Not found" }, 404);
      if (!admin && (target.author || "").toLowerCase() !== sessionEmail.toLowerCase()) {
        return json({ error: "You can only delete your own poems" }, 403);
      }
      const next = poems.filter((p) => p.id !== id);
      await savePoems(env, next);
      return json({ deleted: id });
    }

    // ---------- ADMIN ONLY ----------
    if (method === "GET" && url.pathname === "/admin/users") {
      if (!admin) return json({ error: "Forbidden" }, 403);
      return json(await listUsers(env));
    }
    if (method === "GET" && url.pathname === "/admin/check") {
      return json({ isAdmin: admin });
    }

    return json({ error: "Not found" }, 404);
  },
};
