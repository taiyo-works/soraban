# 配色の文字コントラストを検査する（python3 src/contrast.py）
def lum(h):
    h=h.lstrip('#'); r,g,b=[int(h[i:i+2],16)/255 for i in (0,2,4)]
    f=lambda c:c/12.92 if c<=0.03928 else ((c+0.055)/1.055)**2.4
    return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b)
def cr(a,b):
    x,y=sorted([lum(a),lum(b)],reverse=True); return (x+.05)/(y+.05)
INK='#262523'; W='#FFFFFF'; OFF='#F7F7F3'; BEI='#EDEDE5'
pairs=[
 ('ink/white',INK,W),('ink/off',INK,OFF),('ink/beige',INK,BEI),
 ('ink/orange F89B48',INK,'#F89B48'),('ink/orange-light FFC189',INK,'#FFC189'),
 ('placeholder 68655B/white','#68655B',W),('placeholder/beige','#68655B',BEI),
 ('ink-2 4A4843/beige','#4A4843',BEI),('ink-3 5F5D57/beige','#5F5D57',BEI),
 ('white/no A81D28',W,'#A81D28'),('ink/needs EDB800',INK,'#EDB800'),
 ('off/done ink',OFF,INK),('white/none 225F36',W,'#225F36'),('white/unknown 4F5762',W,'#4F5762'),
 ('unknown/white 4F5762','#4F5762',W),('unknown/beige','#4F5762',BEI),
 ('no-fg 9A1A24/beige','#9A1A24',BEI),('needs-fg 6B5800/beige','#6B5800',BEI),
 ('none-fg 225F36/beige','#225F36',BEI),
 ('teal-deep 0F6B70/white','#0F6B70',W),('teal-deep/paleblue DEF3F4','#0F6B70','#DEF3F4'),
 ('ink/paleblue',INK,'#DEF3F4'),('ink/teal 2EBEC4',INK,'#2EBEC4'),
 ('ink/kincha D7A761',INK,'#D7A761'),('ink/pink CF727C',INK,'#CF727C'),
 ('white/pink CC6595',W,'#CC6595'),('ink/pink CC6595',INK,'#CC6595'),
 ('orange-text B85A14/white','#A8480A',W),
 ('edge 77746B/white','#77746B',W),('edge/beige','#77746B',BEI),
]
for n,a,b in pairs: print(f"{cr(a,b):5.2f}  {n}")
