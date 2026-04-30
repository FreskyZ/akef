import npfs from 'node:fs';
import fs from 'node:fs/promises';
import readline from 'node:readline/promises';
import yaml from 'yaml';
import { connect, delay } from '../browser/index.ts';
import type * as spec from '../browser/spec-types.ts';

// the log option does not use async, so have to use very sync fs operation to keep the log
const logfile = npfs.openSync('/tmp/autobrowser.log', 'w');
const logs = { push: (v: string) => { npfs.writeSync(logfile, v); npfs.fdatasyncSync(logfile); } } as unknown as string[];

const readlineInterface = readline.createInterface({ input: process.stdin, output: process.stdout });
const pressAnyKeyToContinue = async () => await readlineInterface.question('input anything to continue');

const client = await connect({ logs });
if (!client) { console.log(`failed to connect`); process.exit(1); }
console.log(`session ${client.session.id}`);

client.setPageId((await client.getPages())[0].id);
console.log(`devtools url: ${client.getDevToolsFrontEndURL()}`);
if (process.argv.some(a => a == 'pause')) { await pressAnyKeyToContinue(); }
const machinesPageURL = 'https://wiki.skland.com/endfield/catalog?typeMainId=1&typeSubId=5';
await client.navigate(machinesPageURL, 'interactive');

interface Machine {
    name: string, // only this is used
}
interface Item {
    name: string,
    icon: string,
    kind?: 'seed' | 'liquid' | 'bottle' | 'filled',
    version: number,
    desc: string,
}
interface Recipe {
    machine: string, // name
    inputs: { name: string, count: number }[],
    outputs: { name: string, count: number }[],
    time: number,
    name: string,
    kind?: 'pour',
}
const items = JSON.parse(await fs.readFile('data/item.json', 'utf-8')) as Item[];
const recipes = JSON.parse(await fs.readFile('data/recipe.json', 'utf-8')) as Recipe[];
const machines = yaml.parse(await fs.readFile('data/machine.yml', 'utf-8')).machines as Machine[];

// recipe does not bring id on its own, for now, use all of its content, input+machine+output
function isRecipeSame(r1: Recipe, r2: Recipe) {
    // need to handle different order in input and output array
    if (r1.machine != r2.machine) { return false; }
    if (r1.inputs.length != r2.inputs.length) { return false; }
    if (r1.outputs.length != r2.outputs.length) { return false; }
    for (const r1input of r1.inputs) {
        if (!r2.inputs.some(i => i.name == r1input.name && i.count == r1input.count)) { return false; }
    }
    for (const r2input of r2.inputs) {
        if (!r1.inputs.some(i => i.name == r2input.name && i.count == r2input.count)) { return false; }
    }
    for (const r1output of r1.outputs) {
        if (!r2.outputs.some(o => o.name == r1output.name && o.count == r1output.count)) { return false; }
    }
    for (const r2output of r2.outputs) {
        if (!r1.outputs.some(o => o.name == r2output.name && o.count == r2output.count)) { return false; }
    }
    return true;
}

async function getRecipesForMachine(machineName: string) {
    console.log(`get recipes for machine ${machineName}`);

    // you need to query name elements every time, they are invalidated after navigation
    let nameElementsRetryCount = 0;
    // you actually can query the direct element to host item names,
    // and click them will bubble into the main card container to open the detail page
    let cardNameElements: spec.script.NodeRemoteValue[] = [];
    while (cardNameElements.length == 0) {
        try {
            await client.waitElements('div.MedicineCard__Title-bfcsTh', 1);
            // .container>.option>.option-wrapper?>.text-wrapper?>textnode need maxdepth 4
            cardNameElements = await client.querySelectorAll('div.MedicineCard__Title-bfcsTh', { maxDepth: 1 });
        } catch {
            // ignore wait element timeout
        }
        nameElementsRetryCount += 1;
        if (cardNameElements.length == 0 && nameElementsRetryCount >= 10) {
            console.log(`retry load card elements 10 times not work?`);
            return;
        }
    }

    const cardNameElement = cardNameElements.find(e => e?.value?.children?.[0]?.value?.nodeValue == machineName);
    if (!cardNameElement) {
        console.log(`machine name not found ${machineName}`);
        return;
    }

    await client.call(((e: any) => e.scrollIntoView()).toString(), [cardNameElement]);
    // fix complete page display error
    await client.call((() => document.querySelector('main').scrollTop = 0).toString(), []);
    // TODO I think this can await navigation event
    // but currently the way to find navigated is that element invalidated and throw error?
    let navigationRetryCount = 0;
    while (true) {
        try {
            await client.click(cardNameElement);
            await delay(1);
        } catch {
            break;
        }
        navigationRetryCount += 1;
        if (navigationRetryCount >= 10) {
            console.log(`click 10 times still not navigation?`);
            await client.navigate(machinesPageURL, 'interactive');
            return;
        }
    }
    await client.waitElements('table.Table__TableContent-fSUBOI', 10);
    await delay(5); // ?

    // // records are all in these major tables
    // let tables = Array.from(document.querySelectorAll('table.Table__TableContent-fSUBOI'));
    // // flat select tr records, filter out header tr by child td count = 3
    // // NOTE this still does not filter out all header rows, still need to handle invalid row later
    // let tablerows = tables.flatMap(table => Array.from(table.querySelectorAll('tr')).filter(tr => Array.from(tr.querySelectorAll('td')).length == 3));
    // // foreach tr, td[0] is input, td[1] is output, td[2] is time
    // // for td[0] and td[1], elements are grouped in this span.entrywrapper
    // for (let tablerow of tablerows) {
    //     let inputElements = Array.from(tablerow.children[0].querySelectorAll('span.Entry__Wrapper-fAkcVW'));
    //     let inputs = inputElements.map(e => [e.querySelector('span.text')?.innerText, e.querySelector('span.cover-count')?.innerText]);
    //     let outputElements = Array.from(tablerow.children[1].querySelectorAll('span.Entry__Wrapper-fAkcVW'));
    //     let outputs = outputElements.map(e => [e.querySelector('span.text')?.innerText, e.querySelector('span.cover-count')?.innerText]);
    //     // this include s: '2s'
    //     let time = tablerow.children[2].innerText;
    // }
    const evalResult = await client.call((function() {
        return Array.from(document.querySelectorAll('table.Table__TableContent-fSUBOI'))
            .flatMap(table => Array.from(table.querySelectorAll('tr')).filter(tr => Array.from(tr.querySelectorAll('td')).length == 3))
            .map(tr => [
                Array.from(tr.children?.[0]?.querySelectorAll('span.Entry__Wrapper-fAkcVW') ?? [])
                    // @ts-ignore
                    .map(e => [e.querySelector('span.text')?.innerText, e.querySelector('span.cover-count')?.innerText]),
                Array.from(tr.children?.[1]?.querySelectorAll('span.Entry__Wrapper-fAkcVW') ?? [])
                    // @ts-ignore
                    .map(e => [e.querySelector('span.text')?.innerText, e.querySelector('span.cover-count')?.innerText]),
                // @ts-ignore
                tr.children?.[2]?.innerText,
            ]);
    }).toString(), []);
    logs.push(JSON.stringify(evalResult));
    
    if (evalResult.type != 'success') {
        console.log(`eval result not success? ${JSON.stringify(evalResult)}`);
        await client.go(-1);
        return;
    } else if (evalResult.result.type != 'array') {
        console.log(`eval result type not array? ${JSON.stringify(evalResult)}`);
        await client.go(-1);
        return;
    }

    let newRecipeCount = 0;
    // each record matches one table row matches one recipe
    for (const record of evalResult.result.value) {
        if (record.type != 'array') {
            console.log(`record type not array? ${JSON.stringify(record)}`); continue;
        } else if (record.value.length != 3) {
            console.log(`record value not array length 3? ${JSON.stringify(record)}`); continue;
        }
        
        // time first, filter out table headers
        if (record.value[2].type != 'string') {
            console.log(`record value[2] type not string, assume table header`); continue;
        }
        let timeMatch = /^(\d+)s$/.exec(record.value[2].value);
        if (!timeMatch) {
            console.log(`record value[2] unknown string format, assume table header, ${record.value[2].value}`); continue;
        }
        const time = +timeMatch[1];

        if (record.value[0].type != 'array') {
            console.log(`record value[0] type not array? ${JSON.stringify(record.value[0])}`); continue;
        }
        let inputHasError = false;
        const inputs: Recipe['inputs'] = [];
        for (const itemRecord of record.value[0].value) {
            if (itemRecord.type != 'array') {
                console.log(`item record type not array? ${JSON.stringify(itemRecord)}`); inputHasError = true; continue;
            } else if (itemRecord.value.length == 2) {
                // first element is name, second element is count
                if (itemRecord.value[0].type != 'string') {
                    console.log(`item record name is not string?, ${JSON.stringify(itemRecord)}`); inputHasError = true; continue;
                }
                if (itemRecord.value[1].type == 'string') {
                    inputs.push({ name: itemRecord.value[0].value, count: +itemRecord.value[1].value });
                // element for bottle's filled liquid, use count 0 to indicate that
                } else if (itemRecord.value[1].type == 'undefined') {
                    inputs.push({ name: itemRecord.value[0].value, count: 0 });
                } else {
                    console.log(`item record count is not string and undefined?, ${JSON.stringify(itemRecord)}`); inputHasError = true; continue;
                }
            } else {
                console.log(`item record element length not 2? ${JSON.stringify(itemRecord)}`); inputHasError = true; continue;
            }
        }
        if (inputHasError) { continue; }
        if (inputs.length == 0) {
            console.log(`input empty? assume as temporary invalid format`); continue;
        }
        inputs.sort((i1, i2) => i1.name.localeCompare(i2.name));

        if (record.value[1].type != 'array') {
            console.log(`record value[1] type not array? ${JSON.stringify(record.value[1])}`); continue;
        }
        let outputHasError = false;
        const outputs: Recipe['outputs'] = [];
        for (const itemRecord of record.value[1].value) {
            if (itemRecord.type != 'array') {
                console.log(`item record type not array? ${JSON.stringify(itemRecord)}`); outputHasError = true; continue;
            } else if (itemRecord.value.length == 2) {
                // first element is name, second element is count
                if (itemRecord.value[0].type != 'string') {
                    console.log(`item record name is not string?, ${JSON.stringify(itemRecord)}`); outputHasError = true; continue;
                }
                if (itemRecord.value[1].type == 'string') {
                    outputs.push({ name: itemRecord.value[0].value, count: +itemRecord.value[1].value });
                // element for bottle's filled liquid, use count 0 to indicate that
                } else if (itemRecord.value[1].type == 'undefined') {
                    // ATTENTION HARDCODE
                    if (machineName == '扩容反应池' && inputs[0].name == '息壤' && inputs[1].name == '清水' && itemRecord.value[0].value == '液化息壤') {
                        outputs.push({ name: itemRecord.value[0].value, count: 1 });
                    } else {
                        outputs.push({ name: itemRecord.value[0].value, count: 0 });
                    }
                } else {
                    console.log(`item record count is not string and undefined?, ${JSON.stringify(itemRecord)}`); outputHasError = true; continue;
                }
            } else {
                console.log(`item record element length not 2? ${JSON.stringify(itemRecord)}`); outputHasError = true; continue;
            }
        }
        if (outputHasError) { continue; }
        outputs.sort((o1, o2) => o1.name.localeCompare(o2.name));
        // NOTE output is empty is correct for 污水处理 for now

        const newRecipe: Recipe = { name: 'unknown', time, inputs, outputs, machine: machineName };
        if (!recipes.some(r => isRecipeSame(r, newRecipe))) {
            newRecipeCount += 1;
            recipes.push(newRecipe);
            console.log(`new recipe ${machineName},${time}s, ${inputs
                .map(i => `${i.name}x${i.count}`).join('+')} => ${outputs.map(i => `${i.name}x${i.count}`).join('+')}`);
        }
    }
    console.log(`new recipes for ${machineName}: ${newRecipeCount}`);

    await delay(3); // wait for my human eye
    await client.go(-1);
}

for (const machine of machines) {
    await getRecipesForMachine(machine.name);
}

for (const recipe of recipes) {
    const display = `${recipe.machine},${recipe.time}s, ${recipe.inputs
        .map(i => `${i.name}x${i.count}`).join('+')} => ${recipe.outputs.map(i => `${i.name}x${i.count}`).join('+')}`;

    // validate item name
    const invalidItemNames = recipe.inputs.filter(input => !items.some(item =>
        input.name == item.name)).concat(recipe.outputs.filter(output => !items.some(item => output.name == item.name)));
    if (invalidItemNames.length) {
        console.log(`recipe ${display} unknown item name? ${invalidItemNames.join(',')}`);
        continue;
    }

    // merge liquid into bottle
    // check all count = 0 only happen when 2 items and nonezero is bottle and zero is liquid
    // UPDATE has count = 3, in that case, the non zero items must contains exactly one bottle
    if (recipe.inputs.some(i => i.count == 0)) {
        const zeroItemName = recipe.inputs.find(i => i.count == 0).name;
        const zeroItem = items.find(i => i.name == zeroItemName);
        if (zeroItem.kind != 'liquid') {
            console.log(`recipe ${display} looks like filled bottle but zero item is not liquid?`); continue;
        }
        if (recipe.inputs.length == 2) {
            const nonZeroItemCount = recipe.inputs.find(i => i.count != 0);
            if (!nonZeroItemCount) {
                console.log(`recipe ${display} has both input with count 0?`); continue;
            }
            const nonZeroItem = items.find(i => i.name == nonZeroItemCount.name);
            if (nonZeroItem.kind != 'bottle') {
                console.log(`recipe ${display} looks like filled bottle but non zero item is not bottle?`); continue;
            }
            recipe.inputs = [{ name: `${nonZeroItem.name} (${zeroItemName})`, count: nonZeroItemCount.count }];
            console.log(`recipe ${display} fix input to be ${recipe.inputs[0].name}x${recipe.inputs[0].count}`);
        } else if (recipe.inputs.length > 2) {
            const bottleItemCounts = recipe.inputs.filter(i => i.count != 0
                && items.find(item => item.name == i.name && item.kind == 'bottle'));
            if (bottleItemCounts.length != 1) {
                console.log(`recipe ${display} looks like filled bottle but no exactly 1 non zero item with kind=bottle?`); continue;
            }
            recipe.inputs = [{ name: `${bottleItemCounts[0].name} (${zeroItemName})`, count: bottleItemCounts[0].count }];
            console.log(`recipe ${display} fix input to be ${recipe.inputs[0].name}x${recipe.inputs[0].count}`);
        } else {
            console.log(`recipe ${display} looks like filled bottle but input count is not 1?`); continue;
        }
    }
    if (recipe.outputs.some(i => i.count == 0)) {
        const zeroItemName = recipe.outputs.find(i => i.count == 0).name;
        const zeroItem = items.find(i => i.name == zeroItemName);
        if (zeroItem.kind != 'liquid') {
            console.log(`recipe ${display} looks like filled bottle but zero item is not liquid?`); continue;
        }
        if (recipe.outputs.length == 2) {
            const nonZeroItemCount = recipe.outputs.find(i => i.count != 0);
            if (!nonZeroItemCount) {
                console.log(`recipe ${display} has both output with count 0?`); continue;
            }
            const nonZeroItem = items.find(i => i.name == nonZeroItemCount.name);
            if (nonZeroItem.kind != 'bottle') {
                console.log(`recipe ${display} looks like filled bottle but non zero item is not bottle?`); continue;
            }
            recipe.outputs = [{ name: `${nonZeroItem.name} (${zeroItemName})`, count: nonZeroItemCount.count }];
            console.log(`recipe ${display} fix output to be ${recipe.outputs[0].name}x${recipe.outputs[0].count}`);
        } else if (recipe.outputs.length > 2) {
            const bottleItemCounts = recipe.outputs.filter(i => i.count != 0
                && items.find(item => item.name == i.name && item.kind == 'bottle'));
            if (bottleItemCounts.length != 1) {
                console.log(`recipe ${display} looks like filled bottle but no exactly 1 non zero item with kind=bottle?`); continue;
            }
            recipe.outputs = [{ name: `${bottleItemCounts[0].name} (${zeroItemName})`, count: bottleItemCounts[0].count }];
            console.log(`recipe ${display} fix output to be ${recipe.outputs[0].name}x${recipe.outputs[0].count}`);
        } else {
            console.log(`recipe ${display} looks like filled bottle but output count is not 1?`); continue;
        }
    }
    
    // mark kind=pour, they are excluded in some logic
    if (recipe.inputs.length == 1 && recipe.outputs.length == 2
        && items.some(i => i.name == recipe.inputs[0].name && i.kind == 'filled')
        && items.some(i => recipe.outputs.some(o => i.name == o.name && i.kind == 'bottle'))
        && items.some(i => recipe.outputs.some(o => i.name == o.name && i.kind == 'liquid'))
    ) {
        recipe.kind = 'pour';
        if (recipe.name == 'unknown') {
            recipe.name = `倾倒${recipe.inputs[0].name}`;
        }
    }

    // name recipe
    if (recipe.name == 'unknown') {
        // single recipe to single product TODO keep the name when condition not meet?
        if (recipe.outputs.length == 1 && !recipes.some(r =>
            r !== recipe && r.outputs.length == 1 && r.outputs[0].name == recipe.outputs[0].name))
        {
            recipe.name = `${recipe.outputs[0].name}生产`;
            console.log(`name for single product single recipe: ${recipe.name}`);
        // multiple recipe to single product, with single input,
        // for this recipe, regardless of other recipes, *but* cannot duplicate with other recipes
        } else if (recipe.outputs.length == 1
            /* && multiple recipe */
            && recipe.inputs.length == 1
            && !recipes.some(r => r !== recipe
                && r.outputs.length == 1
                && r.outputs[0].name == recipe.outputs[0].name
                && r.inputs.length == 1
                && r.inputs[0].name == recipe.inputs[0].name))
        {
            recipe.name = `${recipe.outputs[0].name}生产 (${recipe.inputs[0].name})`;
            console.log(`name for single product, but multiple recipe, but single input: ${recipe.name}`);
        // no output, 污水处理
        } else if (recipe.outputs.length == 0 && recipe.inputs.length == 1) {
            recipe.name = `${recipe.inputs[0].name}处理`;
            console.log(`name for waste process: ${recipe.name}`);
        } else {
            console.log(`still not named: ${display}`);
        }
        // others are manual for now, still can abstract a few rules but too complex to write in code
        // - for same recipe in 反应池 and 扩容反应池, add (扩容) to normal name
        // - 赤铜块, 赫铜溶液 is single recipe to single product with multiple input, it can use normal {}生产 format
        // - 惰性壤晶废液 special name 惰性壤晶废液再利用
        // - 致密晶体粉末 and 致密碳粉末 's 砂叶粉末 related recipe is not named, they can follow
        //   multiple recipe to single product with single input regarding 砂叶粉末 as auxiliary input
    }
    // no duplicate name
    if (recipe.name != 'unknown' && recipes.some(r => r !== recipe && r.name == recipe.name)) {
        console.log(`duplicate recipe name ${recipe.name}`);
    }
}

// sort recipes according to content, use string representation for now,
// first by machine name, then input representation and output representation, time is not used in sort
const recipeDisplayForSort = (recipe: Recipe) => `${recipe.machine}, ${recipe.inputs
    .map(i => `${i.name}x${i.count}`).join('+')} => ${recipe.outputs.map(i => `${i.name}x${i.count}`).join('+')}`;
recipes.sort((r1, r2) => recipeDisplayForSort(r1).localeCompare(recipeDisplayForSort(r2)));

// format the json file or else too sparse for human read and edit
let recipeFileContent = '[\n';
for (const { machine, inputs, outputs, name, time, kind } of recipes) {
    // fix property order in display
    recipeFileContent += JSON.stringify({ machine, inputs, outputs, time, name, kind }) + ',\n';
}
recipeFileContent = recipeFileContent.substring(0, recipeFileContent.length - 2);
recipeFileContent += '\n]\n';
await fs.writeFile('data/recipe.json', recipeFileContent);

await client.close(); // ({ drop: true })
npfs.closeSync(logfile);
readlineInterface.close();
