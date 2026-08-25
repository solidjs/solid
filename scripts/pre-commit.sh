#!/bin/sh
# Format only added/copied/modified JS/TS files and re-stage them, so the
# commit snapshot matches the working tree. Pure renames are already
# formatted; including them rewrites compiler fixture snapshots during
# package-directory moves. Native compiler fixtures are byte-for-byte output
# contracts and must only change through their explicit update commands.
files=$(git diff --cached --name-only --diff-filter=ACM -- '*.ts' '*.tsx' '*.js' '*.jsx' |
  rg -v '^packages/compiler/__tests__/(fixtures|refresh/fixtures|directives/fixtures|lazy/fixtures)/')
[ -z "$files" ] && exit 0
echo "$files" | xargs npx prettier --write --cache
echo "$files" | xargs git add
