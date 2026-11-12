set -eu
deps="${DRAGON_DEPS:-$HOME/Documents/Codex/2026-11-03/new-chat/work/dragon-caps/node_modules}"  # folder with esbuild + three
NODE_PATH="$deps:$PWD/server/node_modules" "$deps/esbuild/bin/esbuild" work/dragon-duo.js --bundle --minify --loader:.glb=binary --loader:.svg=dataurl --loader:.png=dataurl --alias:util=./work/chain/util-shim.js --define:global=globalThis --outfile=work/dragon-duo.bundle.js
python3 - <<'PY'
from pathlib import Path
t=Path('work/dragon-duo.html').read_text()
Path('outputs/dragon-link/dragon-link-3d.html').write_text(t.replace('__COUNTER_CSS__',Path('work/hobby-counter.css').read_text()).replace('__FONTS_CSS__',Path('work/fonts.css').read_text()).replace('__BUNDLE__',Path('work/dragon-duo.bundle.js').read_text()))
PY
