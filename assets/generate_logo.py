import math
from PIL import Image, ImageDraw, ImageFilter

SCALE = 4
SIZE = 1024
W = H = SIZE * SCALE

BG = (11, 12, 15, 255)
LINE_UP = (22, 163, 74, 255)      # matches dashboard --up
LINE_DOWN = (220, 38, 38, 255)    # matches dashboard --band-severe
LINE_DOWN_GLOW = (220, 38, 38, 90)

img = Image.new("RGBA", (W, H), BG)

cx0, cx1 = int(W * 0.09), int(W * 0.91)
baseline_y = int(H * 0.56)
span = cx1 - cx0


def x_at(t):
    return cx0 + t * span


# Discrete, escalating foreshocks: four small bumps, each bigger than the last.
bump_centers = [0.10, 0.22, 0.33, 0.43]
bump_amps = [0.012, 0.022, 0.035, 0.052]
bump_width = 0.045

up_points = []
samples = 500
for i in range(samples + 1):
    t = (i / samples) * 0.48
    y = baseline_y
    for bc, amp in zip(bump_centers, bump_amps):
        d = (t - bc) / bump_width
        y -= math.exp(-d * d * 4) * amp * H * math.cos(d * 2.4)
    up_points.append((x_at(t), y))

# Sharp rise into the mainshock spike — still green, this is the climb.
rise_t0 = 0.48
peak_t = 0.525
peak_y = baseline_y - 0.36 * H
for i in range(1, 12):
    t = rise_t0 + (peak_t - rise_t0) * (i / 11)
    frac = i / 11
    y = up_points[-1][1] + (peak_y - up_points[-1][1]) * (frac ** 1.25)
    up_points.append((x_at(t), y))

peak_point = up_points[-1]

# From the peak down: the collapse, then the exhausted trail. Red.
down_points = [peak_point]

trough_t = 0.615
trough_y = baseline_y + 0.26 * H
for i in range(1, 14):
    t = peak_t + (trough_t - peak_t) * (i / 13)
    frac = i / 13
    y = peak_y + (trough_y - peak_y) * (frac ** 0.8)
    down_points.append((x_at(t), y))

settle_end_y = baseline_y + 0.08 * H
end_t = 0.93
for i in range(1, 50):
    t = trough_t + (end_t - trough_t) * (i / 49)
    frac = i / 49
    damp = math.exp(-frac * 5.5)
    y = settle_end_y + (trough_y - settle_end_y) * damp
    down_points.append((x_at(t), y))

line_w = int(5.5 * SCALE)

# Glow on the collapse only — that's the part meant to read as the alert.
glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
gdraw = ImageDraw.Draw(glow)
gdraw.line(down_points, fill=LINE_DOWN_GLOW, width=line_w * 5, joint="curve")
glow = glow.filter(ImageFilter.GaussianBlur(radius=22 * SCALE / 4))
img.alpha_composite(glow)

draw = ImageDraw.Draw(img)
draw.line(up_points, fill=LINE_UP, width=line_w, joint="curve")
draw.line(down_points, fill=LINE_DOWN, width=line_w, joint="curve")

r = line_w // 2
for pt, col in [(up_points[0], LINE_UP), (down_points[-1], LINE_DOWN)]:
    draw.ellipse([pt[0] - r, pt[1] - r, pt[0] + r, pt[1] + r], fill=col)
# Clean round joint exactly at the peak, where green hands off to red.
draw.ellipse([peak_point[0] - r, peak_point[1] - r, peak_point[0] + r, peak_point[1] + r], fill=LINE_DOWN)

out = img.resize((SIZE, SIZE), Image.LANCZOS).convert("RGB")
out.save("/Users/mac/Desktop/Projects/Hackertons/foreshock/assets/logo.png", "PNG")
print("saved")
