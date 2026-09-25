import fs from 'node:fs/promises';
import path from 'node:path';
import yaml from 'yaml';

// validate new dataset against existing data
// the final purpose of this script is remove all existing data and this script itself

interface DataContext {
    items: {
        name: string,
        icon: string,
    }[],
    recipes: {
        name: string,
        machine: string,
        time: number,
        vibe?: string,
        inputs: { name: string, count: number }[],
        outputs: { name: string, count: number }[],
    }[],
    // for validation
    // system inputs are input items for the overall production system,
    // include plants, minerals and other items only come from manual collection action
    systemInputs: string[],
    bottles: string[],
    // fluid includes liquid and gas if you ask
    fluids: string[],
    machines: string[],
    environments: string[],
}

function processData(cx: DataContext, filename: string, originalContent: string) {

    const newDataFile: {
        配方: Record<string, string>,
        类别?: Record<string, string[]>,
        图标: Record<string, string>,
    } = yaml.parse(originalContent);

    for (const [itemName, itemIcon] of Object.entries(newDataFile.图标)) {
        if (cx.items.some(i => i.name == itemName)) {
            console.log(`${filename}: item ${itemName} duplicate name`);
        } else {
            cx.items.push({ name: itemName, icon: itemIcon });
        }
    }
    for (const [key, itemNames] of Object.entries(newDataFile.类别 ?? {})) {
        const itemKinds = {
            '植物': 'systemInputs', '矿物': 'systemInputs', '瓶子': 'bottles', '流体': 'fluids' };
        for (const itemName of itemNames) {
            if (key in itemKinds) {
                const propertyName = itemKinds[key];
                if (!cx.items.some(i => i.name == itemName)) {
                    console.log(`${filename}: item ${itemName} from kind ${key} not found`);
                } else if (cx[propertyName].includes(itemName)) {
                    console.log(`${filename}: item ${itemName} from kind ${key} duplicate`);
                } else {
                    cx[propertyName].push(itemName);
                }
            } else if (key == '机器') {
                if (cx.machines.includes(itemName)) {
                    console.log(`${filename}: machine ${itemName} duplicate name`);
                } else {
                    cx.machines.push(itemName);
                }
            } else if (key == '环境') {
                if (cx.environments.includes(itemName)) {
                    console.log(`${filename}: environments ${itemName} duplicate name`);
                } else {
                    cx.environments.push(itemName);
                }
            } else {
                console.log(`${filename}: unknown key ${key}`);
            }
        }
    }

    for (const [recipeName, raw] of Object.entries(newDataFile.配方)) {
        if (cx.recipes.some(r => r.name == recipeName)) {
            console.log(`${filename}: recipe ${recipeName} duplicate name`);
            continue;
        }
        // if you forget, most punctuations don't fit in css dataset selector
        if (['+', '&', ' ', '(', ')'].some(c => recipeName.includes(c))) {
            console.log(`${filename}: recipe ${recipeName} includes invalid character`);
        }

        const splitted1 = raw.split('=>[').map(x => x.trim());
        if (splitted1.length != 2) {
            console.log(`${filename}: recipe ${recipeName}: invalid format, expect one =>[`);
            continue;
        }
        const [rawInput, rawConditionAndOutputs] = splitted1;
        const splitted2 = rawConditionAndOutputs.split(']=>').map(x => x.trim());
        if (splitted2.length != 2) {
            console.log(`${filename}: recipe ${recipeName}: invalid format, expect one ]=>`);
            continue;
        }
        const [rawCondition, rawOutput] = splitted2;

        const inputs = rawInput.split('+').map(x => x.trim()).map(rawItemAndCount => {
            const match = /^(\d+)/.exec(rawItemAndCount);
            const count = match ? +match[1] : 1;
            if (match && count == 1) {
                console.log(`${filename}: recipe ${recipeName}: input ${rawItemAndCount} no need to add 1`);
            }
            const itemName = match ? rawItemAndCount.substring(match[1].length) : rawItemAndCount;
            return { count, name: itemName };
        });
        const outputs = rawOutput == '无'
            ? []
            : rawOutput.split('+').map(x => x.trim()).map(rawItemAndCount => {
                const match = /^(\d+)/.exec(rawItemAndCount);
                const count = match ? +match[1] : 1;
                if (match && count == 1) {
                    console.log(`${filename}: recipe ${recipeName}: output ${rawItemAndCount} no need to add 1`);
                }
                const itemName = match ? rawItemAndCount.substring(match[1].length) : rawItemAndCount;
                return { count, name: itemName };
            });

        const conditions = rawCondition.split('+').map(x => x.trim());
        let machine: string;
        let time = 2;
        let vibe: string = undefined;
        for (const condition of conditions) {
            if (cx.machines.includes(condition)) {
                machine = condition;
            } else if (condition.endsWith('环境')) {
                const environment = condition.substring(0, condition.length - 2);
                if (cx.environments.includes(environment)) {
                    vibe = environment;
                } else {
                    console.log(`${filename}: recipe ${recipeName}: unknown environment`);
                }
            } else if (condition.endsWith('s')) {
                time = +condition.substring(0, condition.length - 1);
                if (isNaN(time)) {
                    console.log(`${filename}: recipe ${recipeName}: unknown time`);
                } else if (time == 2) {
                    console.log(`${filename}: recipe ${recipeName}: no need to write explicit 2s`);
                }
            } else {
                console.log(`${filename}: recipe ${recipeName}: unknown condition ${condition}`);
            }
        }
        cx.recipes.push({ name: recipeName, time, machine, vibe, inputs, outputs });
    }

    const validateRecipeItemName = (recipeName: string, itemName: string) => {
        if (itemName.includes('-')) {
            const splitted = itemName.split('-');
            if (splitted.length == 2) {
                if (cx.bottles.includes(splitted[0]) && cx.fluids.includes(splitted[1])) {
                    return; // ok
                }
            }
        }
        if (!cx.items.some(i => i.name == itemName)) {
            console.log(`${filename}: recipe ${recipeName} item ${itemName} not found`);
        }
    };
    for (const item of cx.items) {
        if (!cx.recipes.some(r => r.inputs.some(i => i.name == item.name) || r.outputs.some(o => o.name == item.name))) {
            console.log(`${filename}: item ${item.name}: not used in recipes`);
        } else if (!cx.systemInputs.includes(item.name) && !cx.recipes.some(r => r.outputs.some(o => o.name == item.name))) {
            console.log(`${filename}: item ${item.name}: not found in recipe outputs need to be declared in plants or minerals`);
        }
    }
    for (const recipe of cx.recipes) {
        if (recipe.machine == '种植机' || recipe.machine == '采种机') {
            console.log(`${filename}: recipe ${recipe.name}: don't add plant recipes`);
        }

        recipe.inputs.forEach(i => validateRecipeItemName(recipe.name, i.name));
        recipe.outputs.forEach(o => validateRecipeItemName(recipe.name, o.name));

        if (recipe.inputs.length == 2 && (
            cx.bottles.includes(recipe.inputs[0].name) && cx.fluids.includes(recipe.inputs[1].name)
            || cx.fluids.includes(recipe.inputs[0].name) && cx.bottles.includes(recipe.inputs[1].name)
        )) {
            console.log(`${filename}: recipe ${recipe.name}: don't add fill bottle recipes`);
        }
        if (recipe.outputs.length == 2 && (
            cx.bottles.includes(recipe.outputs[0].name) && cx.fluids.includes(recipe.outputs[1].name)
            || cx.fluids.includes(recipe.outputs[0].name) && cx.bottles.includes(recipe.outputs[1].name)
        )) {
            console.log(`${filename}: recipe ${recipe.name}: don't add pour bottle recipes`);
        }
    }
    // TODO identical recipe check
    // TODO goes through wiki's facility pages to confirm all recorded
}

const cx: DataContext = {
    items: [],
    recipes: [],
    systemInputs: [],
    bottles: [],
    fluids: [],
    machines: [],
    environments: [],
};
for (const filename of (await fs.readdir('recipe/data')).sort((f1, f2) => f1.localeCompare(f2))) {
    if (filename.startsWith('v') && filename.endsWith('.yml')) {
        processData(cx, filename, await fs.readFile(path.join('recipe', 'data', filename), 'utf-8'));
    }
}

const olddata1 = yaml.parse(await fs.readFile('recipe/data.yml', 'utf-8'));
for (const recipeName of Object.keys(olddata1.配方)) {
    // console.log(recipeName);
    if (!cx.recipes.some(r => r.name == recipeName)) {
        console.log(`old recipe ${recipeName} not found?`);
    }
}
const olddata2 = JSON.parse(await fs.readFile('recipe/item.json', 'utf-8'));
for (const olditem of olddata2) {
    // console.log(olditem.name);
    if (!cx.items.some(i => i.name == olditem.name)) {
        console.log(`old item ${olditem.name} not found?`);
    }
}

    // const resultdata = {
    //     items: [], // TODO coordinates
    //     recipes: recipes.map(r => ({
    //         name: r.name,
    //         machine: r.machine,
    //         time: r.time == 2 ? undefined : r.time,
    //         vibe: r.vibe,
    //         inputs: r.inputs.map(i => ({
    //             name: i.name,
    //             count: i.count == 1 ? undefined : i.count,
    //         })),
    //         outputs: r.outputs.map(o => ({
    //             name: o.name,
    //             count: o.count == 1 ? undefined : o.count,
    //         })),
    //     })),
    // };
    // let sb = '';
    // sb += '{"items":[\n';
    // sb += '],"recipes":[\n  ';
    // sb += resultdata.recipes.map(r => JSON.stringify(r)).join(',\n  ');
    // sb += '\n]}';
    // return sb;

