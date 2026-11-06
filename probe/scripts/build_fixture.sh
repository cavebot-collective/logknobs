#!/usr/bin/env bash
# Deterministic git fixture repo for git-log format differential testing.
#
# Every identity, timestamp and tree is pinned so commit OIDs are reproducible
# across machines and runs. Reproducibility is a hard requirement: the
# differential oracle compares simulator output against real `git log` output,
# and any nondeterminism in the fixture makes golden data unusable.
#
# The fixture is organised around the three declared preview cases:
#   TERSE        - short one-line subjects, no body
#   CONVENTIONAL - Conventional Commits + trailers
#   VERBOSE      - long wrapped bodies, unicode, breaking-change footer
# plus structural commits (merge, tag, notes) needed to exercise placeholders
# that have no meaning on an ordinary linear commit.
set -euo pipefail
DEST="${1:?usage: build_fixture.sh <dest-dir>}"
rm -rf "$DEST"; mkdir -p "$DEST"; cd "$DEST"

export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
git init -q -b main .
git config core.abbrev 7
git config user.name "Ada Lovelace"
git config user.email "ada@example.org"
git config gc.auto 0

commit() { # commit <epoch> <msgfile> [author-name] [author-email]
  local epoch="$1" msgfile="$2" nm="${3:-Ada Lovelace}" em="${4:-ada@example.org}"
  GIT_AUTHOR_NAME="$nm" GIT_AUTHOR_EMAIL="$em" \
  GIT_COMMITTER_NAME="Grace Hopper" GIT_COMMITTER_EMAIL="grace@example.org" \
  GIT_AUTHOR_DATE="$epoch +0100" GIT_COMMITTER_DATE="$((epoch+90)) -0400" \
  git commit -q --file="$msgfile" --cleanup=verbatim
}

# --- TERSE ----------------------------------------------------------------
printf 'seed\n' > README.md; git add -A
printf 'init\n' > /tmp/m; commit 1700000000 /tmp/m

printf 'a\n' > a.txt; git add -A
printf 'fix typo\n' > /tmp/m; commit 1700003600 /tmp/m

# --- CONVENTIONAL ---------------------------------------------------------
mkdir -p src; printf 'export const x = 1;\n' > src/index.ts; git add -A
cat > /tmp/m <<'MSG'
feat(parser): support nested placeholder groups

Adds a recursive descent path for %(...) forms so that option lists can
themselves contain commas inside quoted values.

Refs: #412
Signed-off-by: Ada Lovelace <ada@example.org>
Co-authored-by: Alan Turing <alan@example.org>
MSG
commit 1700090000 /tmp/m

printf 'export const x = 2;\nexport const y = 3;\n' > src/index.ts; git add -A
printf 'docs: clarify padding semantics\n' > /tmp/m
commit 1700176400 /tmp/m "Alan Turing" "alan@example.org"

git tag -a v0.1.0 -m "release 0.1.0" HEAD

# --- VERBOSE --------------------------------------------------------------
git checkout -q -b feature/verbose
printf 'wide\n' > verbose.txt; git add -A
cat > /tmp/m <<'MSG'
refactor(core)!: replace the ad-hoc token scanner with a table-driven lexer that preserves byte offsets for every emitted span

The previous scanner conflated lexing and evaluation, which made it impossible
to attribute an output byte range back to the placeholder that produced it.
That attribution is load-bearing for reverse propagation, so the scanner is
now split into two phases.

Phase one produces a span table: each entry records (start, end, kind, source
offset). Phase two evaluates spans against a commit record. Because phase one
is independent of commit data, the span table can be computed once per
template and reused across every previewed commit.

Unicode note: offsets are byte offsets, not codepoint offsets, because git's
padding directives count display columns while truncation counts bytes.
Mixing the two silently corrupts CJK and emoji output. Test vectors cover
日本語テキスト and 🌍 explicitly.

BREAKING CHANGE: TokenScanner.next() no longer returns evaluated text.

Refs: #500, #501
Reviewed-by: Grace Hopper <grace@example.org>
Signed-off-by: Ada Lovelace <ada@example.org>
MSG
commit 1700262800 /tmp/m

# --- WIDTH: CJK + emoji subject (display-column vs byte divergence) -------
git checkout -q main
printf 'w\n' > width.txt; git add -A
python3 - <<'PYW'
import pathlib
subject = 'fix(i18n): \u65e5\u672c\u8a9e\u306e\u5e45\u3092\u6b63\u3057\u304f\u6570\u3048\u308b \U0001f30d\n'
pathlib.Path('/tmp/m').write_bytes(subject.encode('utf-8'))
PYW
commit 1700300000 /tmp/m

# --- structural: merge (multi-parent, %m, --graph) ------------------------
git checkout -q main
GIT_AUTHOR_NAME="Ada Lovelace" GIT_AUTHOR_EMAIL="ada@example.org" \
GIT_COMMITTER_NAME="Grace Hopper" GIT_COMMITTER_EMAIL="grace@example.org" \
GIT_AUTHOR_DATE="1700349200 +0100" GIT_COMMITTER_DATE="1700349290 -0400" \
git merge -q --no-ff -m "Merge branch 'feature/verbose' into main" feature/verbose

# --- structural: explicit encoding header (%e) ----------------------------
printf 'enc\n' > encoding.txt; git add -A
printf 'chore: commit carrying an explicit encoding header\n' > /tmp/m
GIT_AUTHOR_NAME="Ada Lovelace" GIT_AUTHOR_EMAIL="ada@example.org" \
GIT_COMMITTER_NAME="Grace Hopper" GIT_COMMITTER_EMAIL="grace@example.org" \
GIT_AUTHOR_DATE="1700349100 +0100" GIT_COMMITTER_DATE="1700349100 -0400" \
  git -c i18n.commitEncoding=ISO-8859-1 commit -q --file=/tmp/m --cleanup=verbatim

# --- structural: notes (%N) ----------------------------------------------
GIT_AUTHOR_DATE="1700349300 +0100" GIT_COMMITTER_DATE="1700349300 -0400" \
GIT_AUTHOR_NAME="Ada Lovelace" GIT_AUTHOR_EMAIL="ada@example.org" \
GIT_COMMITTER_NAME="Grace Hopper" GIT_COMMITTER_EMAIL="grace@example.org" \
  git notes add -m "benchmarked: 3.1x faster on the 10k-commit corpus" HEAD

# --- LAYER 2: signature overlay (NON-DETERMINISTIC BY CONSTRUCTION) -------
# GPG signatures embed a timestamp and random padding, so any commit carrying
# one has an unpredictable OID, and so does anything downstream of it. This
# block is therefore last and lives on an isolated branch: the deterministic
# core above is never a descendant of it. Oracle A compares %G* by field, not
# by whole-output bytes. See spec D-5.
git checkout -q -b signed-overlay
# Closes spec D-5. The key is generated in-repo, unprotected and throwaway --
# it exists only so the signature placeholders have observable behaviour.
# The keyring MUST live outside the repository. An earlier revision placed it
# at $DEST/.gnupg, where the `git add -A` below swept private key material into
# a commit -- and `git checkout main` then deleted the working copy, which is
# why signatures verified as E. Committed private keys would also ship inside
# any archive of the fixture. Sibling directory, never inside $DEST.
export GNUPGHOME="${DEST%/}-gnupg"; rm -rf "$GNUPGHOME"
mkdir -p "$GNUPGHOME"; chmod 700 "$GNUPGHOME"
# A gpg-agent started under a previous GNUPGHOME will keep serving that
# home even after this export, so signing succeeds against a keyring the
# rebuild has already deleted -- the commit verifies as E (cannot check).
# Kill any inherited agent so the new home owns its own agent.
gpgconf --kill all >/dev/null 2>&1 || true
if gpg --batch --quiet --passphrase '' --quick-generate-key \
       "Fixture Signer <signer@example.org>" default default never 2>/dev/null; then
  KEYID=$(gpg --list-secret-keys --with-colons 2>/dev/null | awk -F: '/^sec/{print $5; exit}')
  git config user.signingkey "$KEYID"
  git config gpg.program gpg
  printf 'sig\n' > signed.txt; git add signed.txt
  printf 'chore: signed commit for %%%%G placeholder coverage\n' > /tmp/m
  GIT_AUTHOR_NAME="Ada Lovelace" GIT_AUTHOR_EMAIL="ada@example.org" \
  GIT_COMMITTER_NAME="Grace Hopper" GIT_COMMITTER_EMAIL="grace@example.org" \
  GIT_AUTHOR_DATE="1700349150 +0100" GIT_COMMITTER_DATE="1700349150 -0400" \
    git commit -q -S --file=/tmp/m --cleanup=verbatim || echo "WARN: signing failed" >&2
  gpg --batch --yes --export --armor "$KEYID" > "$GNUPGHOME/signer-pubkey.asc" 2>/dev/null || true
else
  echo "WARN: gpg key generation failed; %G* coverage remains a declared gap" >&2
fi


git checkout -q main

git log --format='%H %s' main | cat
