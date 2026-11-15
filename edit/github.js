// GitHub REST API (fetch only). The token is read from localStorage and never logged.
const KEY = "pa.editor.gh";
const safe = (fn, fb = null) => { try { return fn(); } catch { return fb; } };

export class GitHubError extends Error {
  constructor(status, message, detail) { super(message); this.status = status; this.detail = detail; }
}

export function getSettings() {
  const s = safe(() => JSON.parse(localStorage.getItem(KEY) || "null")) || {};
  return { owner: "", repo: "", branch: "main", token: "", ...s };
}
export function saveSettings(s) {
  safe(() => localStorage.setItem(KEY, JSON.stringify({ owner: s.owner.trim(), repo: s.repo.trim(), branch: (s.branch || "main").trim(), token: s.token.trim() })));
}
export const forgetToken = () => { const s = getSettings(); saveSettings({ ...s, token: "" }); };
export const isConfigured = () => { const s = getSettings(); return !!(s.owner && s.repo && s.token); };
export const siteUrl = () => { const s = getSettings(); return s.owner && s.repo ? `https://${s.owner}.github.io/${s.repo}/` : ""; };

export function friendlyError(e) {
  if (!(e instanceof GitHubError)) return navigator.onLine === false ? "You appear to be offline. Check your connection and try again." : `Something went wrong: ${e.message}`;
  switch (e.status) {
    case 401: return "GitHub didn't accept the token. It may have expired or been copied incorrectly. Open Settings and paste a fresh token.";
    case 403: return "The token isn't allowed to change this repository. Make sure it has \"Contents: Read and write\" permission for this repo (or you've hit a rate limit; wait a minute).";
    case 404: return "GitHub couldn't find that repository or branch. Check the owner, repository and branch name in Settings, and that the token has access to this repo.";
    case 409: return "The site changed on GitHub while publishing. Reload the latest version and try again.";
    case 422: return "GitHub rejected the update (for example the branch is protected or a file was invalid). " + (e.detail || "");
    default: return `GitHub returned an error (${e.status}). ${e.detail || ""}`.trim();
  }
}

async function api(method, path, body, { raw = false } = {}) {
  const s = getSettings();
  if (!s.token) throw new GitHubError(401, "No token");
  let res;
  try {
    res = await fetch(`https://api.github.com${path}`, {
      method,
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${s.token}`, "X-GitHub-Api-Version": "2022-11-28", ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
  } catch (e) { throw new Error("Couldn't reach GitHub. Check your internet connection."); }
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json()).message || ""; } catch {}
    throw new GitHubError(res.status, `GitHub ${res.status}`, detail);
  }
  return raw ? res : res.status === 204 ? null : res.json();
}

const repoPath = () => { const s = getSettings(); return `/repos/${encodeURIComponent(s.owner)}/${encodeURIComponent(s.repo)}`; };
const b64utf8 = (text) => { const b = new TextEncoder().encode(text); let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, "")), (c) => c.charCodeAt(0)));
async function blobToB64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Read a text file from the repo. Returns {text, sha} or null if missing. */
export async function getFile(path, ref) {
  const s = getSettings();
  try {
    const j = await api("GET", `${repoPath()}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref || s.branch)}`);
    return { text: fromB64(j.content || ""), sha: j.sha };
  } catch (e) { if (e instanceof GitHubError && e.status === 404) return null; throw e; }
}

/** Last commits that touched a path. */
export async function listCommits(path, n = 20) {
  const s = getSettings();
  const list = await api("GET", `${repoPath()}/commits?path=${encodeURIComponent(path)}&sha=${encodeURIComponent(s.branch)}&per_page=${n}`);
  return list.map((c) => ({ sha: c.sha, message: c.commit.message, date: c.commit.author?.date || c.commit.committer?.date, author: c.commit.author?.name || "" }));
}

/**
 * One commit with many files. files: [{path, text} | {path, blob}]. onStep(name) is called for progress.
 * Returns the new commit sha.
 */
export async function publishFiles(files, message, onStep = () => {}) {
  const s = getSettings();
  const R = repoPath();
  onStep("Connecting to GitHub");
  const ref = await api("GET", `${R}/git/ref/heads/${encodeURIComponent(s.branch)}`);
  const headSha = ref.object.sha;
  const head = await api("GET", `${R}/git/commits/${headSha}`);
  onStep("Uploading files");
  const entries = [];
  for (const f of files) {
    const blob = await api("POST", `${R}/git/blobs`, f.blob ? { content: await blobToB64(f.blob), encoding: "base64" } : { content: f.text, encoding: "utf-8" });
    entries.push({ path: f.path, mode: "100644", type: "blob", sha: blob.sha });
  }
  onStep("Saving changes");
  const tree = await api("POST", `${R}/git/trees`, { base_tree: head.tree.sha, tree: entries });
  const commit = await api("POST", `${R}/git/commits`, { message, tree: tree.sha, parents: [headSha] });
  await api("PATCH", `${R}/git/refs/heads/${encodeURIComponent(s.branch)}`, { sha: commit.sha });
  return commit.sha;
}

export const encodeText = b64utf8;
export const request = api;

/** Facade handed to the Guests module. */
export const github = { getSettings, isConfigured, getFile, listCommits, publishFiles, request: api, friendlyError, siteUrl };
