import npfs, { read } from 'node:fs';
import fs from 'node:fs/promises';
import readline from 'node:readline/promises';
import { connect, delay } from '../browser/index.ts';
import type * as spec from '../browser/spec-types.ts';

// version 1: 20260122
// version 2: 20260312
// version 3: 20260417
const currentVersion = 3;

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
// items page
await client.navigate('https://wiki.skland.com/endfield/catalog?typeMainId=1&typeSubId=6', 'interactive');

const LiquidItemNames = [
    // these are ordered top in wiki in game in industry production category
    "锦草溶液", "芽针溶液", "液化息壤", "液化重息壤", "壤晶废液", "惰性壤晶废液", "赤铜溶液", "赫铜溶液", "污水",
    // these are natural resource
    "清水", "沉积酸",
];
const BottleItemNames = [
    // these are ordered together in wiki in game in industry production category
    "紫晶质瓶", "蓝铁瓶", "高晶质瓶", "钢质瓶", "赤铜瓶", "赫铜瓶",
];

interface Item {
    name: string,
    icon: string,
    kind?: 'seed' | 'liquid' | 'bottle' | 'filled',
    version: number,
    desc: string,
}
const items = JSON.parse(await fs.readFile('data/items.json', 'utf-8')) as Item[];

async function getItemsForCategory(categoryName: string) {
    console.log(`get items for ${categoryName}`);

    await client.waitElements('div.FloatSelect__SelectTrigger-hZPtmt', 10);
    // after waiting element exist, load element should success...
    const selectTriggerElements = await client.querySelectorAll('div.FloatSelect__SelectTrigger-hZPtmt', { maxCount: 3, maxDepth: 1 });
    if (selectTriggerElements.length != 3) {
        console.log(`when will select trigger element waited and loaded but is not 3?`);
        return;
    }
    // ...but clicking the element may not work, constantly load the options, if not loaded, click again
    let selectOptionRetryTime = 0;
    let selectOptionElements: spec.script.NodeRemoteValue[] = [];
    while (selectOptionElements.length == 0) {
        await client.click(selectTriggerElements[2]);
        try {
            await client.waitElements('div.FloatSelect__SelectOption-lfnBui', 1);
            // .container>.option>.option-wrapper?>.text-wrapper?>textnode need maxdepth 4
            selectOptionElements = await client.querySelectorAll('div.FloatSelect__SelectOption-lfnBui', { maxDepth: 4 });
        } catch {
            // ignore wait element timeout
        }
        selectOptionRetryTime += 1;
        if (selectOptionElements.length == 0 && selectOptionRetryTime >= 10) {
            console.log(`retry load select option elements 10 times not work?`);
            return;
        }
    }
    
    const selectOptionValues = selectOptionElements.map(e => [e, e?.value?.children?.[0]?.value?.children?.[0]?.value?.children?.[0]?.value?.nodeValue] as const);
    // do not validate this, active element does not look like this
    // if (selectOptionValues.some(e => typeof e[1] != 'string')) {}
    const selectOption = selectOptionValues.find(([e, n]) => n == categoryName);
    if (!selectOption) {
        console.log(`not found required category name?, [${selectOptionValues.map(v => v[1]).join(', ')}], ${JSON.stringify(selectOptionElements)}`);
        return;
    }
    await client.click(selectOption[0]);
    // this time you not at all have time to determine card content is updated, and have to dumb wait
    await delay(5);

    // const cardElements = await client.querySelectorAll('div.MedicineCard__Wrapper-hBmYsq.jPhsQP', { maxDepth: 3 });
    // cardElements1[0].value.children[0].value.children[0] this have a background-url style with image url
    // cardElements1[0].value.children[1].value.children[0].value.children[0].value.nodeValue this have a background-url style with image url
    // but bidi don't have css related function, need to call js, then it's easier to get all information of all loaded cards in one call

    const evalResult = await client.call((function() {
        return Array.from(document.querySelectorAll('div.MedicineCard__Wrapper-hBmYsq.jPhsQP')).map(e => [
            // image url
            getComputedStyle(e?.children?.[0]?.children?.[0]).backgroundImage,
            // @ts-ignore, item name, ATTENTION this is remote execution, you cannot (as any) here, but you are free to ts-ignore
            e?.children?.[1]?.children?.[0]?.innerText,
            // @ts-ignore, description line 1, but you are free to ts-ignore
            e?.children?.[1]?.children?.[1]?.children?.[0]?.innerText,
            // @ts-ignore, description line 2
            e?.children?.[1]?.children?.[1]?.children?.[1]?.innerText,
        ]);
    }).toString(), []);
    logs.push(JSON.stringify(evalResult));

    if (evalResult.type != 'success') {
        console.log(`eval result not success? ${JSON.stringify(evalResult)}`);
        return;
    } else if (evalResult.result.type != 'array') {
        console.log(`eval result type not array? ${JSON.stringify(evalResult)}`);
        return;
    }

    let hasNewItem = false;
    for (const value of evalResult.result.value) {
        if (value.type != 'array') {
            console.log(`eval result element type not array? ${JSON.stringify(value)}`);
            continue;
        } else if (value.value.length != 4) {
            console.log(`eval result element array length not 4? ${JSON.stringify(value)}`);
            continue;
        } else if (value.value.some(v => v.type != 'string')) {
            console.log(`eval result element array element type not string? ${JSON.stringify(value)}`);
            continue;
        }
        // the string[] that returned by the remote function
        // any: it will be very difficult for ts to recognize the some(!=string) then continue operation
        const values = value.value.map((v: any) => v.value as string);
        const itemName = values[1];
        if (items.some(i => i.name == itemName)) {
            logs.push(`item ${itemName} exists, skip`);
        } else {
            let icon = values[0];
            if (!icon.startsWith("url(\"https://") || !icon.endsWith("\")")) {
                console.log(`item ${itemName} background image invalid format? ${icon}`);
                continue;
            }
            icon = icon.substring(5, icon.length - 2);
            let kind: Item['kind'];
            if (itemName.endsWith('种子')) { kind = 'seed'; }
            if (LiquidItemNames.includes(itemName)) { kind = 'liquid'; }
            if (BottleItemNames.includes(itemName)) { kind = 'bottle'; }
            let desc1 = values[2];
            let desc2 = values[3];
            if (desc1.includes('+') || desc2.includes('+')) {
                // this is ok but only splits desc in early position or even in same position
                console.log(`warning: item ${itemName} desc contains ascii plus sign: ${desc1}+${desc2}`);
            }
            if (desc1.includes("'")) {
                // this is ok, just check by the way before the following double quote check
                console.log(`warning: item ${itemName} desc contains ascii single quote?: ${desc1}+${desc2}`);
            }
            if (desc1.includes('"')) {
                const before = desc1;
                let opening = true;
                while (desc1.includes('"')) {
                    desc1 = desc1.replace('"', opening ? '“' : '”');
                    opening = !opening;
                }
                console.log(`warning: item ${itemName} desc1 include ascii double quote: ${before} => ${desc1}`);
            }
            // TODO 重息壤's whitespace before ascii double quote is wiki error or in game data error?
            if (desc2.includes("\"")) {
                const before = desc2;
                let opening = true;
                while (desc2.includes('"')) {
                    desc2 = desc2.replace('"', opening ? '“' : '”');
                    opening = !opening;
                }
                console.log(`warning: item ${itemName} desc2 include ascii double quote: ${before} => ${desc2}`);
            }
            hasNewItem = true;
            console.log(`add item ${values[1]}`);
            logs.push(`add item ${values.join(',')}`);
            items.push({ name: values[1], icon, kind, version: currentVersion, desc: `${desc1}+${desc2}` });
        }
    }
    if (!hasNewItem) {
        console.log(`no new item for ${categoryName}`);
    }
    // wait for my human eye to match command line output and web page display
    await delay(3);
}

await getItemsForCategory('自然资源');
await getItemsForCategory('工业产物');
await getItemsForCategory('可用道具');
await getItemsForCategory('采集材料'); // 驼兽粪便 is here

// validate config for typo, etc. errors
if (LiquidItemNames.some(n => !items.some(i => i.name == n))) {
    console.log(`unknown item name in configured liquid item names`);
}
if (BottleItemNames.some(n => !items.some(i => i.name == n))) {
    console.log(`unknown item name in configured bottle item names`);
}
// sort by version desc, then filled last, then name asc
items.sort((i1, i2) => {
    if (i1.version != i2.version) {
        return i2.version - i1.version;
    } else if (i1.kind != i2.kind && (i1.kind == 'filled' || i2.kind == 'filled')) {
        return i1.kind == 'filled' ? 1 : -1;
    } else {
        return i1.name.localeCompare(i2.name);
    }
});
await fs.writeFile('data/items.json', JSON.stringify(items, undefined, 2));

await client.close(); // ({ drop: true })
npfs.closeSync(logfile);
readlineInterface.close();
// if you the process cannot exit again, try npx why-is-node-running thisscript.ts
