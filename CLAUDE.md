# vscode-matviz

VESTA-inspired crystal structure viewer as a VSCode extension.

## Key files

- `README.md` — user-facing documentation
- `Plan.md` — master roadmap (version-level phases, decision gates)
- `STATUS.md` — current project status. **Keep up to date** when work progresses.
- `CLAUDE.md` — this file (architecture + workflow rules)

## Architecture

Two execution contexts, two bundles:

- **Extension host** (Node.js): `src/extension.ts`, `src/editor/`, `src/parsers/` — reads files, parses structures, manages webview lifecycle. Bundle: `dist/extension.js` (CJS, externalizes `vscode`).
- **Webview** (browser): `src/webview/` — Three.js rendering, user interaction. Bundle: `dist/webview.js` (IIFE, includes Three.js).

Data flow: file → parser → `CrystalStructure` JSON → `postMessage` → webview → Three.js scene.

### Key types

- `CrystalStructure` (`src/parsers/types.ts`): the universal intermediate — lattice vectors, species[], cartesian positions[], pbc.
- `CrystalEditorProvider` (`src/editor/crystalEditorProvider.ts`): `CustomReadonlyEditorProvider<CrystalDocument>`. File association via `package.json` `contributes.customEditors`.
- `CrystalRenderer` (`src/webview/renderer.ts`): owns the Three.js scene. Groups: `atomGroup` (InstancedMesh per element), `bondGroup` (split-color cylinders), `cellGroup` (LineSegments wireframe).

### Element data duplication

`src/parsers/elements.ts` (Node.js) and `src/webview/elements-data.ts` (browser) both contain element lookups. They are separate because the two bundles target different platforms. Keep them in sync.

## Build

```
npm run build       # esbuild dual-entry (extension + webview)
npx tsc --noEmit    # type check only
npx @vscode/vsce package --no-dependencies  # produce .vsix
```

## Reinstall cycle

Single command that builds, packages, installs the VSCode extension, and
installs the Claude `matviz-render` skill:

```
npm run install-all
```

Or step by step:
```
npm run build
npx @vscode/vsce package --no-dependencies
code --install-extension vscode-matviz-0.15.0.vsix --force
npm run install-skill   # copies skills/matviz-render/SKILL.md to ~/.claude/skills/
```

Then reopen an editor tab to pick up changes. When a user asks Claude to
"install matviz", run `npm run install-all` — this covers both the VSCode
extension and the CLI renderer skill in one go.

## Quality gates

Before any commit:
1. `npm run build` — must succeed
2. `npx tsc --noEmit` — zero errors
3. Manual: open a test fixture (`test/fixtures/`) in VSCode, verify rendering

## Conventions

- All parsers output `CrystalStructure`. New format = new parser + register in `src/parsers/index.ts`.
- Webview communicates via typed messages (`src/webview/message.ts`). Add new message types there.
- Three.js objects go into the appropriate group (`atomGroup`, `bondGroup`, `cellGroup`) and get cleaned up in `clearGroup()`.
- Atom rendering uses `InstancedMesh` — one per element type. Do not create individual `Mesh` per atom.
- Bond detection uses spatial hashing; skipped for >5000 atoms.
- CSP in webview HTML must remain strict. Use nonce for scripts.
- Canvas sizing: CSS `width/height: 100%` drives layout; `renderer.setSize(w, h, false)` to preserve it.

## CLI renderer (`scripts/render.ts` → `dist/render.js`)

Headless PNG renderer — same parsers and rendering model as the VSCode extension,
but driven by CLI args. Uses Puppeteer + SwiftShader for software WebGL2.

```bash
node dist/render.js <input> [options]
```

See `~/.claude/skills/matviz-render/SKILL.md` for the full option reference and
recipes. Key flags: `-o <path>`, `--style`, `--view`, `--supercell a,b,c`,
`--palette dark|light`, `--bg <color>`, `--no-bonds`, `--no-boundary`, `--no-cell`.

When extending the CLI renderer:
- Keep parsing logic in `src/parsers/` (shared with webview).
- The renderer HTML is generated inline in `scripts/render.ts` — it uses its own
  element data table (a trimmed subset of `elements-data.ts`) since the HTML
  must be self-contained for the Puppeteer page. Keep element colors/radii in
  sync with `elements-data.ts` if they change.
- Chromium flags `--enable-unsafe-swiftshader --allow-file-access-from-files`
  are required — do not remove.
- **Always keep `skills/matviz-render/SKILL.md` in sync with `scripts/render.ts`.**
  Any change to CLI flags, defaults, recipes, or supported formats must land in the
  same commit as the SKILL.md update. A PostToolUse hook in
  `.claude/settings.json` prints a reminder when CLI files are edited without
  touching SKILL.md; treat that reminder as a hard stop before commit. README.md
  also lists CLI flags — update there too.

## Test fixtures

`test/fixtures/` — nacl.cif, silicon.poscar, graphene.xsf, buckyball.xyz, alanine.pdb, h2o.cube, LiF-polaron-isolevel.xsf, and more. Add new fixtures for each new format or edge case.

## File formats supported

CIF, POSCAR/CONTCAR/VASP, XSF, XYZ, PDB, Gaussian Cube, CHGCAR, QE output, FHI-aims geometry.in. Auto-detection fallback in `src/parsers/index.ts`.

---

## Workflow

Version-based phases. Each version is a phase with sub-steps (features).

### Document pipeline per version

1. **`plans/v{N}_{name}.md`** — version plan: goal, scope, feature list.
2. **`plans/v{N}_{name}_impl.md`** — implementation spec: concrete parameters, file paths, per-feature recipe. **Update in place** as work progresses.
3. **`working/v{N}_feat{M}_{name}.md`** — per-feature completion log. Autonomous — no approval needed.
4. **`plans/archives/`** — move plan pair here after version release.

### Approval points (sparse)

Features are implemented autonomously. Request approval only at:
- **Version kickoff** — after writing `plans/v{N}_*.md` pair, before starting work.
- **Decision gates in `Plan.md`** — each gate is numbered with a pass criterion.
- **Version release** — before bumping version, packaging, and pushing.

### Autonomous loop boundary

**Continuous run limit**: at most 3 consecutive features without a user check-in. After 3, post progress summary and wait for "continue". Limit is 1 (not 3) for the first feature of any version.

**Mandatory stop triggers**:
1. Build or type-check failure with no obvious fix.
2. Decision gate reached — never self-approve.
3. Unexpected repo state — investigate, don't delete.
4. Ambiguous requirement — don't guess, ask.
5. About to push, publish, or make externally visible changes — confirm first.
6. Visual regression detected in manual testing.
7. Plan drift — wanting to add/reorder features or change a gate criterion.

### After version release

1. Update `STATUS.md` (version, completed, next action).
2. Move `plans/v{N}_*.md` pair to `plans/archives/`.
3. Bump version in `package.json`.
4. Tag commit: `git tag v{N}`.
