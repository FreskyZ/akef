# /// script
# requires-python = ">=3.14"
# dependencies = [
#     "pillow>=12.3.0",
#     "pyyaml>=6.0.3",
# ]
# ///

# uv init --script example.py
# uv add --script example.py Pillow
# uv run example.py

import sys, json, base64, pathlib, io
import yaml
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

# with open('recipe/item.json') as f:
#     items = json.load(f)
# sb = '图标:\n'
# with Image.open('recipe/item.avif') as image:
#     for item in items:
#         x, y = item['icon'].split(',')
#         x, y = int(x), int(y)
#         print(f'{item['name']}: {x}, {y}')
#         subimage = image.crop((y * 64, x * 64, y * 64 + 64, x * 64 + 64))
#         with io.BytesIO() as f:
#             subimage.save(f, format='AVIF')
#             sb += '  ' + item['name'] + ': ' + base64.b85encode(f.getvalue()).decode() + '\n'
# with open('recipe/icon.yml', 'w') as f:
#     f.write(sb)

# TODO make-icon.py new: read .png files in data directory and resize and convert format to avif and store in temp.txt file
#      make-icon.py extract {itemname}: extract item icon and put in data directory
#      make-icon.py build: build item.avif spirit sheet

# manually put some image files in data directory, resize and convert to avif and store in temporary new.yml file
def import_images():
    count = 0
    sb = '图标:\n'
    for filepath in pathlib.Path('recipe/data').iterdir():
        if filepath.suffix == '.png':
            count += 1
            with Image.open(filepath) as image:
                small_image = image.resize((64, 64), Image.Resampling.LANCZOS)
                with io.BytesIO() as f:
                    small_image.save(f, format='AVIF')
                    sb += f'  {filepath.stem}: {base64.b85encode(f.getvalue()).decode()}\n'
    if count > 0:
        with open('recipe/data/new.yml', 'w') as f:
            f.write(sb)
    print(f'generate {count} image data in data/new.yml')

# extract icon of item name and put in data directory
def extract_image(item_name):
    for filepath in pathlib.Path('recipe/data').iterdir():
        if filepath.suffix == '.yml':
            with open(filepath) as f:
                datafile = yaml.load(f, Loader=yaml.CLoader)
                if '图标' in datafile and item_name in datafile['图标']:
                    print(f'extracting {item_name} from file {filepath.name}')
                    encoded = datafile['图标'][item_name]
                    decoded = base64.b85decode(encoded)
                    with open(f'recipe/data/{item_name}.avif', 'wb') as f2:
                        f2.write(decoded)
                    return
    print(f'not found item name {item_name}?')

if len(sys.argv) > 1 and sys.argv[1] == 'new':
    import_images()
elif len(sys.argv) > 1 and sys.argv[1] == 'build':
    1
elif len(sys.argv) > 2 and sys.argv[1] == 'extract':
    extract_image(sys.argv[2])
else:
    print('USAGE: make-icon.py new | build | extract ITEMNAME')
