import fs from 'node:fs/promises';
import { styleText } from 'node:util';
import { minify } from 'terser';
import ts from 'typescript';

function mergeData(itemOriginalContent: string, recipeOriginalContent: string) {
    // ???
    return `{"items":${itemOriginalContent},"recipes":${recipeOriginalContent}}`;
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
        // transpileResult = "import pagedata from './data.json' with { type: 'json' };\n" + transpileResult;
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

const datafile = mergeData(
    await fs.readFile('build/item.json', 'utf-8'),
    await fs.readFile('build/recipe.json', 'utf-8'),
);
const minifyResult = minifycss(await fs.readFile('recipe/index.css', 'utf-8'));
const runtimescript = await transpileRuntimeScript();

let builder = await fs.readFile('recipe/index.html', 'utf-8');
builder = builder.replace('<style></style>', '<style>\n' + minifyResult + '\n  </style>');
builder = builder.replace('<script></script>', '<script type="module">\n' + `const pagedata = ${datafile};${runtimescript}` + '\n  </script>');
console.log('write index.html');
await fs.writeFile('build/index.html', builder);
