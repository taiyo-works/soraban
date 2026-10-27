# 暗の 3 画面を 1 枚に並べる（python3 docs/design/warm-final/dark/src/compose-dark.py）。各画面の最初の 1500px 分。上の帯に説明。
from PIL import Image, ImageDraw, ImageFont
import os
d=os.path.join(os.path.dirname(__file__),'..')
F=lambda n:ImageFont.truetype('/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf',n)
H=1500
def load(name,w,crop_h):
    im=Image.open(f'{d}/{name}').convert('RGB'); s=w/(im.width/2)
    im=im.resize((int(im.width/2*s),int(im.height/2*s)),Image.LANCZOS)
    return im.crop((0,0,im.width,min(im.height,int(crop_h*s))))
items=[('(a) 判定のトップ','暗でも挿絵はここだけ。丘は茶と深い青緑、空は暗い青緑','top-mobile.png',390,H),
       ('(b) 判定の結果（3 状態）','明るい塗り＋暗い文字に反転。形（△×○）と言葉は同じ','result-mobile.png',900,H),
       ('(c) 運航管理のホーム','橙の面は明と同じ。右端の丸は明るい丸＋墨の矢印','home-mobile.png',390,H)]
GAP=44; PAD=56; top=190
imgs=[load(n,w,h) for _,_,n,w,h in items]
W=PAD*2+sum(i.width for i in imgs)+GAP*(len(imgs)-1)
Hh=top+120+max(i.height for i in imgs)+PAD
BG='#121110'; INK='#F1EEE7'; INK2='#D3CFC5'
im=Image.new('RGB',(W,Hh),BG); g=ImageDraw.Draw(im)
g.text((PAD,40),'そらばん 暗い表示（v2）　3 画面',font=F(44),fill=INK)
g.text((PAD,104),'OS の暗い設定。地は温かい黒 #1B1A18／#252421／#121110。橙 #F89B48 は暗でも主役で、橙の面の上の文字は墨。影は使わず 1px の輪郭。',font=F(24),fill=INK2)
g.text((PAD,138),'スマホ 390px（各 最初の 1500px 分）。結果は 3 状態を横に並べた 900px 幅。地図タイルは明るいまま、明るさだけ 0.8 に落とす案。',font=F(24),fill=INK2)
x=PAD
for (t,s,_,_,_),i in zip(items,imgs):
    tw=int(g.textlength(t,font=F(28)))+44
    g.rounded_rectangle((x,top,x+tw,top+48),radius=24,fill='#F89B48'); g.text((x+22,top+8),t,font=F(28),fill='#262523')
    # 説明は列の幅で折り返す（隣の列に重ならないように）
    line='';ly=top+54
    for ch in s:
        if g.textlength(line+ch,font=F(19))>i.width: g.text((x,ly),line,font=F(19),fill=INK2); ly+=26; line=ch
        else: line+=ch
    g.text((x,ly),line,font=F(19),fill=INK2)
    y=top+120
    im.paste(i,(x,y)); g.rectangle((x-1,y-1,x+i.width,y+i.height),outline='#45433F')
    x+=i.width+GAP
im.save(f'{d}/overview-dark.png'); print(im.size)
