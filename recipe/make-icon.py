# /// script
# requires-python = ">=3.14"
# dependencies = [
#     "pillow>=12.3.0",
#     "pypinyin>=0.55.0",
#     "pyyaml>=6.0.3",
# ]
# ///

# uv init --script example.py
# uv add --script example.py Pillow
# uv run example.py

import sys, json, base64, pathlib, io, math
import pypinyin
import yaml
from PIL import Image

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

UNIT_SIZE = 40
# manually put some image files in data directory, resize and convert to avif and store in temporary new.yml file
def import_images():
    count = 0
    sb = '图标:\n'
    for filepath in pathlib.Path('recipe/data').iterdir():
        if filepath.suffix == '.png':
            count += 1
            with Image.open(filepath) as image:
                small_image = image.resize((UNIT_SIZE, UNIT_SIZE), Image.Resampling.LANCZOS)
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

def build_spirit_sheet():
    items = [] # (name, icon string, [grid x, grid y])[]
    for filepath in pathlib.Path('recipe/data').iterdir():
        if filepath.suffix == '.yml':
            with open(filepath) as f:
                datafile = yaml.load(f, Loader=yaml.CLoader)
                if '图标' in datafile:
                    # TODO this .items, or the yaml.load seems do not preserve dict order, fix by order result item list by utf8 bytes
                    for item_name, item_icon in datafile['图标'].items():
                        items.append((item_name, item_icon, [0, 0]))
    items.sort(key=lambda i: i[0].encode('utf-8'))
    grid_width = int(math.ceil(len(items) ** 0.5))
    grid_height = grid_width if len(items) > grid_width * (grid_width - 1) else grid_width - 1
    with Image.new('RGBA', (grid_width * UNIT_SIZE, grid_height * UNIT_SIZE), (0, 0, 0, 0)) as result_image:
        for index, (item_name, item_icon_encoded, coordinate) in enumerate(items):
            # the old code (if you blame this file and find in make-icon.rs) use a strange layout
            # to wind the icons from top level corner gradually, that's because old data structure
            # persists icon position information so I want to avoid changing old item's coordinate,
            # but now this coordinate is generated dynamically and not tracked so use a simple one
            # by one line by line layout
            coordinate[0] = int(math.floor(index / grid_width))
            coordinate[1] = index - grid_width * coordinate[0]
            # print(f'{item_name}: {coordinate}')
            with io.BytesIO(base64.b85decode(item_icon_encoded)) as item_bytes:
                with Image.open(item_bytes) as item_image:
                    result_image.paste(item_image, (UNIT_SIZE * coordinate[1], UNIT_SIZE * coordinate[0]))
        print('make-icon.py: generate build/item.avif')
        result_image.save('build/item.avif')
    print('make-icon.py: write build/item.json')
    with open('build/item.json', 'w') as f:
        sb = '[\n'
        for name, _, coordinate in items:
            # add pinyin here, python is too good at nlp so pinyin package
            # is reasonably reliable, compare to nodejs and rust's search result
            pinyin = ''.join([c[0] for c in pypinyin.pinyin(name, style=pypinyin.Style.NORMAL)])
            sb += f'  {{"name":"{name}","pinyin":"{pinyin}","icon":[{coordinate[0]},{coordinate[1]}]}},\n'
        sb = sb[:-2] + '\n]'
        f.write(sb)

if len(sys.argv) > 1 and sys.argv[1] == 'add':
    import_images()
elif len(sys.argv) > 1 and sys.argv[1] == 'build':
    build_spirit_sheet()
elif len(sys.argv) > 2 and sys.argv[1] == 'extract':
    extract_image(sys.argv[2])
else:
    print('USAGE: make-icon.py add | build | extract ITEMNAME')
