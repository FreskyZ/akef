import fs from 'node:fs/promises';
import { styleText } from 'node:util';
import ts from 'typescript';
import yaml from 'yaml';

interface ItemData {
    name: string,
    kind?: 'seed' | 'liquid' | 'bottle' | 'filled',
    icon: string,
    desc: string,
    version: number,
}
interface MachineData {
    name: string,
    power: number,
    size: [number, number],
}
interface RecipeData {
    machine: string,
    inputs: { name: string, count: number }[],
    outputs: { name: string, count: number }[],
    time: number,
    name: string,
    kind?: 'pour',
}

interface OldItemData extends ItemData {
    id: string,
}
interface OldMachineData extends MachineData {
    id: string,
}
interface OldRecipeData {
    id: string,
    name: string,
    // exclude pour in some situations
    // is pour = machineId == 'dismantler_1' && products.length == 2 && one contains('bottle') && one contains('liquid')
    kind?: 'pour',
    machineId: string,
    ingredients: { id: string, count: number }[],
    products: { id: string, count: number }[],
    time: number,
}

const items = JSON.parse(await fs.readFile('data/item.json', 'utf-8')) as ItemData[];
const machines = yaml.parse(await fs.readFile('data/machine.yml', 'utf-8')).machines as MachineData[];
const recipes = JSON.parse(await fs.readFile('data/recipe.json', 'utf-8')) as RecipeData[];
const olddata = JSON.parse(await fs.readFile('data/recipes-old.json', 'utf-8')) as { items: OldItemData[], machines: OldMachineData[], recipes: OldRecipeData[] };

// validate old items are in new items
// RESULT: ok, minor desc difference, so you can use old items to map name to id
for (const olditem of olddata.items) {
    const newitem = items.find(i => i.name == olditem.name);
    if (!newitem) {
        console.log(`item ${olditem.name} in old but not in new?`);
    } else {
        // // no kind in olditem, really?
        // if (olditem.kind != newitem.kind) {
        //     console.log(`item ${olditem.name} kind ${olditem.kind} != ${newitem.kind}`);
        // }
        // // some of them are updated description in public version, but more of them are typo in wiki site ???
        // const newdesc = newitem.desc.split('+');
        // if (olditem.desc[0].trim() != newdesc[0] || olditem.desc[1].trim() != newdesc[1]) {
        //     console.log(`item ${olditem.name} desc diff`);
        //     console.log(`"${olditem.desc[0]}"+"${olditem.desc[1].trim()}"\n"${newdesc[0]}"+"${newdesc[1]}"`);
        //     const oldbuffer = Buffer.from(`${olditem.desc[0]}+${olditem.desc[1]}`);
        //     const newbuffer = Buffer.from(`${newdesc[0]}+${newdesc[1]}`);
        //     console.log(`old buffer length ${oldbuffer.length} new buffer length ${newbuffer.length}`);
        //     console.log(oldbuffer.toHex());
        //     console.log(oldbuffer.toHex());
        //     for (let index = 0; index < Math.min(oldbuffer.length, newbuffer.length); ++index) {
        //         if (oldbuffer.at(index) != newbuffer.at(index)) {
        //             console.log(`byte index ${index} difference ${oldbuffer.at(index)} != ${newbuffer.at(index)}`)
        //         }
        //     }
        // }
    }
}
for (const oldmachine of olddata.machines) {
    const newmachine = machines.find(m => m.name == oldmachine.name);
    if (!newmachine) {
        console.log(`machine ${oldmachine.name} in old but not in new?`);
    } else {
        if (newmachine.power != oldmachine.power) {
            console.log(`machine ${oldmachine.name} power diff ${oldmachine.power} != ${newmachine.power}`);
        }
        if (newmachine.size[0] != oldmachine.size[0] || oldmachine.size[1] != newmachine.size[1]) {
            console.log(`machine ${oldmachine.name} size diff ${oldmachine.size.join(',')} != ${newmachine.size.join(',')}`);
        }
    }
}
for (const oldrecipe of olddata.recipes) {
    const oldmachine = olddata.machines.find(m => m.id == oldrecipe.machineId).name;
    const oldinputs = oldrecipe.ingredients
        .map(i => ({ name: olddata.items.find(item => item.id == i.id).name, count: i.count }));
    // missing 赤铜粉末 in hardcode added data for 1.1, fix the hardcode ok
    for (const oldoutput of oldrecipe.products) {
        if (!olddata.items.some(item => item.id == oldoutput.id)) {
            console.log(`not found id for old recipe product ${JSON.stringify(oldoutput)}`);
        }
    }
    const oldoutputs = oldrecipe.products
        .map(i => ({ name: olddata.items.find(item => item.id == i.id).name, count: i.count }));
    const olddisplay = `${oldmachine},${oldinputs.map(i => `${i.name}x${i.count}`).join('+')}=>${oldoutputs.map(i => `${i.name}x${i.count}`).join('+')}`;
    const newrecipe = recipes.find(r =>
        r.machine == oldmachine
        && r.inputs.length == oldinputs.length
        && r.outputs.length == oldoutputs.length
        && !r.inputs.some(newinput => !oldinputs.some(oldinput => oldinput.name == newinput.name && oldinput.count == newinput.count))
        && !oldinputs.some(oldinput => !r.inputs.some(newinput => oldinput.name == newinput.name && oldinput.count == newinput.count))
        && !r.outputs.some(newinput => !oldoutputs.some(oldinput => oldinput.name == newinput.name && oldinput.count == newinput.count))
        && !oldoutputs.some(oldinput => !r.outputs.some(newinput => oldinput.name == newinput.name && oldinput.count == newinput.count))
    );
    if (!newrecipe) {
        // some more human errors in hardcoded 1.1 data, fix the hardcode ok
        console.log(`recipe ${olddisplay} not found in new recipes?`);
    } else {
        if (oldrecipe.time != newrecipe.time) {
            // result: no
            console.log(`recipe ${olddisplay} time diff ${oldrecipe.time} != ${newrecipe.time}`);
        }
        if (oldrecipe.name != newrecipe.name) {
            // old data use (灌装) for fill, I use normal 生产
            // old data use 生产 for pour? you mean you produce a bottle by pour?
            // old data does not different multiple recipe for single product
            // old data some times use 合成 not 生产
            // console.log(`recipe ${olddisplay} name diff ${oldrecipe.name} != ${newrecipe.name}`);
        }
    }
}

// ATTENTION HARDCODE what do you mean by recipes displayed on machine page is not same as on item page?
recipes.push({
    name: '重息壤生产',
    machine: '天有洪炉',
    inputs: [{ name: '息壤', count: 10 }, { name: '壤晶废液', count: 10 }],
    outputs: [{ name: '重息壤', count: 1 }],
    time: 10,
})

// make the result recipe.json include items, machines and recipes
// ATTENTION temporary change new data structure to old data structure to make the web page start running
// use name as id in old data, this by the way checks whether current naming convention fits in data-* attributes
// TODO div.item-line[data-recipe=污水再利用 (扩容)] is not a valid selector, whitespace and ascii paran is not valid, cjk character is ok
const resultdata = {
    items: [] as OldItemData[],
    machines: [] as OldMachineData[],
    recipes: [] as OldRecipeData[],
};
resultdata.items = items.filter(i => recipes.some(r => r.inputs.some(input => input.name == i.name) || r.outputs.some(output => output.name == i.name))).map(i => ({
    id: i.name,
    icon: i.icon,
    name: i.name,
    kind: i.kind == 'liquid' || i.kind == 'seed' ? i.kind : undefined,
    desc: i.desc.split('+'),
} as unknown as OldItemData));
resultdata.machines = machines.map(m => ({ id: m.name, ...m }));
resultdata.recipes = recipes.map(r => ({
    id: r.name,
    name: r.name,
    time: r.time,
    kind: r.kind,
    machineId: r.machine,
    ingredients: r.inputs.map(i => ({ id: i.name, count: i.count })),
    products: r.outputs.map(i => ({ id: i.name, count: i.count })),
}));

// TODO in formal version you need to filter out items without automatic recipe
// TODO I'd like try to add defaults recipe data, count default to 1, time default to 2

await fs.writeFile('data/recipe-old-struct-new-data.json', JSON.stringify(resultdata, null, 2), 'utf-8');

// see freskyz/fine script/components/typescript.ts function transpile
// return null for not ok
function transpileRuntimeScript(): string {

    const program = ts.createProgram(['recipe/index.ts'], {
        lib: ['lib.esnext.d.ts', 'lib.dom.d.ts'],
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        skipLibCheck: true,
        noEmitOnError: true,
        strict: false,
        allowUnreachableCode: false,
        allowUnusedLabels: false,
        alwaysStrict: true,
        exactOptionalPropertyTypes: false,
        noFallthroughCaseInSwitch: true,
        noImplicitAny: true,
        noImplicitReturns: true,
        noImplicitThis: true,
        noPropertyAccessFromIndexSignature: true,
        noUnusedLocals: false,
        noUnusedParameters: false,
        strictNullChecks: false,
        strictFunctionTypes: true,
        strictBindCallApply: true,
        strictBuiltinIteratorReturn: true,
        strictPropertyInitialization: false,
        removeComments: true,
        outDir: '/build',
    });

    const files = {};
    const emitResult = program.emit(undefined, (fileName, data) => {
        if (data) { files[fileName] = data; }
    });

    let transpileResult = Object.values(files)[0] as string;
    if (typeof transpileResult == 'string') {
        transpileResult = transpileResult.trim();
        if (transpileResult.endsWith('export {};')) {
            transpileResult = transpileResult.substring(0, transpileResult.length - 10).trimEnd();
        }
        transpileResult += '\n';
    }
    
    const diagnostics = emitResult.diagnostics;
    const errorCount = diagnostics.filter(d => d.category == ts.DiagnosticCategory.Error || ts.DiagnosticCategory.Warning).length;
    const normalCount = diagnostics.length - errorCount;

    let summary: string;
    if (normalCount == 0 && errorCount == 0) {
        summary = 'no diagnostic';
    } else if (normalCount != 0 && errorCount == 0) {
        summary = styleText('yellow', normalCount.toString()) + ' infos';
    } else if (normalCount == 0 /* && errorCount != 0 */) {
        summary = styleText('yellow', errorCount.toString()) + ' errors';
    } else /* normalCount != 0 && errorCount != 0 */ {
        summary = styleText('yellow', errorCount.toString()) + ' errors and ' + styleText('yellow', normalCount.toString()) + ' infos';
    }

    const success = diagnostics.length == 0;
    console.log(`index.js completed with ${summary}`);
    for (const { category, code, messageText, file, start } of diagnostics) {
        const displayColor = ({
            [ts.DiagnosticCategory.Warning]: 'red',
            [ts.DiagnosticCategory.Error]: 'red',
            [ts.DiagnosticCategory.Suggestion]: 'green',
            [ts.DiagnosticCategory.Message]: 'cyan',
        } as Record<ts.DiagnosticCategory, Parameters<typeof styleText>[0]>)[category];
        const displayCode = styleText(displayColor, `  TS${code} `);

        let fileAndPosition = '';
        if (file && start) {
            const { line, character: column } = ts.getLineAndCharacterOfPosition(file, start);
            fileAndPosition = styleText('yellow', `${file.fileName}:${line + 1}:${column + 1} `);
        }

        let flattenedMessage = ts.flattenDiagnosticMessageText(messageText, '\n');
        if (flattenedMessage.includes('\n')) {
            flattenedMessage = '\n' + flattenedMessage;
        }
        console.log(displayCode + fileAndPosition + flattenedMessage);
    }
    return success ? transpileResult : null;
}

// const runtimescript = transpileRuntimeScript();
// await fs.writeFile('recipe/index.js', runtimescript);

// TODO make pinyin work again
// by the way, you can ssr the item list in the html file? (server side rendering)
