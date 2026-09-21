import fs from 'node:fs/promises';
import { styleText } from 'node:util';
import ts from 'typescript';

interface ItemData {
    name: string,
    kind?: 'seed' | 'liquid' | 'bottle' | 'filled',
    icon: string,
    desc: string,
}
interface RecipeData {
    machine: string,
    inputs: { name: string, count: number }[],
    outputs: { name: string, count: number }[],
    time: number,
    name: string,
    kind?: string,
}

const items = JSON.parse(await fs.readFile('recipe/item.json', 'utf-8')) as ItemData[];
const recipes = JSON.parse(await fs.readFile('recipe/recipe.json', 'utf-8')) as RecipeData[];

// not include bottle + liquid recipes
for (const recipe of recipes) {
    if (recipe.inputs.length == 2 && recipe.outputs.length == 1) {
        const kind1 = items.find(i => i.name == recipe.inputs[0].name).kind;
        const kind2 = items.find(i => i.name == recipe.inputs[1].name).kind;
        if (kind1 == 'liquid' && kind2 == 'bottle' || kind1 == 'bottle' && kind2 == 'liquid') {
            console.log(`do not add bottle+liquid recipes`);
        }
    } else if (recipe.inputs.length == 1 && recipe.outputs.length == 2) {
        const kind1 = items.find(i => i.name == recipe.outputs[0].name).kind;
        const kind2 = items.find(i => i.name == recipe.outputs[1].name).kind;
        if (kind1 == 'liquid' && kind2 == 'bottle' || kind1 == 'bottle' && kind2 == 'liquid') {
            console.log(`do not add bottle+liquid recipes`);
        }
    }
}
// remove no recipe item
// const newItems: ItemData[] = [];
// for (const item of items) {
//     if (recipes.some(r => r.inputs.some(i => i.name == item.name) || r.outputs.some(o => o.name == item.name))) {
//         newItems.push(item);
//     }
// }
// await fs.writeFile('recipe/item-new.json', '[\n  ' + newItems.map(r => JSON.stringify(r)).join(',\n  ') + '\n]');
// await fs.writeFile('recipe/recipe.json', '[\n  ' + recipes.map(r => JSON.stringify(r)).join(',\n  ') + '\n]');

// remove item.version, reorder properties, merge item.json and recipe.json into data.json
let sb = '{"items":[\n'
for (const item of items) {
    sb += '  ' + JSON.stringify({ name: item.name, kind: item.kind, icon: item.icon, desc: item.desc }) + ',\n';
}
sb = sb.substring(0, sb.length - 2) + '\n';
sb += '],"recipes":[\n';
for (const recipe of recipes) {
    sb += '  ' + JSON.stringify({ name: recipe.name, kind: recipe.kind, machine: recipe.machine, time: recipe.time, inputs: recipe.inputs, outputs: recipe.outputs }) + ',\n';
}
sb = sb.substring(0, sb.length - 2) + '\n';
sb += ']}';
await fs.writeFile('recipe/data.json', sb);

// TODO div.item-line[data-recipe=污水再利用 (扩容)] is not a valid selector, whitespace and ascii paran is not valid, cjk character is ok

// TODO in formal version you need to filter out items without automatic recipe
// TODO I'd like try to add defaults recipe data, count default to 1, time default to 2

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

// TODO make pinyin work again
// by the way, you can ssr the item list in the html file? (server side rendering)
// TODO terser result js
// remove filled items from get-item.ts, don't make filled items in make-icon.rs stage 1
// don't include fill and pour recipe in get-recipe.ts, traverse items detail page in new version
// then create really needed filled items in make-icon.rs stage 2 and create result avif in stage 2
// check whether there is pixel data in 16px padding in the 64px image, if no remove them
// try make a single html file again, after terser js, manually format result json, avoid filled items and make result avif into data uri, check gz and br size
// if single html file works, no need to akari.ts for now
// TODO to make things more clear, and because of game content complexity after version 3, remove panel functionality for now
// NOTE if you remember to click into item detail page to validate recipes, that's handled by mysterious normalization

// TODO remove calculation part, change to select a partial subset of the full tree to display, or else things start from xirang is meaningless
