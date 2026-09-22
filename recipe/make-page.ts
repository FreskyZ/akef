import fs from 'node:fs/promises';
import { styleText } from 'node:util';
import ts from 'typescript';
import yaml from 'yaml';

interface ItemData {
    name: string,
    kind?: 'seed' | 'liquid' | 'bottle' | 'gas' | 'filled' | 'bottle+liquid' | 'bottle+gas',
    icon: string,
    desc: string,
}
interface RecipeData {
    name: string,
    machine: string,
    time: number,
    vibe?: string,
    inputs: { name: string, count: number }[],
    outputs: { name: string, count: number }[],
}
interface DataConfig {
    plants: string[],
    bottles: string[],
    liquids: string[],
    gasitems: string[],
    minerals: string[],
    machines: string[],
    environments: string[],
}

async function processData(filepath: string) {

    const alldata: {
        配方: Record<string, string>,
        配置: Record<string, string[]>,
    } = yaml.parse(await fs.readFile(filepath, 'utf-8'));
    const dataconfig: DataConfig = {
        plants: alldata.配置.植物,
        bottles: alldata.配置.瓶子,
        liquids: alldata.配置.液体,
        gasitems: alldata.配置.气体,
        minerals: alldata.配置.矿物,
        machines: alldata.配置.机器,
        environments: alldata.配置.环境,
    };

    let hasError = false;
    const recipes: RecipeData[] = [];
    for (const [name, raw] of Object.entries(alldata.配方)) {
        const splitted1 = raw.split('=>[').map(x => x.trim());
        if (splitted1.length != 2) {
            hasError = true;
            console.log(`${name}: invalid format, expect one =>[`);
            continue;
        }
        const [rawInput, rawConditionAndOutputs] = splitted1;
        const splitted2 = rawConditionAndOutputs.split(']=>').map(x => x.trim());
        if (splitted2.length != 2) {
            hasError = true;
            console.log(`${name}: invalid format, expect one ]=>`);
            continue;
        }
        const [rawCondition, rawOutput] = splitted2;

        const inputs = rawInput.split('+').map(x => x.trim()).map(rawInput => {
            const match = /^(\d+)/.exec(rawInput);
            if (match && match[1] == '1') {
                console.log(`${name}: input ${rawInput} no need to add 1`);
            }
            return match 
                ? { count: +match[1], name: rawInput.substring(match[1].length) }
                : { count: 1, name: rawInput };
        });
        const outputs = rawOutput == '无'
            ? []
            : rawOutput.split('+').map(x => x.trim()).map(rawOutput => {
                const match = /^(\d+)/.exec(rawOutput);
                if (match && match[1] == '1') {
                    console.log(`${name}: output ${rawOutput} no need to add 1`);
                }
                return match 
                    ? { count: +match[1], name: rawOutput.substring(match[1].length) }
                    : { count: 1, name: rawOutput };
            });
        const conditions = rawCondition.split('+').map(x => x.trim());
        let machine: string;
        let time = 2;
        let vibe: string = undefined;
        for (const condition of conditions) {
            if (dataconfig.machines.includes(condition)) {
                machine = condition;
            } else if (condition.endsWith('环境')) {
                const environment = condition.substring(0, condition.length - 2);
                if (dataconfig.environments.includes(environment)) {
                    vibe = environment;
                } else {
                    hasError = true;
                    console.log(`${name}: unknown environment`);
                }
            } else if (condition.endsWith('s')) {
                time = +condition.substring(0, condition.length - 1);
                if (isNaN(time)) {
                    hasError = true;
                    console.log(`${name}: unknown time`);
                } else if (time == 2) {
                    console.log(`${name}: no need to write explicit 2s`);
                }
            } else {
                hasError = true;
                console.log(`${name}: unknown condition ${condition}`);
            }
        }
        recipes.push({ name, time, machine, vibe, inputs, outputs });
    }
    if (hasError) { return null; }

    const allItemNames: Set<String> = new Set();
    const usedPlants: Set<string> = new Set();
    const usedMinerals: Set<string> = new Set();
    for (const recipe of recipes) {
        recipe.inputs.forEach(i => allItemNames.add(i.name));
        recipe.outputs.forEach(o => allItemNames.add(o.name));

        if (recipe.machine == '种植机' || recipe.machine == '采种机') {
            console.log(`${recipe.name}: don't add obvious plant recipes`);
            continue;
        }
        if (recipe.inputs.length == 2 && (
            dataconfig.bottles.includes(recipe.inputs[0].name) && dataconfig.liquids.includes(recipe.inputs[1].name)
            || dataconfig.liquids.includes(recipe.inputs[0].name) && dataconfig.bottles.includes(recipe.inputs[1].name)
            || dataconfig.bottles.includes(recipe.inputs[0].name) && dataconfig.gasitems.includes(recipe.inputs[1].name)
            || dataconfig.gasitems.includes(recipe.inputs[0].name) && dataconfig.bottles.includes(recipe.inputs[1].name)
        )) {
            console.log(`${recipe.name}: don't add fill bottle recipes`);
        }
        if (recipe.outputs.length == 2 && (
            dataconfig.bottles.includes(recipe.outputs[0].name) && dataconfig.liquids.includes(recipe.outputs[1].name)
            || dataconfig.liquids.includes(recipe.outputs[0].name) && dataconfig.bottles.includes(recipe.outputs[1].name)
            || dataconfig.bottles.includes(recipe.outputs[0].name) && dataconfig.gasitems.includes(recipe.outputs[1].name)
            || dataconfig.gasitems.includes(recipe.outputs[0].name) && dataconfig.bottles.includes(recipe.outputs[1].name)
        )) {
            console.log(`${recipe.name}: don't add pour bottle recipes`);
        }

        let inputIsSystemInputCount = 0;
        for (const input of recipe.inputs) {
            if (dataconfig.plants.includes(input.name)) {
                inputIsSystemInputCount += 1;
                usedPlants.add(input.name);
            } else if (dataconfig.minerals.includes(input.name)) {
                inputIsSystemInputCount += 1;
                usedMinerals.add(input.name);
            } else if (recipes.some(r => r.outputs.some(o => o.name == input.name))) {
                // normal item that produced by other recipes
            } else {
                console.log(`${recipe.name}: input item ${input.name} not found in plants, minerals or other recipe outputs`);
            }
        }
        if (inputIsSystemInputCount == recipe.inputs.length
            && recipe.outputs.length == 1 && !recipes.some(r => r.inputs.some(i => i.name == recipe.outputs[0].name))
        ) {
            console.log(`${recipe.name}: consider reject irrelavent simple recipes?`);
        }
    }

    const unusedPlants = dataconfig.plants.filter(p => !usedPlants.has(p));
    if (unusedPlants.length) {
        console.log(`plants unused: ${unusedPlants.join(', ')}`);
    }
    const unusedMinerals = dataconfig.minerals.filter(p => !usedMinerals.has(p));
    if (unusedMinerals.length) {
        console.log(`minerals unused: ${unusedMinerals.join(', ')}`);
    }
    const unusedConfigItems = dataconfig.bottles
        .concat(dataconfig.liquids).concat(dataconfig.gasitems).filter(p => !allItemNames.has(p));
    if (unusedConfigItems.length) {
        console.log(`config items unused: ${unusedConfigItems.join(',')}`);
    }

    const resultdata = {
        items: [], // TODO coordinates
        recipes: recipes.map(r => ({
            name: r.name,
            machine: r.machine,
            time: r.time == 2 ? undefined : r.time,
            vibe: r.vibe,
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
    let sb = '';
    sb += '{"items":[\n';
    sb += '],"recipes":[\n  ';
    sb += resultdata.recipes.map(r => JSON.stringify(r)).join(',\n  ');
    sb += '\n]}';
    await fs.writeFile('recipe/data-new.json', sb);
}
await processData('recipe/data.yml');

// TODO in result json, default time to 2, default count to 1


// recipes.sort((r1, r2) => Buffer.from(r1.name).compare(Buffer.from(r2.name)));

// let sb = '';
// sb += '配方:\n'
// for (const recipe of recipes) {
//     sb += '  ' + recipe.name + ': ';
//     for (const input of recipe.inputs) {
//         if (input.count > 1) { sb += `${input.count}`; }
//         sb += input.name;
//         sb += ' + ';
//     }
//     sb = sb.substring(0, sb.length - 3);
//     sb += ` ->[${recipe.machine},${recipe.time}s]-> `;
//     for (const output of recipe.outputs) {
//         if (output.count > 1) { sb += `${output.count}`; }
//         sb += output.name;
//         sb += ' + ';
//     }
//     if (recipe.outputs.length) {
//         sb = sb.substring(0, sb.length - 3);
//     } else {
//         sb += '无';
//     }
//     sb += '\n';
// }
// sb += '\n'
// sb += '物品类别:\n';
// sb += '  种子: [' + items.filter(i => i.kind == 'seed').map(i => i.name).join(', ') + ']\n';
// sb += '  瓶子: [' + items.filter(i => i.kind == 'bottle').map(i => i.name).join(', ') + ']\n';
// sb += '  液体: [' + items.filter(i => i.kind == 'liquid').map(i => i.name).join(', ') + ']\n';
// sb += '  气体: [' + items.filter(i => i.kind == 'gas').map(i => i.name).join(', ') + ']\n';
// sb += '  瓶子+液体: [' + items.filter(i => i.kind == 'filled').map(i => i.name).join(', ') + ']\n';
// sb += '  瓶子+气体: [' + items.filter(i => i.kind == 'bottle+gas').map(i => i.name).join(', ') + ']\n';
// await fs.writeFile('recipe/data-order.yml', sb);

// try align recipes
// RESULT: no, vscode + cascadia code default settings don't align cjk characters
// const formattedRecipes: string[][] = [];
// for (const recipe of recipes) {
//     const part1 = `  ${recipe.name}: `;
//     let part2 = '';
//     for (const input of recipe.inputs) {
//         if (input.count > 1) { part2 += `${input.count}`; }
//         part2 += input.name;
//         part2 += ' + ';
//     }
//     part2 = part2.substring(0, part2.length - 3);
//     const part3 = ` =>[${recipe.machine}`;
//     let part4 = '';
//     if (recipe.time != 2) {
//         part4 += `+${recipe.time}s`;
//     }
//     part4 += `]=> `;
//     let part5 = '';
//     for (const output of recipe.outputs) {
//         if (output.count > 1) { part5 += `${output.count}`; }
//         part5 += output.name;
//         part5 += ' + ';
//     }
//     if (recipe.outputs.length) {
//         part5 = part5.substring(0, part5.length - 3);
//     } else {
//         part5 += '无';
//     }
//     formattedRecipes.push([part1, part2, part3, part4, part5]);
// }
// // make the => between part 2 and 3 align, that is, respect longest part 1 + 2
// // whitespace is added between 1 and 2, so 1 and 2 is not in one part
// const longestPart1And2 = formattedRecipes.reduce((v, r) => Math.max(v, r[0].length + r[1].length), 0);
// // make the => between part 4 and 5 align, that is, respect longest part 3 + 4
// // whitespace is added between 3 and 4, so 3 and 4 is not in one part
// const longestPart3And4 = formattedRecipes.reduce((v, r) => Math.max(v, r[2].length + r[3].length), 0);

// let sb = '';
// sb += '配方:\n'
// for (const recipe of formattedRecipes) {
//     sb += recipe[0];
//     sb += new Array(longestPart1And2 - recipe[0].length - recipe[1].length).fill(' ').join('');
//     sb += recipe[1] + recipe[2];
//     sb += new Array(longestPart3And4 - recipe[2].length - recipe[3].length).fill(' ').join('');
//     sb += recipe[3] + recipe[4];
//     sb += '\n';
// }
// await fs.writeFile('recipe/data-align.yml', sb);



// // not include bottle + liquid recipes
// for (const recipe of recipes) {
//     if (recipe.inputs.length == 2 && recipe.outputs.length == 1) {
//         const kind1 = items.find(i => i.name == recipe.inputs[0].name).kind;
//         const kind2 = items.find(i => i.name == recipe.inputs[1].name).kind;
//         if (kind1 == 'liquid' && kind2 == 'bottle' || kind1 == 'bottle' && kind2 == 'liquid') {
//             console.log(`do not add bottle+liquid recipes`);
//         }
//     } else if (recipe.inputs.length == 1 && recipe.outputs.length == 2) {
//         const kind1 = items.find(i => i.name == recipe.outputs[0].name).kind;
//         const kind2 = items.find(i => i.name == recipe.outputs[1].name).kind;
//         if (kind1 == 'liquid' && kind2 == 'bottle' || kind1 == 'bottle' && kind2 == 'liquid') {
//             console.log(`do not add bottle+liquid recipes`);
//         }
//     }
// }
// // remove no recipe item
// // const newItems: ItemData[] = [];
// // for (const item of items) {
// //     if (recipes.some(r => r.inputs.some(i => i.name == item.name) || r.outputs.some(o => o.name == item.name))) {
// //         newItems.push(item);
// //     }
// // }
// // await fs.writeFile('recipe/item-new.json', '[\n  ' + newItems.map(r => JSON.stringify(r)).join(',\n  ') + '\n]');
// // await fs.writeFile('recipe/recipe.json', '[\n  ' + recipes.map(r => JSON.stringify(r)).join(',\n  ') + '\n]');

// // remove item.version, reorder properties, merge item.json and recipe.json into data.json
// let sb = '{"items":[\n'
// for (const item of items) {
//     sb += '  ' + JSON.stringify({ name: item.name, kind: item.kind, icon: item.icon, desc: item.desc }) + ',\n';
// }
// sb = sb.substring(0, sb.length - 2) + '\n';
// sb += '],"recipes":[\n';
// for (const recipe of recipes) {
//     sb += '  ' + JSON.stringify({ name: recipe.name, kind: recipe.kind, machine: recipe.machine, time: recipe.time, inputs: recipe.inputs, outputs: recipe.outputs }) + ',\n';
// }
// sb = sb.substring(0, sb.length - 2) + '\n';
// sb += ']}';
// await fs.writeFile('recipe/data.json', sb);

// const data = yaml.parse(await fs.readFile('recipe/test-data.yml', 'utf-8'));
// // yaml parse gets whitespace (0x20) in current format, you may can use 0x20 to split them, with check current content don't include 0x20
// // console.log(data.items['沉积酸'].charAt(3) == ' ');
// console.log(data);

// TODO div.item-line[data-recipe=污水再利用 (扩容)] is not a valid selector, whitespace and ascii paran is not valid, cjk character is ok

// TODO in formal version you need to filter out items without automatic recipe
// TODO I'd like try to add defaults recipe data, count default to 1, time default to 2

function minifycss(originalContent: string) {
    // as my simple css is very regular that only contain plain rules .*\s\{attribute*\} and plain attributes .*:\s.*;
    // so can use simple string manipulation operation to minify

    let b = '';
    let previousCommentEndPosition = -2;
    let commentStartPosition = originalContent.indexOf('/*');
    while (commentStartPosition >= 0) {
        const commentEndPosition = originalContent.indexOf('*/', commentStartPosition);
        b += originalContent.substring(previousCommentEndPosition + 2, commentStartPosition);
        previousCommentEndPosition = commentEndPosition;
        commentStartPosition = originalContent.indexOf('/*', commentEndPosition);
    }
    b += originalContent.substring(previousCommentEndPosition + 2);
    originalContent = b;

    b = '';
    let previousRightBracePosition = -1;
    let leftBracePosition = originalContent.indexOf('{');
    while (leftBracePosition >= 0) {
        const rightBracePosition = originalContent.indexOf('}', leftBracePosition);
        // selector
        b += originalContent.substring(previousRightBracePosition + 1, leftBracePosition).trim();
        b += '{';
        const ruleContent = originalContent.substring(leftBracePosition + 1, rightBracePosition).trim();
        // every unwanted whitespace characters are around colon and semicolon, so...
        const trimmed1 = ruleContent.split(':').map(p => p.trim()).join(':');
        const trimmed2 = trimmed1.split(';').map(p => p.trim()).join(';');
        b += trimmed2;
        b += '}\n';

        previousRightBracePosition = rightBracePosition;
        leftBracePosition = originalContent.indexOf('{', rightBracePosition);
    }
    return b.trim();
}
const minifyResult = minifycss(await fs.readFile('recipe/index.css', 'utf-8'));
await fs.writeFile('recipe/index-min.css', minifyResult);

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
        // import data, if you import data in typescript, it will be inlined
        transpileResult = transpileResult.replace("const pagedata = window['thepagedata'];\n", '');
        transpileResult = "import pagedata from './data.json' with { type: 'json' };\n" + transpileResult;
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

const runtimescript = transpileRuntimeScript();
await fs.writeFile('recipe/index.js', runtimescript);
