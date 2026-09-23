import fs from 'node:fs/promises';
import { styleText } from 'node:util';
import { minify } from 'terser';
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

function processData(originalContent: string) {

    const alldata: {
        配方: Record<string, string>,
        配置: Record<string, string[]>,
    } = yaml.parse(originalContent);
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
    return sb;
}

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

// see freskyz/fine script/components/typescript.ts function transpile
// return null for not ok
async function transpileRuntimeScript(): Promise<string> {

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
    if (!success) { return null; }
    
    const minifyResult = await minify(transpileResult, {
        module: true,
        sourceMap: false,
        toplevel: true,
        compress: { ecma: 2025 },
        format: { max_line_len: 160 },
    });
    return minifyResult.code;
}

const datafile = processData(await fs.readFile('recipe/data.yml', 'utf-8'));
await fs.writeFile('build/data.json', datafile);
console.log(`write build/data.json`);
const minifyResult = minifycss(await fs.readFile('recipe/index.css', 'utf-8'));
await fs.writeFile('build/index.css', minifyResult);
console.log(`write build/index.css`);
const runtimescript = await transpileRuntimeScript();
await fs.writeFile('build/index.js', runtimescript);
console.log(`write build/index.js`);
