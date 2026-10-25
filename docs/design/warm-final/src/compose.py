# 5 画面を 1 枚に並べる（python3 docs/design/warm-final/src/compose.py）。上：スマホ 5 枚（各 最初の 1500px 分）、下：PC のトップ（最初の 1100px 分）。
from PIL import Image, ImageDraw, ImageFont
import os
d=os.path.join(os.path.dirname(__file__),'..')
F=lambda n:ImageFont.truetype('/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf',n)
H=1500
def load(name,w,crop_h):
    im=Image.open(f'{d}/{name}'); s=w/(im.width/2)
    im=im.resize((int(im.width/2*s),int(im.height/2*s)),Image.LANCZOS)
    return im.crop((0,0,im.width,min(im.height,int(crop_h*s))))
items=[('(a) 判定のトップ','挿絵はここだけ。ヒーロー 232px','top-mobile.png',390,H),
       ('(b) 判定の結果（3 状態）','要手続き／飛行不可／手続き不要','result-mobile.png',900,H),
       ('(c) 運航管理のホーム','次の飛行・次にやること・近づく期限','home-mobile.png',390,H),
       ('(d) 現場の点検（飛行前）','現場モード。64px・動きなし','field-mobile.png',390,H),
       ('(e) 飛行日誌の入力','様式1。5 つの段','journal-mobile.png',390,H)]
GAP=40; PAD=56; top=170
imgs=[load(n,w,h) for _,_,n,w,h in items]
pc=load('top-pc.png',1280,1100)
W=PAD*2+sum(i.width for i in imgs)+GAP*4
Hh=top+60+max(i.height for i in imgs)+80+60+pc.height+PAD
im=Image.new('RGB',(W,Hh),'#F7F7F3'); g=ImageDraw.Draw(im)
g.text((PAD,40),'そらばん 統合案（A の骨格＋C の挿絵をトップだけ）　5 画面',font=F(44),fill='#262523')
g.text((PAD,104),'橙 #F89B48 が主役。判定色は橙と別系統。上：スマホ 390px（各 最初の 1500px 分）　下：PC 1280px のトップ（最初の 1100px 分）',font=F(24),fill='#4A4843')
x=PAD
for (t,s,_,_,_),i in zip(items,imgs):
    tw=int(g.textlength(t,font=F(28)))+44
    g.rounded_rectangle((x,top,x+tw,top+48),radius=24,fill='#F89B48'); g.text((x+22,top+8),t,font=F(28),fill='#262523')
    g.text((x,top+54),s,font=F(20),fill='#4A4843')
    y=top+90
    im.paste(i,(x,y)); g.rectangle((x-1,y-1,x+i.width,y+i.height),outline='#C4C4C4')
    x+=i.width+GAP
y=top+60+max(i.height for i in imgs)+80
t='(a) 判定のトップ　PC'
tw=int(g.textlength(t,font=F(28)))+44
g.rounded_rectangle((PAD,y,PAD+tw,y+48),radius=24,fill='#F89B48'); g.text((PAD+22,y+8),t,font=F(28),fill='#262523')
g.text((PAD+tw+20,y+12),'ヒーロー 320px。入力・結論・地図が最初の画面に入る',font=F(22),fill='#4A4843')
y+=64; im.paste(pc,(PAD,y)); g.rectangle((PAD-1,y-1,PAD+pc.width,y+pc.height),outline='#C4C4C4')
im.save(f'{d}/overview.png'); print(im.size)
