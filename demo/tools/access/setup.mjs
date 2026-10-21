// Puts the public site behind Cloudflare Access with an email allow-list (SPEC "Public build and hosting").
//   node tools/access/setup.mjs                 # create or update the Access app + policy for the Pages site
//   node tools/access/setup.mjs --list          # show the current app and its policies
//   node tools/access/setup.mjs --off           # remove the Access app: the site is open to anyone with the link (run without flags to restore)
// Auth: CLOUDFLARE_API_TOKEN, else ~/.config/great-vote/cloudflare_access_token (an API token with Access: Apps and
// Policies: Edit), else the wrangler OAuth login (which can read Access but not write it).
// Zero Trust must be enabled once in the dashboard (Zero Trust -> choose a team name -> Free plan) before this works.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

// Account id and allow-list are kept outside the repo: ~/.config/great-vote/cloudflare_account_id, ~/.config/great-vote/access_allow.txt (one email per line)
const local = (name) => readFileSync(`${homedir()}/.config/great-vote/${name}`, 'utf8');
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID || local('cloudflare_account_id').trim();
const DOMAINS = ['great-vote.pages.dev', '*.great-vote.pages.dev']; // production and preview deployments
const APP_NAME = 'Great Vote';
const SESSION = '168h'; // one login per week, so a five-day study needs one code
const allow = () => local('access_allow.txt').split(/\s+/).filter(Boolean);

function token() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  // the Access-scoped API token, kept outside the repo: ~/.config/great-vote/cloudflare_access_token (mode 600)
  try { const t = readFileSync(`${homedir()}/.config/great-vote/cloudflare_access_token`, 'utf8').trim(); if (t) return t; } catch { /* fall through */ }
  const cfg = readFileSync(`${homedir()}/Library/Preferences/.wrangler/config/default.toml`, 'utf8');
  return /oauth_token = "([^"]+)"/.exec(cfg)[1];
}
const api = async (method, path, body) => {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}${path}`, {
    method, headers: { authorization: `Bearer ${token()}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json();
  if (!d.success) throw new Error(`${method} ${path}: ${JSON.stringify(d.errors)}`);
  return d.result;
};

const apps = await api('GET', '/access/apps');
const existing = apps.find((a) => a.name === APP_NAME || a.domain === DOMAINS[0]);
if (process.argv.includes('--off')) {
  if (!existing) { console.log('no Access app: the site is already open'); process.exit(0); }
  await api('DELETE', `/access/apps/${existing.id}`);
  console.log(`deleted Access app ${existing.id}: ${DOMAINS.join(', ')} are open; rerun without --off to restore the login`);
  process.exit(0);
}
if (process.argv.includes('--list')) {
  if (!existing) { console.log('no Access app yet'); process.exit(0); }
  console.log(JSON.stringify({ id: existing.id, domain: existing.domain, self_hosted_domains: existing.self_hosted_domains, session: existing.session_duration }, null, 1));
  const pol = await api('GET', `/access/apps/${existing.id}/policies`);
  for (const p of pol) console.log(`- ${p.name} (${p.decision}): ${JSON.stringify(p.include)}`);
  process.exit(0);
}

const policy = { name: 'Allow-list', decision: 'allow', include: allow().map((email) => ({ email: { email } })) };
const app = {
  name: APP_NAME, type: 'self_hosted', domain: DOMAINS[0], self_hosted_domains: DOMAINS, session_duration: SESSION,
  allowed_idps: [], auto_redirect_to_identity: false, app_launcher_visible: false, http_only_cookie_attribute: true,
};
let result;
if (existing) {
  result = await api('PUT', `/access/apps/${existing.id}`, app);
  const pol = await api('GET', `/access/apps/${existing.id}/policies`);
  const p = pol.find((x) => x.name === policy.name);
  if (p) await api('PUT', `/access/apps/${existing.id}/policies/${p.id}`, { ...policy, precedence: p.precedence ?? 1 });
  else await api('POST', `/access/apps/${existing.id}/policies`, { ...policy, precedence: 1 });
  console.log(`updated Access app ${existing.id} for ${DOMAINS.join(', ')}`);
} else {
  result = await api('POST', '/access/apps', { ...app, policies: [{ ...policy, precedence: 1 }] });
  console.log(`created Access app ${result.id} for ${DOMAINS.join(', ')}`);
}
console.log(`allow-list: ${allow().join(', ')}; session ${SESSION}; login by one-time code sent to the email`);
