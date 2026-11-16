"""Make a dark-mode version of a notebook-style card image: neutral paper/ink tones are flipped to the M2
dark palette (paper #0d1117, ink #f0f6fc); saturated colours (fills, belts, mic, red pen) are kept.
Usage: python recolor.py <in.png> <out.png> [x0,y0,x1,y1 ...]  (areas kept as they are, e.g. a dark TV screen)"""
import sys
import numpy as np
from PIL import Image

PAPER_D = np.array([0x0d, 0x11, 0x17], float)
INK_D = np.array([0xf0, 0xf6, 0xfc], float)
L_INK, L_PAPER = 0.16, 0.95      # luminance of the light card's ink (#2b2520) and paper (#fbf6e9)

im = Image.open(sys.argv[1]).convert('RGBA')
a = np.asarray(im).astype(float)
rgb, alpha = a[..., :3], a[..., 3:]
mx, mn = rgb.max(-1), rgb.min(-1)
chroma = (mx - mn) / 255          # absolute chroma: very dark ink counts as neutral even if slightly tinted
lum = (0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]) / 255
t = np.clip((lum - L_INK) / (L_PAPER - L_INK), 0, 1)[..., None]
flipped = INK_D * (1 - t) + PAPER_D * t
keep = np.clip((chroma - 0.12) / 0.15, 0, 1)[..., None]   # 0 = neutral (flip), 1 = colourful (keep)
out = flipped * (1 - keep) + rgb * keep
for box in sys.argv[3:]:
    x0, y0, x1, y1 = map(int, box.split(','))
    out[y0:y1, x0:x1] = rgb[y0:y1, x0:x1]
Image.fromarray(np.concatenate([out, alpha], -1).clip(0, 255).astype(np.uint8), 'RGBA').save(sys.argv[2], optimize=True)
