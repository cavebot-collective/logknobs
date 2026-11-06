/*
 * Command-line quoting for the shells a copied command is pasted into.
 *
 * An argument goes through up to three parsers before git sees it, and each
 * target below names exactly which ones:
 *
 *   bash            bash word splitting/quoting -> execve argv (no re-parse)
 *   powershell      PowerShell 7.3+ string literal -> PowerShell builds the
 *                   Windows command line itself ("Windows" argument passing)
 *                   -> git's MSVCRT-compatible argv parser
 *   powershell-5.1  Windows PowerShell 5.1 string literal -> LEGACY command
 *                   line construction (wraps args containing whitespace in
 *                   double quotes, does NOT escape embedded quotes) -> MSVCRT
 *   cmd             cmd.exe line at the prompt: % expansion, then ^ escapes
 *                   and metacharacters -> command line as written -> MSVCRT
 *   cmd-batch       the same line inside a .bat/.cmd file: % expansion
 *                   differs (%% is a literal %, undefined %x% is empty)
 *
 * Which of these hold on a real Windows machine is not argued here: the
 * windows-quoting workflow runs every target against git and compares the
 * output bytes with git invoked directly, no shell.
 */
export const SHELLS = ["bash", "powershell", "powershell-5.1", "cmd", "cmd-batch"];
export const SHELL_LABELS = {
  "bash": "bash / zsh / Git Bash", "powershell": "PowerShell 7.3+", "powershell-5.1": "Windows PowerShell 5.1",
  "cmd": "cmd (prompt)", "cmd-batch": "cmd (.bat file)",
};

// MSVCRT / CommandLineToArgvW rules: inside double quotes, backslashes are
// literal unless they precede a quote; 2n backslashes + quote -> n + delimiter,
// 2n+1 + quote -> n + literal quote.
export function msvcrtQuote(arg) {
  if (arg !== "" && !/[\s"]/.test(arg)) return arg;
  let out = '"', bs = 0;
  for (const ch of arg) {
    if (ch === "\\") { bs++; continue; }
    if (ch === '"') { out += "\\".repeat(bs * 2 + 1) + '"'; bs = 0; continue; }
    out += "\\".repeat(bs) + ch; bs = 0;
  }
  return out + "\\".repeat(bs * 2) + '"';
}

// cmd.exe: every quote is caret-escaped, so cmd never enters its quoted
// state; then every metacharacter is caret-escaped too, which is safe because
// cmd is never "inside quotes". At the prompt, % expansion runs BEFORE carets
// are removed, so "^%cd^%" looks up a variable named "cd^", which does not
// exist, and the prompt leaves undefined names as written; the carets are then
// removed and git receives %cd%. In a batch file an undefined name expands to
// nothing instead, so there % is doubled (%% is the batch escape for %).
const CMD_META = /[()%!^"<>&|]/g;
const cmdPrompt = a => msvcrtQuote(a).replace(CMD_META, "^$&");
const cmdBatch = a => msvcrtQuote(a).replace(/[()!^"<>&|]/g, "^$&").replace(/%/g, "%%");

// PowerShell single-quoted literal: nothing inside is special except the
// single quote itself, and PowerShell counts the typographic single quotes
// (U+2018..U+201B) as single quotes too, so each is doubled.
const psLiteral = s => `'${s.replace(/['‘’‚‛]/g, "$&$&")}'`;
// PowerShell 5.1 legacy passing: it adds the outer quotes (when the argument
// has whitespace) but escapes nothing, so the MSVCRT escaping of embedded
// quotes -- and of backslashes that end up before a quote -- is done here.
function ps51(arg) {
  let inner = "", bs = 0;
  for (const ch of arg) {
    if (ch === "\\") { bs++; continue; }
    if (ch === '"') { inner += "\\".repeat(bs * 2 + 1) + '"'; bs = 0; continue; }
    inner += "\\".repeat(bs) + ch; bs = 0;
  }
  inner += "\\".repeat(/\s/.test(arg) ? bs * 2 : bs);
  return psLiteral(inner);
}

const BASH_SAFE = /^[A-Za-z0-9_\-=.,:/+%@]+$/;
// PowerShell bare words: no comma (a bare a,b is an array), no leading - or @
// (parameter / splat syntax); anything else is quoted
const PS_SAFE = /^[A-Za-z0-9_.:/+=][A-Za-z0-9_\-=.:/+]*$/;
export function quoteArg(shell, arg) {
  switch (shell) {
    case "bash": return BASH_SAFE.test(arg) ? arg : `'${arg.replace(/'/g, "'\\''")}'`;
    case "powershell": return PS_SAFE.test(arg) ? arg : psLiteral(arg);
    case "powershell-5.1": return PS_SAFE.test(arg) ? arg : ps51(arg);
    case "cmd": return cmdPrompt(arg);
    case "cmd-batch": return cmdBatch(arg);
    default: throw new Error(`unknown shell ${shell}`);
  }
}
/** program plus quoted arguments, as one line for that shell */
export function commandLine(shell, program, args) {
  if (!SHELLS.includes(shell)) throw new Error(`unknown shell ${shell}`);
  return [program, ...args.map(a => quoteArg(shell, a))].join(" ");
}
