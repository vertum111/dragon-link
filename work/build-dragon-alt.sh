set -eu
# Manual-style alternative page; reuses the same game bundle.
bash work/build-dragon-duo.sh >/dev/null
python3 - <<'PY'
from pathlib import Path
t=Path('work/dragon-duo-alt.html').read_text()
Path('outputs/dragon-link/dragon-link-manual.html').write_text(t.replace('__FONTS_CSS__',Path('work/fonts-alt.css').read_text()).replace('__BUNDLE__',Path('work/dragon-duo.bundle.js').read_text()).replace('__UI__',Path('work/dragon-ui-manual.js').read_text()))
PY
