"""Subset the page fonts to the glyphs used in the source files and write work/fonts.css (inlined woff2).
Run after changing any visible copy:  python3 work/subset-fonts.py <dir with dela.ttf dot.ttf rubik.ttf>"""
import sys,subprocess,base64
from pathlib import Path
S=Path(sys.argv[1])
chars=set(chr(c) for c in range(0x20,0x7f))|set('’‘“”–—…·×©←→↑↓↻◀▶●○★☆♪♥♡⚡✓°')
for f in ['work/dragon-duo.html','work/hobby-counter.css','work/dragon-duo.js','work/dragon-pack-gallery.js','work/dragon-pack-print.js','work/economy/pricing.js','work/economy/market.js']:
    chars|={c for c in Path(f).read_text() if ord(c)>0x7f}
(S/'chars.txt').write_text(''.join(sorted(chars)))
css=[]
for src,fam,weight in [('dela.ttf','Dela Gothic One','400'),('dot.ttf','DotGothic16','400'),('rubik.ttf','Rubik','300 900')]:
    out=S/(src+'.woff2')
    subprocess.run(['pyftsubset',str(S/src),f'--text-file={S/"chars.txt"}','--flavor=woff2',f'--output-file={out}','--layout-features=*','--no-hinting'],check=True)
    css.append(f"@font-face{{font-family:'{fam}';font-weight:{weight};font-display:block;src:url(data:font/woff2;base64,{base64.b64encode(out.read_bytes()).decode()}) format('woff2')}}")
Path('work/fonts.css').write_text('\n'.join(css)+'\n')
print(len(chars),'glyphs')
