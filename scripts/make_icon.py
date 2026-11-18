# 產生程式圖示：小柯機器人＋文字稿與照片 → 影片（場記板＋播放鍵）
import os
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = 1024
NAVY = (29, 59, 79, 255)


def layer():
    return Image.new('RGBA', (S, S), (0, 0, 0, 0))


def shadow(img, box, r, blur=20, alpha=90, dy=24):
    sh = layer()
    x0, y0, x1, y1 = box
    ImageDraw.Draw(sh).rounded_rectangle((x0 + 8, y0 + dy, x1 + 8, y1 + dy), r, fill=(0, 0, 0, alpha))
    return Image.alpha_composite(img, sh.filter(ImageFilter.GaussianBlur(blur)))


img = layer()
bg = layer()
d = ImageDraw.Draw(bg)
d.rounded_rectangle((36, 36, 988, 988), 190, fill=NAVY)
d.rounded_rectangle((70, 70, 954, 954), 164, fill=(246, 241, 232, 255))
img = Image.alpha_composite(img, bg)

# --- 文字稿（左上）：白紙＋文字行 -------------------------------------------------------
doc = (110, 300, 400, 640)
img = shadow(img, doc, 30)
c = ImageDraw.Draw(img)
c.rounded_rectangle(doc, 30, fill=(255, 255, 255, 255), outline=(214, 205, 190, 255), width=6)
for i, w in enumerate((200, 220, 170, 210, 140)):
    y = doc[1] + 60 + i * 52
    c.rounded_rectangle((doc[0] + 40, y, doc[0] + 40 + w, y + 20), 10, fill=(150, 160, 170, 255))

# --- 照片（文字稿右下、疊在上面）：山與太陽 -------------------------------------------
ph = layer()
p = ImageDraw.Draw(ph)
px0, py0, px1, py1 = 250, 520, 560, 780
p.rounded_rectangle((px0, py0, px1, py1), 26, fill=(255, 255, 255, 255))
p.rounded_rectangle((px0 + 18, py0 + 18, px1 - 18, py1 - 18), 14, fill=(120, 190, 225, 255))
p.ellipse((px1 - 110, py0 + 40, px1 - 50, py0 + 100), fill=(255, 200, 70, 255))
p.polygon([(px0 + 18, py1 - 18), (px0 + 120, py0 + 110), (px0 + 200, py1 - 70), (px0 + 230, py0 + 140), (px1 - 18, py1 - 18)], fill=(40, 130, 90, 255))
ph = ph.rotate(-8, resample=Image.BICUBIC, center=((px0 + px1) / 2, (py0 + py1) / 2))
sh = layer()
ImageDraw.Draw(sh).rounded_rectangle((px0 + 10, py0 + 26, px1 + 10, py1 + 26), 26, fill=(0, 0, 0, 90))
img = Image.alpha_composite(img, sh.rotate(-8, center=((px0 + px1) / 2, (py0 + py1) / 2)).filter(ImageFilter.GaussianBlur(20)))
img = Image.alpha_composite(img, ph)

# --- 箭頭 -------------------------------------------------------------------------------
a = ImageDraw.Draw(img)
AMBER = (224, 154, 43, 255)
a.rounded_rectangle((585, 600, 660, 640), 18, fill=AMBER)
a.polygon([(650, 565), (650, 675), (712, 620)], fill=AMBER)

# --- 影片：深色場記板＋播放鍵（右下） ---------------------------------------------------
vb = (690, 470, 940, 800)
vid = layer()
v = ImageDraw.Draw(vid)
x0, y0, x1, y1 = 700, 520, 930, 790
v.rounded_rectangle((x0, y0, x1, y1), 30, fill=(30, 40, 52, 255))
# 場記板頂條（斜紋）
v.rounded_rectangle((x0, y0 - 64, x1, y0 - 4), 16, fill=(30, 40, 52, 255))
for i in range(5):
    sx = x0 + 14 + i * 46
    v.polygon([(sx, y0 - 8), (sx + 24, y0 - 8), (sx + 44, y0 - 60), (sx + 20, y0 - 60)], fill=(255, 255, 255, 255))
# 播放鍵
cx, cy = (x0 + x1) // 2, (y0 + y1) // 2 + 6
v.ellipse((cx - 70, cy - 70, cx + 70, cy + 70), fill=(27, 154, 108, 255))
v.polygon([(cx - 22, cy - 38), (cx - 22, cy + 38), (cx + 42, cy)], fill=(255, 255, 255, 255))
img = shadow(img, (x0, y0 - 64, x1, y1), 30)
img = Image.alpha_composite(img, vid)

# --- 小柯機器人（右上） -----------------------------------------------------------------
rb = layer()
r_ = ImageDraw.Draw(rb)
cx, cy = 720, 270
s = 0.62


def R(p, q, u, w):
    return (cx + p * s, cy + q * s, cx + u * s, cy + w * s)


r_.line((cx, cy - 250 * s, cx, cy - 190 * s), fill=(90, 100, 120, 255), width=16)
r_.ellipse(R(-34, -290, 34, -222), fill=(255, 196, 40, 255))
r_.rounded_rectangle(R(-262, -70, -210, 80), 20, fill=(40, 120, 220, 255))
r_.rounded_rectangle(R(210, -70, 262, 80), 20, fill=(40, 120, 220, 255))
r_.ellipse(R(-230, -210, 230, 220), fill=(70, 150, 240, 255))
r_.ellipse(R(-214, -196, 214, 200), fill=(240, 246, 255, 255))
r_.rounded_rectangle(R(-170, -110, 170, 90), int(90 * s), fill=(24, 36, 64, 255))
for ex in (-72, 72):
    r_.arc(R(ex - 46, -50, ex + 46, 30), 200, 340, fill=(90, 230, 255, 255), width=18)
r_.arc(R(-50, 10, 50, 70), 20, 160, fill=(90, 230, 255, 255), width=12)
r_.ellipse(R(-160, 40, -110, 80), fill=(255, 140, 160, 200))
r_.ellipse(R(110, 40, 160, 80), fill=(255, 140, 160, 200))
sh2 = layer()
ImageDraw.Draw(sh2).ellipse(R(-240, -190, 260, 260), fill=(0, 0, 0, 110))
img = Image.alpha_composite(img, sh2.filter(ImageFilter.GaussianBlur(22)))
img = Image.alpha_composite(img, rb)

os.makedirs(os.path.join(ROOT, 'build'), exist_ok=True)
img.save(os.path.join(ROOT, 'build', 'icon.png'))
img.save(os.path.join(ROOT, 'build', 'icon.ico'), sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
pub = os.path.join(ROOT, 'public')
os.makedirs(pub, exist_ok=True)
img.resize((512, 512), Image.LANCZOS).save(os.path.join(pub, 'icon-512.png'))
img.resize((192, 192), Image.LANCZOS).save(os.path.join(pub, 'icon-192.png'))
img.resize((180, 180), Image.LANCZOS).save(os.path.join(pub, 'apple-touch-icon.png'))
img.resize((64, 64), Image.LANCZOS).save(os.path.join(pub, 'favicon.png'))
img.resize((128, 128), Image.LANCZOS).save(os.path.join(pub, 'logo.png'))
print('icon ok')
