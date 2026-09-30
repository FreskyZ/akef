import fs from 'node:fs/promises';
import npfs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import yaml from 'yaml';

// validate new dataset against existing data
// the final purpose of this script is remove all existing data and this script itself

// TODO try sort and group items and recipes more logically

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
        event: boolean,
        inputs: { name: string, count: number }[],
        outputs: { name: string, count: number }[],
    }[],
    realFillRecipes: { bottle: string, fluid: string }[],
    // for now for 扩容反应池 recipes overwrite identical 反应池 recipes
    pendingRemovalRecipes: string[],
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

function processDataFile(cx: DataContext, filename: string, originalContent: string) {

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

        const limitedTime = raw.startsWith('活动：');
        const excludeFlag = limitedTime ? raw.substring(3) : raw;

        const splitted1 = excludeFlag.split('=>[').map(x => x.trim());
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
        cx.recipes.push({ name: recipeName, time, machine, vibe, event: limitedTime, inputs, outputs });
    }

    const validateRecipeItemName = (recipeName: string, itemName: string) => {
        if (itemName.includes('-')) {
            const splitted = itemName.split('-');
            if (splitted.length == 2) {
                if (cx.bottles.includes(splitted[0]) && cx.fluids.includes(splitted[1])) {
                    if (!cx.realFillRecipes.some(r => r.bottle == splitted[0] && r.fluid == splitted[1])) {
                        cx.realFillRecipes.push({ bottle: splitted[0], fluid: splitted[1] });
                    }
                    return;
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
    const serializedRecipes: { name: string, value: string }[] = [];
    for (const recipe of cx.recipes) {
        if (cx.pendingRemovalRecipes.includes(recipe.name)) { continue; }

        if (recipe.machine == '种植机' || recipe.machine == '采种机') {
            console.log(`${filename}: recipe ${recipe.name}: don't add plant recipes`);
        }

        recipe.inputs.forEach(i => validateRecipeItemName(recipe.name, i.name));
        recipe.outputs.forEach(o => validateRecipeItemName(recipe.name, o.name));

        if (recipe.inputs.length == 2 && recipe.inputs[0].count == 1 && recipe.inputs[1].count == 1 && (
            cx.bottles.includes(recipe.inputs[0].name) && cx.fluids.includes(recipe.inputs[1].name)
            || cx.fluids.includes(recipe.inputs[0].name) && cx.bottles.includes(recipe.inputs[1].name)
        )) {
            console.log(`${filename}: recipe ${recipe.name}: don't add vanilla fill bottle recipes`);
        }
        if (recipe.outputs.length == 2 && recipe.inputs[0].count == 1 && recipe.inputs[1].count == 1 && (
            cx.bottles.includes(recipe.outputs[0].name) && cx.fluids.includes(recipe.outputs[1].name)
            || cx.fluids.includes(recipe.outputs[0].name) && cx.bottles.includes(recipe.outputs[1].name)
        )) {
            console.log(`${filename}: recipe ${recipe.name}: don't add vanilla pour bottle recipes`);
        }

        const cmp = (i1: { name: string }, i2: { name: string }) => i1.name.localeCompare(i2.name);
        if (recipe.machine == '反应池' || recipe.machine == '扩容反应池') {
            const inputs = [...recipe.inputs].sort(cmp);
            const outputs = [...recipe.outputs].sort(cmp);
            const expectThatMachineName = recipe.machine == '反应池' ? '扩容反应池' : '反应池';

            const identical = cx.recipes.find(that =>
                that.machine == expectThatMachineName && that.time == recipe.time && that.vibe == recipe.vibe
                && that.inputs.length == recipe.inputs.length && that.outputs.length == recipe.outputs.length
                && ![...that.inputs].sort(cmp).some((thatInput, index) => thatInput.name != inputs[index].name || thatInput.count != inputs[index].count)
                && ![...that.outputs].sort(cmp).some((thatOutput, index) => thatOutput.name != outputs[index].name || thatOutput.count != outputs[index].count));
            if (identical) {
                // always edit 扩容反应池 recipe, remove 反应池 recipe
                if (identical.machine == '扩容反应池') {
                    identical.machine = '扩容/反应池';
                    cx.pendingRemovalRecipes.push(recipe.name);
                } else {
                    recipe.machine = '扩容/反应池';
                    cx.pendingRemovalRecipes.push(identical.name);
                }
                if (!cx.machines.includes('扩容/反应池')) { cx.machines.push('扩容/反应池'); }
            }
        }

        const serialized = [
            // this identical check only happens inside this function, so can use localecompare
            [...recipe.inputs].sort(cmp).map(i => `${i.name},${i.count}`).join(','),
            [...recipe.outputs].sort(cmp).map(i => `${i.name},${i.count}`).join(','),
            recipe.machine, recipe.vibe, recipe.time,
        ].filter(x => x).join(',');
        const identical = serializedRecipes.find(r => r.value == serialized);
        if (identical) {
            console.log(`${filename}: recipe ${recipe.name} is identical to ${identical.name}: ${identical.value}`);
        } else {
            serializedRecipes.push({ name: recipe.name, value: serialized });
        }
    }
}

const cx: DataContext = {
    items: [],
    recipes: [],
    realFillRecipes: [],
    pendingRemovalRecipes: [],
    systemInputs: [],
    bottles: [],
    fluids: [],
    machines: [],
    environments: [],
};
for (const filename of (await fs.readdir('recipe/data')).sort((f1, f2) => f1.localeCompare(f2))) {
    if (filename.startsWith('v') && filename.endsWith('.yml')) {
        processDataFile(cx, filename, await fs.readFile(path.join('recipe', 'data', filename), 'utf-8'));
    }
}

// handle pending approval
cx.recipes = cx.recipes.filter(r => !cx.pendingRemovalRecipes.includes(r.name));
// handle real fill recipes
for (const { bottle, fluid } of cx.realFillRecipes) {
    // don't forget none 1+1=1 recipes are allowed
    if (!cx.recipes.some(r =>
        r.machine == '灌装机'
        && r.outputs.length == 1
        && r.outputs[0].name == `${bottle}-${fluid}`
        && r.inputs.length == 2
        && ((r.inputs[0].name == bottle && r.inputs[1].name == fluid)
            || (r.inputs[0].name == fluid && r.inputs[1].name == bottle))
    )) {
        cx.recipes.push({
            name: `${bottle}-${fluid}灌装`,
            machine: '灌装机',
            time: 2,
            event: false,
            inputs: [{ name: bottle, count: 1 }, { name: fluid, count: 1 }],
            outputs: [{ name: `${bottle}-${fluid}`, count: 1 }],
        });
    }
}

const resultdata = {
    'filled-items': cx.realFillRecipes.map(r => `${r.bottle}-${r.fluid}`),
    recipes: cx.recipes.sort((r1, r2) => Buffer.from(r1.name).compare(Buffer.from(r2.name))).map(r => ({
        name: r.name,
        machine: r.machine,
        time: r.time == 2 ? undefined : r.time,
        vibe: r.vibe,
        event: r.event ? r.event : undefined,
        inputs: r.inputs.map(i => ({
            name: i.name,
            count: i.count == 1 ? undefined : i.count,
        })),
        outputs: r.outputs.map(o => ({
            name: o.name,
            count: o.count == 1 ? undefined : o.count,
        })),
    })),
};
let sb = '{"filled-items":[\n  ';
sb += resultdata['filled-items'].map(n => `"${n}"`).join(',');
sb += '\n], "recipes":[\n  ';
sb += resultdata.recipes.map(r => JSON.stringify(r)).join(',\n  ');
sb +='\n]}';

console.log(`make-data.ts: write build/recipe.json`);
await fs.writeFile('build/recipe.json', sb);

// this is used when migrating from 64px grid size to 40px grid size,
// you cannot convert 64px image to 40px image because that will be too much loss,
// use this to collect all item's 396px icon, store locally and use manual import image workflow to update images
async function migrate() {
    // 1. collect images from webpage
    // althoug skland wiki webpage is very antihuman and antiai, you can still get by one line js
    // JSON.stringify(Array.from(document.querySelectorAll('div.sc-fGusXT.hgfSEo')).map(e => ({
    //     name: e.childNodes[1].childNodes[0].innerText,
    //     icon: e.childNodes[0].childNodes[0].childNodes[0].childNodes[1].src,
    // })));
    // // copy text and save in icon/icon.json
    // // 哦牛逼这么简单的代码还让我发现错误了，手动修改实验息壤铜骨架为实验息壤铜骨骼

    // // 2. download all
    const icondata = JSON.parse(await fs.readFile('icon/icon.json', 'utf-8'));
    // download one by one to avoid being rejected by cdn
    for (const { name, icon } of icondata) {
        if (cx.items.includes(name)) {
            const response = await fetch(icon);
            const fileStream = npfs.createWriteStream(`icon/${name}.png`, { flags: 'wx' });
            await finished(Readable.fromWeb(response.body).pipe(fileStream));
        }
    }

    // // 3.0. in this case, need to update make-icon.py for new grid size
    // // 3.1. choose a data file, copy image into data directory
    // const datafile = yaml.parse(await fs.readFile('recipe/data/v1.5.yml', 'utf-8'));
    // for (const itemName of Object.keys(datafile.图标)) {
    //     await fs.copyFile(`icon/${itemName}.png`, `recipe/data/${itemName}.png`);
    // }
    // // 3.2. uv run recipe/make-icon.py add
    // // 3.3. manually move from data/new.yml to selected v.yml
    // // 3.4. rm recipe/data/*.png
    // // 3.5. specify other data file and run again
}
