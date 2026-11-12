// Verifies a Google sign-in for Dragon Link.
// The page sends the access token it got from Google; we ask Google whether the token is real,
// was issued to our OAuth client (GOOGLE_CLIENT_ID) and belongs to a verified email, then
// return the public profile and the player's NEAR game-account name.
import { createHash } from 'node:crypto';

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

const slug = s => String(s || '').normalize('NFKD').replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 16) || 'player';

export default async request => {
  if (request.method !== 'POST') return json(405, { error: 'Use POST.' });
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return json(500, { error: 'Google sign-in is not configured on the server.' });

  let token;
  try { ({ access_token: token } = await request.json()); } catch {}
  if (!token || typeof token !== 'string') return json(400, { error: 'Missing Google token.' });

  // 1. Is this a live token issued to our client?
  const info = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`);
  if (!info.ok) return json(401, { error: 'Google did not accept this sign-in. Try again.' });
  const t = await info.json();
  if (t.aud !== clientId && t.azp !== clientId) return json(401, { error: 'This sign-in was issued for another app.' });
  if (Number(t.expires_in) <= 0) return json(401, { error: 'The Google sign-in expired. Try again.' });

  // 2. Who is it?
  const u = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { authorization: `Bearer ${token}` } });
  if (!u.ok) return json(401, { error: 'Could not read your Google profile.' });
  const p = await u.json();
  if (!p.email_verified) return json(403, { error: 'Your Google email is not verified.' });

  // 3. A stable game-account name: the same Google account always gets the same NEAR account.
  const tag = createHash('sha256').update(`dragon-link:${p.sub}`).digest('hex').slice(0, 6);
  const handle = `${slug(p.given_name || p.email.split('@')[0])}-${tag}.dragonlink.testnet`;

  return json(200, { name: p.given_name || p.name || 'Player', email: p.email, picture: p.picture || null, handle, verified: true });
};
