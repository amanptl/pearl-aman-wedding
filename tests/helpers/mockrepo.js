import fs from "node:fs";
import crypto from "node:crypto";

/**
 * Stateful in-memory GitHub: refs, commits, trees, blobs and contents for one repo (o/r, branch main).
 * `install(context)` routes api.github.com and o.github.io; `serveSite(context)` serves committed files in place of the
 * working-tree ones (content/*.json and assets/uploads/*) so a page can be loaded "as deployed".
 */
const sha = (s) => crypto.createHash("sha1").update(s).digest("hex");

export class MockRepo {
  constructor({ files = ["content/content.json", "content/guests.json", "content/admin.enc.json"], owner = "o", repo = "r", branch = "main" } = {}) {
    this.owner = owner; this.repo = repo; this.branch = branch;
    this.blobs = new Map();   // sha -> Buffer
    this.trees = new Map();   // sha -> { path: blobSha }
    this.commits = new Map(); // sha -> { sha, message, tree, parents, date, changed: string[] }
    this.log = [];            // every api call: { method, path, body }
    this.failNext = null;     // (method, path) => status | falsy
    this.delay = 0;
    const entries = {};
    for (const f of files) entries[f] = this.putBlob(fs.readFileSync(f));
    const tree = this.putTree(entries);
    this.head = this.addCommit({ message: "Initial site", tree, parents: [], changed: files });
  }
  putBlob(buf) { buf = Buffer.isBuffer(buf) ? buf : Buffer.from(buf); const s = sha("blob" + buf.length + buf.toString("base64")); this.blobs.set(s, buf); return s; }
  putTree(entries) { const s = sha("tree" + JSON.stringify(entries)); this.trees.set(s, entries); return s; }
  addCommit({ message, tree, parents, changed }) {
    const s = sha("commit" + message + tree + parents.join() + this.commits.size);
    this.commits.set(s, { sha: s, message, tree, parents, changed, date: new Date(Date.UTC(2027, 0, 1, 12, this.commits.size)).toISOString() });
    return s;
  }
  get headCommit() { return this.commits.get(this.head); }
  files(commitSha = this.head) { return this.trees.get(this.commits.get(commitSha).tree); }
  read(path, commitSha = this.head) { const b = this.files(commitSha)[path]; return b ? this.blobs.get(b) : undefined; }
  text(path, commitSha) { return this.read(path, commitSha)?.toString("utf8"); }
  json(path, commitSha) { return JSON.parse(this.text(path, commitSha)); }
  commitCount() { return this.commits.size; }

  async handle(route) {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname.replace(`/repos/${this.owner}/${this.repo}`, "");
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    const method = req.method();
    this.log.push({ method, path: p + (url.search || ""), body });
    const json = (o, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(o) });
    if (this.delay) await new Promise((r) => setTimeout(r, this.delay));
    const fail = this.failNext?.(method, p);
    if (fail === "abort") return route.abort("internetdisconnected");
    if (fail) return json({ message: "Injected failure" }, fail);
    if (method === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    if (method === "GET" && p === `/branches/${this.branch}`) return json({ name: this.branch });
    if (method === "GET" && p === `/git/ref/heads/${this.branch}`) return json({ object: { sha: this.head } });
    let m;
    if (method === "GET" && (m = p.match(/^\/git\/commits\/(\w+)$/))) { const c = this.commits.get(m[1]); return c ? json({ sha: c.sha, tree: { sha: c.tree } }) : json({ message: "Not Found" }, 404); }
    if (method === "POST" && p === "/git/blobs") {
      const buf = body.encoding === "base64" ? Buffer.from(body.content, "base64") : Buffer.from(body.content, "utf8");
      return json({ sha: this.putBlob(buf) }, 201);
    }
    if (method === "POST" && p === "/git/trees") {
      const base = { ...(this.trees.get(body.base_tree) || {}) };
      for (const e of body.tree) base[e.path] = e.sha;
      this.lastTreeBody = body;
      return json({ sha: this.putTree(base) }, 201);
    }
    if (method === "POST" && p === "/git/commits") {
      const prev = this.trees.get(this.commits.get(body.parents[0])?.tree) || {};
      const next = this.trees.get(body.tree);
      const changed = Object.keys(next).filter((k) => prev[k] !== next[k]);
      return json({ sha: this.addCommit({ message: body.message, tree: body.tree, parents: body.parents, changed }) }, 201);
    }
    if (method === "PATCH" && p === `/git/refs/heads/${this.branch}`) {
      if (!this.commits.has(body.sha)) return json({ message: "Reference update failed" }, 422);
      this.head = body.sha;
      return json({ ref: `refs/heads/${this.branch}`, object: { sha: this.head } });
    }
    if (method === "GET" && (m = p.match(/^\/contents\/(.+)$/))) {
      const path = decodeURIComponent(m[1]);
      const ref = url.searchParams.get("ref");
      const c = this.commits.get(ref) || this.headCommit;
      const b = this.files(c.sha)[path];
      if (!b) return json({ message: "Not Found" }, 404);
      return json({ content: this.blobs.get(b).toString("base64"), sha: b, encoding: "base64" });
    }
    if (method === "GET" && p === "/commits") {
      const path = url.searchParams.get("path");
      const out = [];
      for (let c = this.headCommit; c; c = this.commits.get(c.parents[0])) if (!path || c.changed.includes(path)) out.push({ sha: c.sha, commit: { message: c.message, author: { name: "Editor", date: c.date } } });
      return json(out.slice(0, +url.searchParams.get("per_page") || 30));
    }
    return json({ message: "unexpected " + method + " " + p }, 404);
  }

  /** Route the GitHub API (and the live-site poll host) for a page or context. */
  async install(target) {
    await target.route(`https://api.github.com/repos/${this.owner}/${this.repo}/**`, (r) => this.handle(r));
    await target.route(`https://${this.owner}.github.io/**`, (route) => {
      const u = new URL(route.request().url());
      const rel = u.pathname.replace(`/${this.repo}/`, "");
      const b = this.read(rel);
      return b ? route.fulfill({ status: 200, body: b, contentType: "application/json" }) : route.fulfill({ status: 404, body: "" });
    });
  }

  /** Serve committed files instead of the working tree for content/*.json and assets/uploads/*. */
  async serveSite(target) {
    await target.route(/\/(content\/[\w.-]+\.json|assets\/uploads\/[\w.-]+)(\?.*)?$/, (route) => {
      const u = new URL(route.request().url());
      const rel = u.pathname.replace(/^\//, "");
      const b = this.read(rel);
      if (!b) return route.fallback();
      const type = rel.endsWith(".json") ? "application/json" : rel.endsWith(".webp") ? "image/webp" : "application/octet-stream";
      return route.fulfill({ status: 200, body: b, contentType: type, headers: { "cache-control": "no-store" } });
    });
  }
}
