import fs from 'node:fs/promises';
import { styleText } from 'node:util';
import ts from 'typescript';
import yaml from 'yaml';

interface ItemData {
    name: string,
    pinyin: string,
    kind?: 'seed' | 'liquid' | 'bottle' | 'filled',
    icon: string,
    desc: [string, string],
}
interface MachineData {
    name: string,
    power: number,
    size: [number, number],
}
interface RecipeData {
    name: string,
    // exclude pour in some situations
    // is pour = machine == '拆解机' && products.length == 2 && one contains('bottle') && one contains('liquid')
    kind?: 'pour' | 'fill',
    machine: string,
    time: number,
    input: { name: string, count: number }[],
    output: { name: string, count: number }[],
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

const newItems = JSON.parse(await fs.readFile('data/items-kind.json', 'utf-8'));
const newMachines = yaml.parse(await fs.readFile('data/machine.yml', 'utf-8')).machines;

const olddata = JSON.parse(await fs.readFile('data/recipes-old.json', 'utf-8')) as {
    items: OldItemData[],
    machines: OldMachineData[],
    recipes: OldRecipeData[],
};

const itemById = new Map(olddata.items.map(item => [item.id, item.name]));
const machineById = new Map(olddata.machines.map(item => [item.id, item.name]));
const recipes: RecipeData[] = olddata.recipes.map(recipe => ({
    name: recipe.name,
    kind: recipe.kind,
    machine: machineById.get(recipe.machineId),
    time: recipe.time,
    input: recipe.ingredients.map(ingredient => ({
        name: itemById.get(ingredient.id) ?? ingredient.id,
        count: ingredient.count,
    })),
    output: recipe.products.map(product => ({
        name: itemById.get(product.id) ?? product.id,
        count: product.count,
    })),
}));
await fs.writeFile('data/recipes.json', JSON.stringify({ items: newItems, machines: newMachines, recipes }, null, 2), 'utf-8');
// for (const recipe of recipes) {
//     console.log(`${recipe.name}: ${recipe.input.map(i => `${i.name}x${i.count}`).join(' + ')} => ${recipe.output.map(i => `${i.name}x${i.count}`).join(' + ')}, ${recipe.machine}x${recipe.time}s`);
// }

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

const runtimescript = transpileRuntimeScript();
await fs.writeFile('recipe/index.js', runtimescript);
