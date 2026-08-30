---
name: shell-discipline
description: Use before running ANY terminal/shell command, especially on Windows or in unfamiliar environments. Prevents crashes and hangs caused by mixing incompatible shell syntaxes (bash vs PowerShell vs cmd vs Git Bash) in the same session. Also governs how to diagnose a hung or garbled terminal — never blame the tool being run (wrangler, node, etc.) before ruling out a shell-syntax mismatch.
---

# Shell Discipline

## Why this exists

A real incident: a terminal AI ran `taskkill //F //IM node.exe 2>/dev/null` and `sleep 12 &`
against a prompt that clearly showed `PS C:\Users\...>` (PowerShell). This mixes three
incompatible conventions in one line:
- `//F //IM` — Git Bash's double-slash escaping for Windows-style flags (MSYS rewrites
  single-slash paths, so Git Bash tools need `//` to pass a literal `/`). Not valid in
  real PowerShell or cmd.
- `2>/dev/null` — Unix redirection. `/dev/null` does not exist on Windows.
- `sleep 12 &` — bash job control. PowerShell's `sleep` and `&` behave differently or not
  at all in this form.

The shell hung for over 10 minutes, then dumped raw cursor-position escape sequences
(`[555;63;30M...`) instead of output — a classic sign of a terminal control-sequence
desync, not a crash in the program being run. The AI then blamed "a known
miniflare/workerd instability on Windows" — a guess it never verified — instead of
noticing its own command syntax didn't match its own shell prompt.

**Never do this.** Follow the steps below every time, without exception.

## Before running any command

1. **Identify the actual shell from the prompt/context, not from habit or assumption.**
   - `PS C:\...>` → native PowerShell.
   - `C:\...>` (no `PS`) → cmd.exe.
   - `user@host:~/path$` or similar → bash (native Linux/macOS, WSL, or Git Bash on Windows).
   - If genuinely unsure, run a single, unambiguous probe command first (e.g. `$PSVersionTable.PSVersion` for PowerShell vs `echo $BASH_VERSION` for bash) and read the result before doing anything else. Do not guess.

2. **Use only that shell's native syntax for the entire session.** Do not mix:
   | Concept | bash / Git Bash | PowerShell | cmd.exe |
   |---|---|---|---|
   | Kill process | `kill`, `pkill` | `Stop-Process`, `taskkill /F /IM` (single slash) | `taskkill /F /IM` |
   | Discard output | `2>/dev/null` | `2>$null` | `2>nul` |
   | Background job | `cmd &`, `wait` | `Start-Job`, `Start-Process` | (no native equivalent) |
   | Sleep | `sleep N` | `Start-Sleep -Seconds N` | `timeout /t N` |
   | Path separator in flags | `--flag=/path` | `--flag=C:\path` or `--flag=/path` (many CLIs accept forward slashes for their own args) | backslash |

   Windows flags use a **single** forward slash (`/F`, `/IM`) in native cmd/PowerShell.
   Double slashes (`//F`) are a Git-Bash-only workaround and are a strong signal that
   command was copied from a bash context into a non-bash shell — that mismatch is itself
   a bug to fix, not something to paper over.

3. **Never hardcode OS-specific paths for temp files, profile dirs, or lock files**
   (e.g. `C:/tmp/...`) inside scripts meant to run cross-platform (CI on Linux, dev on
   Windows/Mac). Use the language's own temp-dir API (`os.tmpdir()` in Node,
   `tempfile.gettempdir()` in Python, etc.) so the same script works everywhere without
   per-OS branches.

## When a command hangs or produces garbled output

If a terminal hangs unexpectedly long, or output looks like raw escape codes
(`[<numbers>;<numbers>;<numbers>M` or similar bracketed sequences instead of readable
text), treat this as a **shell/terminal state problem first**, before considering the
program you invoked:

1. Stop and re-read the exact command you just ran against the exact shell prompt shown.
   Look specifically for syntax from a different shell (see table above).
2. Do not invent a root cause for the invoked program ("known instability", "flaky on
   Windows", etc.) unless you have an actual error message or stack trace from that
   program confirming it. A shell hang with no program output is evidence about the
   shell, not about the program.
3. Open a fresh terminal/shell session rather than continuing to send commands into a
   possibly-desynced one — a corrupted terminal state can make even correct subsequent
   commands look like they're failing.
4. Re-run the *same intended action* using syntax verified correct for the confirmed
   shell, one command at a time, checking output after each before proceeding.

## Reporting back

When explaining a crash or hang to the user, always show:
- The exact shell prompt at the time.
- The exact command(s) sent.
- Whether the two are syntactically consistent with each other.

Never present an unverified guess about an external tool's stability as a settled
diagnosis. If the true cause isn't confirmed by an actual error message from that tool,
say so explicitly rather than filling the gap with a plausible-sounding but unchecked
explanation.
