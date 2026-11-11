## What and why

<!-- What does this change, and why? Link the issue, e.g. "Fixes #123". -->

## Checklist

- [ ] `scripts/check.ps1` passes locally
- [ ] New or changed commands have tests (`crates/msh-core/tests/cmd_<module>.rs`), new frontend logic has a `*.test.ts`
- [ ] UI strings use `t()` and have German translations in `app/src/i18n/de.json`
- [ ] User-visible changes have an entry under "Unreleased" in `CHANGELOG.md`
- [ ] No libraries (`.sh3f`, `.sh3t`, `.jar`), personal homes or files without the right to publish them
