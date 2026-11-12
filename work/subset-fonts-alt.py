"""Fonts for the manual variant: Zen Kaku Gothic New + Zen Old Mincho, subset to used glyphs -> work/fonts-alt.css.
Canvas-only fonts (packaging print, LCD) come from work/fonts.css. Run: python3 work/subset-fonts-alt.py"""
import subprocess,base64,tempfile
from pathlib import Path
src=Path('work/fonts-src')
chars=set(chr(c) for c in range(0x20,0x7f))|set('’‘“”–—…·×©←→↑↓↻◀▶●○★☆♪♥♡⚡✓°⇧　')
for f in ['work/dragon-duo-alt.html','work/dragon-duo.js','work/dragon-ui-manual.js','work/economy/pricing.js','work/economy/market.js']:
    chars|={c for c in Path(f).read_text() if ord(c)>0x7f}
tmp=Path(tempfile.mkdtemp());(tmp/'c.txt').write_text(''.join(sorted(chars)))
css=[]
for f,fam,w in [('ZenKakuGothicNew-Regular','Zen Kaku Gothic New',400),('ZenKakuGothicNew-Bold','Zen Kaku Gothic New',700),('ZenKakuGothicNew-Black','Zen Kaku Gothic New',900),
                ('ZenOldMincho-Regular','Zen Old Mincho',400),('ZenOldMincho-Bold','Zen Old Mincho',700)]:
    out=tmp/(f+'.woff2')
    subprocess.run(['pyftsubset',str(src/(f+'.ttf')),f'--text-file={tmp/"c.txt"}','--flavor=woff2',f'--output-file={out}','--layout-features=*','--no-hinting'],check=True)
    b=out.read_bytes();print(f,len(b))
    css.append(f"@font-face{{font-family:'{fam}';font-weight:{w};font-display:block;src:url(data:font/woff2;base64,{base64.b64encode(b).decode()}) format('woff2')}}")
Path('work/fonts-alt.css').write_text(Path('work/fonts.css').read_text()+'\n'.join(css)+'\n')
