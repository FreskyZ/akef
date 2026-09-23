# /// script
# requires-python = ">=3.14"
# dependencies = [
#     "pillow>=12.3.0",
# ]
# ///

# uv init --script example.py
# uv add --script example.py Pillow
# uv run example.py

import json, base64, pathlib
from PIL import Image

# # 1. from hechen.html inline webp data uri
# with open('public-archive/hechen-item.json') as f:
#     items = json.load(f)
# with open('public-archive/hechen-image.json') as f:
#     item_images = json.load(f)
# for item_id, image_data in item_images.items():
#     item_name = next(d['name'] for d in items if d['id'] == item_id)
#     item_name = item_name.replace('(', '').replace(')', '').replace(' ', '-')
#     # print(item_id, item_name, len(image_data), image_data[:30])
#     with open(f'images-hechen-webp/{item_name}.webp', 'wb') as f:
#         f.write(base64.b64decode(image_data[23:]))

# # 2. convert webp to avif
# for filepath in pathlib.Path('images-webp').iterdir():
#     with Image.open(filepath) as image:
#         image.save(pathlib.Path('images-webp-convert') / filepath.with_suffix('.avif').name)

# # 3. cut item.avif
# with open('recipe/item.json') as f:
#     items = json.load(f)
# with Image.open('recipe/item.avif') as image:
#     for item in items:
#         x, y = item['icon'].split(',')
#         x, y = int(x), int(y)
#         print(f'{item['name']}: {x}, {y}')
#         subimage = image.crop((y * 64, x * 64, y * 64 + 64, x * 64 + 64))
#         subimage.save(f'images-cut-avif/{item['name']}.avif')

# # 4. cut item.png
# with open('recipe/item.json') as f:
#     items = json.load(f)
# with Image.open('recipe/item.png') as image:
#     for item in items:
#         x, y = item['icon'].split(',')
#         x, y = int(x), int(y)
#         print(f'{item['name']}: {x}, {y}')
#         subimage = image.crop((y * 64, x * 64, y * 64 + 64, x * 64 + 64))
#         subimage.save(f'images-cut-png/{item['name']}.avif')

# # 5. original image
# with Image.open('images-original/钢块.png') as image:
#     # image.save('images-original-convert/赤铜块.avif')
#     image2 = image.resize((64, 64))
#     image2.save('images-original-scale-convert/钢块.avif')

# CONCLUSION no difference between all approaches
# windows photo viewer has bug to support these avif formats

# convert to base85 encoded text and store in json
# images = {}
# for filepath in pathlib.Path('images-cut-avif').iterdir():
#     with open(filepath, 'rb') as f:
#         images[filepath.stem] = base64.a85encode(f.read()).decode()
# with open('recipe/icon.json', 'w') as f:
#     f.write(json.dumps(images, ensure_ascii=False, indent=2))
