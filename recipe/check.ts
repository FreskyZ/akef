import fs from 'node:fs/promises';

// try to use recipe/recipe.json and recipe/item.json as compare base
// recipe/item.json
interface ItemData1 {
    name: string,
    icon: string,
    version: number,
    desc: string,
    kind?: string,
}
// recipe/recipe.json
interface RecipeData1 {
    machine: string,
    inputs: { name: string, count: number }[],
    outputs: { name: string, count: number }[],
    time: number,
    name: string,
    kind?: string,
}

const itemdata1: ItemData1[] = JSON.parse(await fs.readFile('recipe/item.json', 'utf-8'));
const recipedata1: RecipeData1[] = JSON.parse(await fs.readFile('recipe/recipe.json', 'utf-8'));

// compare to data/item-updated.json
// RESULT: position difference
// const itemdata2: ItemData1[] = JSON.parse(await fs.readFile('data/item-updated.json', 'utf-8'));
// for (const item1 of itemdata1) {
//     const item2 = itemdata2.find(i2 => i2.name == item1.name);
//     if (!item2) {
//         console.log(`item ${item1.name} in item1 but not in item2`);
//         continue;
//     }
//     if (item1.icon != item2.icon) {
//         // see results
//         // console.log(`item ${item1.name} icon ${item1.icon} != ${item2.icon}`);
//     }
//     if (item1.version != item2.version) {
//         console.log(`item ${item1.name} version ${item1.version} != ${item2.version}`);
//     }
//     if (item1.kind != item2.kind) {
//         console.log(`item ${item1.name} kind ${item1.kind ?? '(empty)'} != ${item2.kind ?? '(empty)'}`);
//     }
//     if (item1.desc != item2.desc) {
//         console.log(`item ${item1.name} desc\n${item1.desc}\n${item2.desc}`);
//     }
// }
// for (const item2 of itemdata2) {
//     const item1 = itemdata1.find(i1 => i1.name == item2.name);
//     if (!item1) {
//         console.log(`item ${item2.name} in item2 but not in item1`);
//     }
// }

// sort item1 and item2 and check the real difference between positions
// itemdata1.sort((a, b) => {
//     const [x1, y1] = a.icon.split(',').map(x => +x);
//     const [x2, y2] = b.icon.split(',').map(x => +x);
//     return x1 * 100 + y1 - x2 * 100 - y2;
// });
// await fs.writeFile('data/items-sorted.json', '[\n' + itemdata1.map(d => JSON.stringify(d)).join(',\n') + '\n]');
// itemdata2.sort((a, b) => {
//     const [x1, y1] = a.icon.split(',').map(x => +x);
//     const [x2, y2] = b.icon.split(',').map(x => +x);
//     return x1 * 100 + y1 - x2 * 100 - y2;
// });
// await fs.writeFile('data/items-updated-sorted.json', '[\n' + itemdata2.map(d => JSON.stringify(d)).join(',\n') + '\n]');

// RESULT
// itemdata1 recipe/item.json is consistent with data/item.avif
// itemdata2 data/item-update.json comes from make-icon.rs fix_coordinates
//     that is, reassign coordinates with the layout iter with removing filled items
//     note that filled items are already removed from itemdata1, but the removed spirit table is missing, it will eventually be needed

// compare to public/recipe.json, data/recipe-old-struct-new-data.json, they are same
interface ItemData3 {
    id: string,
    icon: string,
    name: string,
    kind: string,
    desc: [string, string],
}
interface RecipeData3 {
    id: string,
    name: string,
    time: number,
    machineId: string,
    ingredients: { id: string, count: number }[],
    products: { id: string, count: number }[],
    kind?: string,
}
const itemrecipedata3: {
    items: ItemData3[],
    recipes: RecipeData3[],
} = JSON.parse(await fs.readFile('public/recipe.json', 'utf-8'));

for (const item1 of itemdata1) {
    const item3 = itemrecipedata3.items.find(i3 => i3.name == item1.name);
    if (!item3) {
        // RESULT: all of these are food that not produced by machines
        // console.log(`item ${item1.name} in item1 but not in item3`);
        continue;
    }
    if (item3.id != item3.name) {
        console.log(`item ${item1.name} id not same with name? ${item3.id}`);
    }
    if (item1.icon != item3.icon) {
        console.log(`item ${item1.name} icon not same ${item1.icon} != ${item3.icon}`);
    }
    if (item1.kind != item3.kind) {
        // RESULT: missing some kind=bottle in item3, all item1.kind==bottle have matching item.kind == empty
        if (item1.kind == 'bottle') {
            if (item3.kind) {
                console.log(`item ${item1.name} kind ${item1.kind} but item3.kind not empty? ${item3.kind}`);
            }
        } else {
            console.log(`item ${item1.name} kind ${item1.kind ?? '(empty)'} != ${item3.kind ?? '(empty)'}`);
        }
    }
    if (item1.desc != item3.desc.join('+')) {
        console.log(`item ${item1.name} desc\n${item1.desc}\n${item3.desc.join('+')}`);
    }
}
for (const item3 of itemrecipedata3.items) {
    const item1 = itemdata1.find(i1 => i1.name == item3.name);
    if (!item1) {
        // RESULT: all of these are filled items
        // console.log(`item ${item3.name} in item3 but not in item1`);
        continue;
    }
}
// RESULT for items: result items should exclude both filled and without recipe items
//       note that should include filled items with valid recipe

// add hardcoded recipe data in make-page
recipedata1.push({
    name: '重息壤生产',
    machine: '天有洪炉',
    inputs: [{ name: '息壤', count: 10 }, { name: '壤晶废液', count: 10 }],
    outputs: [{ name: '重息壤', count: 1 }],
    time: 10,
});
recipedata1.push({
    name: '赫铜装备原件生产',
    machine: '装备原件机',
    inputs: [{ name: '重息壤', count: 2 }, { name: '赫铜零件', count: 2 }],
    outputs: [{ name: '赫铜装备原件', count: 1 }],
    time: 10,
});
recipedata1.push({
    name: '赫铜零件生产',
    machine: '配件机',
    inputs: [{ name: '赫铜块', count: 5 }],
    outputs: [{ name: '赫铜零件', count: 1 }],
    time: 10,
});
let okcount1 = 0;
for (const recipe1 of recipedata1) {
    const recipe3 = itemrecipedata3.recipes.find(r3 => r3.name == recipe1.name);
    if (!recipe3) {
        console.log(`recipe ${recipe1.name} in recipe1 but not in recipe3`);
        continue;
    }
    if (recipe3.id != recipe3.name) {
        console.log(`recipe ${recipe1.name} id not same with name`);
    }
    if (recipe1.time != recipe3.time) {
        console.log(`recipe ${recipe1.name} time not same ${recipe1.time} != ${recipe3.time}`);
    }
    if (recipe1.kind != recipe3.kind) {
        console.log(`recipe ${recipe1.name} kind not same ${recipe1.kind ?? '(empty)'} != ${recipe3.kind ?? '(empty)'}`);
    }
    if (recipe1.machine != recipe3.machineId) {
        console.log(`recipe ${recipe1.name} machine not same ${recipe1.machine} != ${recipe3.machineId}`);
    }
    if (recipe1.inputs.length != recipe3.ingredients.length) {
        console.log(`recipe ${recipe1.name} inputs length not same`);
    } else {
        for (let inputIndex = 0; inputIndex < recipe1.inputs.length; inputIndex += 1) {
            if (recipe1.inputs[inputIndex].name != recipe3.ingredients[inputIndex].id) {
                console.log(`recipe ${recipe1.name} input index ${inputIndex} item not same ${recipe1.inputs[inputIndex].name} != ${recipe3.ingredients[inputIndex].id}`);
                continue;
            }
            if (recipe1.inputs[inputIndex].count != recipe3.ingredients[inputIndex].count) {
                console.log(`recipe ${recipe1.name} input index ${inputIndex} count not same ${recipe1.inputs[inputIndex].count} != ${recipe3.ingredients[inputIndex].count}`);
                continue;
            }
            okcount1 += 1;
        }
    }
    if (recipe1.outputs.length != recipe3.products.length) {
        console.log(`recipe ${recipe1.name} outputs length not same`);
    } else {
        for (let outputIndex = 0; outputIndex < recipe1.outputs.length; outputIndex += 1) {
            if (recipe1.outputs[outputIndex].name != recipe3.products[outputIndex].id) {
                console.log(`recipe ${recipe1.name} output index ${outputIndex} item not same ${recipe1.outputs[outputIndex].name} != ${recipe3.products[outputIndex].id}`);
                continue;
            }
            if (recipe1.outputs[outputIndex].count != recipe3.products[outputIndex].count) {
                console.log(`recipe ${recipe1.name} output index ${outputIndex} count not same ${recipe1.outputs[outputIndex].count} != ${recipe3.products[outputIndex].count}`);
                continue;
            }
            okcount1 += 1;
        }
    }
}
// console.log(okcount1);
for (const recipe3 of itemrecipedata3.recipes) {
    const recipe1 = recipedata1.find(r1 => r1.name == recipe3.name);
    if (!recipe1) {
        console.log(`recipe ${recipe3.name} in recipe1 but not in recipe3`);
    }
}
// RESULT: very same

// compare data/items-test.json
const itemdata4: ItemData1[] = JSON.parse(await fs.readFile('data/items-test.json', 'utf-8'));
for (const item1 of itemdata1) {
    const item4 = itemdata4.find(i4 => i4.name == item1.name);
    if (!item4) {
        console.log(`item ${item1.name} in item1 but not in item4`);
        continue;
    }
    if (item1.icon != item4.icon) {
        // RESULT 赫铜零件 and 重息壤 has url icon in item4
        console.log(`item ${item1.name} icon not same ${item1.icon} != ${item4.icon}`);
    }
    if (item1.kind != item4.kind) {
        console.log(`item ${item1.name} kind ${item1.kind ?? '(empty)'} != ${item4.kind ?? '(empty)'}`);
    }
    if (item1.desc != item4.desc) {
        console.log(`item ${item1.name} desc\n${item1.desc}\n${item4.desc}`);
        // RESULT double quote mark not same, I unified quote marks in description text
        for (let charIndex = 0; charIndex < item1.desc.length && charIndex < item4.desc.length; charIndex += 1) {
            if (item1.desc.charAt(charIndex) != item4.desc.charAt(charIndex)) {
                console.log(`char index ${charIndex}, ${item1.desc.charAt(charIndex)} != ${item4.desc.charAt(charIndex)}`)
            }
        }
    }
}
for (const item4 of itemdata4) {
    const item1 = itemdata1.find(i1 => i1.name == item4.name);
    if (!item1) {
        // RESULT: filled items
        // console.log(`item ${item4.name} in item4 but not in item1`);
        continue;
    }
}

// self integration check, duplicate name, recipe referenced item can be found in items
const itemNames: string[] = [];
for (const item of itemdata1) {
    if (itemNames.includes(item.name)) {
        console.log(`duplicate item name ${item.name}`);
    } else {
        itemNames.push(item.name);
    }
}

const recipeNames: string[] = [];
for (const recipe of recipedata1) {
    if (recipeNames.includes(recipe.name)) {
        console.log(`duplicate recipe name ${recipe.name}`);
    } else {
        recipeNames.push(recipe.name);
    }
    // exclude pour and fill
    // RESULT need filled items in valid recipes (not pour and fill recipes)
    if (recipe.kind == 'pour' || recipe.name.endsWith(')生产')) {
        continue;
    }
    for (const input of recipe.inputs) {
        if (!itemNames.includes(input.name)) {
            console.log(`recipe ${recipe.name} unknown item name ${input.name}`);
        }
    }
    for (const output of recipe.outputs) {
        if (!itemNames.includes(output.name)) {
            console.log(`recipe ${recipe.name} unknown item name ${output.name}`);
        }
    }
}

// CONCLUTION
// - remove all fill and pour recipes
// - remove items without recipe
// - remove item.avif entry after clean up items
// - add kind=gas for items
