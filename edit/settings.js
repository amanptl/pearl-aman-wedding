// GitHub connection settings dialog.
import { h } from "./ui.js";
import * as gh from "./github.js";

export async function openSettings(app) {
  const s = gh.getSettings();
  const f = {
    owner: h("input", { type: "text", value: s.owner, placeholder: "e.g. pearl-and-aman", autocomplete: "off", spellcheck: false, id: "gh-owner" }),
    repo: h("input", { type: "text", value: s.repo, placeholder: "e.g. wedding", autocomplete: "off", spellcheck: false, id: "gh-repo" }),
    branch: h("input", { type: "text", value: s.branch || "main", autocomplete: "off", spellcheck: false, id: "gh-branch" }),
    token: h("input", { type: "password", value: s.token, placeholder: "github_pat_…", autocomplete: "off", spellcheck: false, id: "gh-token" }),
  };
  const row = (label, input, help) => h("label.fld", h("span.fld-l", label), input, help ? h("span.fld-h", help) : null);
  const status = h("p.dlg-note", { role: "status" });
  const body = h("div.settings",
    h("p.dlg-msg", "Publishing saves your changes to GitHub, which updates the live website. You only need to set this up once on this computer."),
    h("div.grid2", row("GitHub username or organisation", f.owner), row("Repository name", f.repo)),
    row("Branch", f.branch, "Usually “main”."),
    row("Access token", f.token, null),
    h("div.help-box",
      h("strong", "How to get a token"),
      h("p", "Open ", h("a", { href: "https://github.com/settings/personal-access-tokens/new", target: "_blank", rel: "noopener" }, "GitHub › Settings › Fine-grained tokens"),
        ", choose “Only select repositories” and pick this one site. Under Permissions › Repository permissions, set ", h("strong", "Contents"), " to ", h("strong", "Read and write"),
        ". Nothing else is needed. Copy the token and paste it above."),
      h("p.muted", "The token stays in this browser only and is sent only to GitHub. Use “Forget token” on shared computers.")),
    status
  );
  const test = async (close) => {
    gh.saveSettings({ owner: f.owner.value, repo: f.repo.value, branch: f.branch.value, token: f.token.value });
    if (!gh.isConfigured()) { status.textContent = "Please fill in the username, repository and token."; return; }
    status.textContent = "Checking…";
    try {
      await gh.request("GET", `/repos/${encodeURIComponent(f.owner.value.trim())}/${encodeURIComponent(f.repo.value.trim())}/branches/${encodeURIComponent(f.branch.value.trim() || "main")}`);
      app.toast("Connected to GitHub");
      close(true);
    } catch (e) { status.textContent = gh.friendlyError(e); status.className = "dlg-note err"; }
  };
  const res = await app.ui.dialog({
    title: "Publishing settings",
    body,
    actions: [
      { label: "Forget token", keepOpen: true, onClick: () => { gh.forgetToken(); f.token.value = ""; status.textContent = "Token removed from this browser."; } },
      { label: "Cancel", value: false },
      { label: "Save & test connection", primary: true, keepOpen: true, onClick: test },
    ],
  });
  return res === true;
}
