# 3 案を 1 枚に並べる（python3 docs/design/warm-compare/src/compose.py）。PC は全体、スマホは最初の 1300px 分。
from PIL import Image, ImageDraw, ImageFont
import os
d=os.path.join(os.path.dirname(__file__),'..')
F=lambda n:ImageFont.truetype('/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf',n)
names={'a':('A  角を少しだけ丸める','角丸 16/8/4 とピル。FINESYSTEM に最も近い'),
       'b':('B  手触りのある紙','紙の質感・手描きの線・傾いたスタンプ'),
       'c':('C  空と地図の絵本','等高線の丘と雲。ティールと淡い水色を差す')}
PW=640; MW=390; GAP=40; PAD=48
cols=[]
for k in 'abc':
    pc=Image.open(f'{d}/{k}-pc.png'); pc=pc.resize((PW,int(pc.height*PW/pc.width)),Image.LANCZOS)
    mo=Image.open(f'{d}/{k}-mobile.png'); mo=mo.crop((0,0,mo.width,2600)).resize((MW,1300),Image.LANCZOS)
    cols.append((k,pc,mo))
H_pc=max(c[1].height for c in cols)
W=PAD*2+PW*3+GAP*2
top=150; lab=70
H=top+lab+H_pc+GAP+lab+1300+PAD
im=Image.new('RGB',(W,H),'#F7F7F3'); g=ImageDraw.Draw(im)
g.text((PAD,40),'そらばん 判定画面　3 案の比較（暖色・ピル型・FINESYSTEM の橙を土台に）',font=F(40),fill='#262523')
g.text((PAD,98),'上：PC 1280px（全体を縮小）　下：スマホ 390px（最初の 1300px 分）',font=F(24),fill='#5F5D57')
for i,(k,pc,mo) in enumerate(cols):
    x=PAD+i*(PW+GAP)
    g.rounded_rectangle((x,top,x+PW,top+52),radius=26,fill='#F89B48')
    g.text((x+22,top+9),names[k][0],font=F(30),fill='#262523')
    g.text((x,top+60),names[k][1],font=F(22),fill='#4A4843')
    y=top+lab+30
    im.paste(pc,(x,y)); g.rectangle((x-1,y-1,x+PW,y+pc.height),outline='#C4C4C4')
    y2=y+H_pc+GAP
    im.paste(mo,(x,y2)); g.rectangle((x-1,y2-1,x+MW,y2+1300),outline='#C4C4C4')
im.save(f'{d}/compare.png'); print(im.size)
