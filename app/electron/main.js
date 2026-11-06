// Electron host. The one capability the browser build cannot have: real git.
// The page builds the argument list; the host runs ONLY `git log` with flags
// from a closed whitelist. git log has flags that write files (--output) or
// run programs, so an unknown flag is refused rather than passed through.
const { app, BrowserWindow, ipcMain } = require("electron");
const { execFile } = require("node:child_process");
const path = require("node:path");
const REPO = process.env.GITLOG_REPO || process.cwd();
const FLAG = [/^--graph$/, /^--oneline$/, /^--abbrev-commit$/, /^--first-parent$/, /^--reverse$/, /^--all$/,
              /^--(topo|date|author-date)-order$/, /^-\d+$/, /^--abbrev=\d+$/,
              /^--(format|pretty)=[\s\S]*$/, /^--date=(default|rfc2822|iso|iso-strict|short|unix|raw|relative|human)$/,
              /^--decorate=(auto|short|full|no)$/, /^--color=(auto|always|never)$/];
const CONFIG = /^(log\.graphColors|color\.decorate\.(branch|remoteBranch|tag|stash|HEAD)|color\.diff\.commit)=[^\n]*$/;
app.whenReady().then(() => {
  const w = new BrowserWindow({ width: 1440, height: 900, webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true } });
  w.loadFile(path.join(__dirname, "..", "dist", "index.html"));
});
ipcMain.handle("gitlog:run", (_e, req) => new Promise(res => {
  const { config = [], args = [] } = req || {};
  const cfg = [];
  for (let i = 0; i < config.length; i += 2) {
    if (config[i] !== "-c" || !CONFIG.test(String(config[i + 1]))) return res({ ok: false, error: `refused config ${config[i + 1]}`, repo: REPO });
    cfg.push("-c", config[i + 1]);
  }
  for (const a of args) if (typeof a !== "string" || !FLAG.some(re => re.test(a))) return res({ ok: false, error: `refused flag ${a}`, repo: REPO });
  execFile("git", ["-C", REPO, ...cfg, "log", ...args], { maxBuffer: 1 << 24 }, (err, stdout, stderr) =>
    res(err ? { ok: false, error: stderr || err.message, repo: REPO } : { ok: true, stdout, repo: REPO }));
}));
app.on("window-all-closed", () => app.quit());
