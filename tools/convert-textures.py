# Makes the ground images the game ships (public/assets/ground/) from the 2k JPG downloads of the
# Poly Haven materials listed in CREDITS.md. Not needed to run the game: only to add or change a
# material. Needs Python 3 with Pillow.
#
#   python3 tools/convert-textures.py <folder with the downloads> public/assets/ground
#
# Expected in the download folder, for each material id (names as listed in CREDITS.md):
#   <id>_Diffuse.jpg   <id>_nor_gl.jpg   <id>_Rough.jpg
# Written, for each id and each size 512, 1024, 2048:
#   <id>_a_<size>.webp   colour
#   <id>_n_<size>.webp   one grey image three squares wide: normal x | normal y (OpenGL) | roughness
# The order of the ids must match GROUND_LAYERS in public/game/render/textures.js.
import os
import sys
from PIL import Image

IDS = ['rocky_trail', 'brown_mud_03', 'rubble', 'brown_mud_rocks_01', 'forrest_ground_01']
src, dst = sys.argv[1], sys.argv[2]
os.makedirs(dst, exist_ok=True)
total = {}
for i in IDS:
    a = Image.open(f'{src}/{i}_Diffuse.jpg').convert('RGB')
    n = Image.open(f'{src}/{i}_nor_gl.jpg').convert('RGB')
    r = Image.open(f'{src}/{i}_Rough.jpg').convert('L')
    for size in (512, 1024, 2048):
        p = f'{dst}/{i}_a_{size}.webp'
        a.resize((size, size), Image.LANCZOS).save(p, 'WEBP', quality=78 if size < 2048 else 80, method=6)
        total[size] = total.get(size, 0) + os.path.getsize(p)
        nx, ny, _ = n.resize((size, size), Image.LANCZOS).split()
        strip = Image.new('L', (size * 3, size))
        strip.paste(nx, (0, 0))
        strip.paste(ny, (size, 0))
        strip.paste(r.resize((size, size), Image.LANCZOS), (size * 2, 0))
        p = f'{dst}/{i}_n_{size}.webp'
        strip.save(p, 'WEBP', quality=50, method=6)
        total[size] = total.get(size, 0) + os.path.getsize(p)
print('megabytes per size:', {k: round(v / 1e6, 2) for k, v in total.items()})
