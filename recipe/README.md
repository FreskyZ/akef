### Yet Another Recipe Tree

the main user story of this program is for me to look at multiple recipes while designing aic regarding
the poor interaction functionality of the in game recipe display, compare to common aic recipe tools, this program

- is very small and fast
- don't include calculation, I don't use structured calculation tool for these kind of games, include factorio
- don't include full data, obvious recipes not included, like bottle fill and pour recipes and seed and plant recipes

workflow

- after game update, add item names, append item kinds and add recipes manually,
  run make-data.ts, fix errors, this create build/recipe.json
- download item icons and put in data directory manually,
  run make-icon.py add, move icon data from data/new.yml to real data file manually, clear image files and delete new.yml
- run make-icon.py build, this create build/item.json and build/item.avif
- run make-page.ts, this merge item data and recipe data, create build/data.json,
  minify index.css, transpile and mifify index.js, and inline them into index.html to create build/index.html
- deploy new index.html, data.json and item.avif
