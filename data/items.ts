import npfs from 'node:fs';
import fs from 'node:fs/promises';
import readline from 'node:readline/promises';
import { connect, delay } from '../browser/index.ts';
import type * as spec from '../browser/spec-types.ts';

interface Item {
    name: string,
    icon: string,
    desc1: string,
    desc2: string,
}
// same operation for natural resource filter and industry product filter
async function getItems(client: Awaited<ReturnType<typeof connect>>, categoryName: string) {

    console.log(`get items for ${categoryName}`);
    await client.waitElements('div.FloatSelect__SelectTrigger-hZPtmt', 10);
    const selectTriggerElements = await client.querySelectorAll('div.FloatSelect__SelectTrigger-hZPtmt', { maxCount: 3, maxDepth: 1 });
    if (selectTriggerElements.length != 3) {
        console.log(`select trigger elements length not 3?, ${JSON.stringify(selectTriggerElements)}`);
        return;
    }
    // these 3 elements are exactly same, no way to validate here, so can only validate by everything does not work, etc.
    // how do I determine this is clickable after this element exists?
    // UPDATE selenium have element_to_be_clickable, not sure whether is the answer and solution
    // UPDATE not look like, it is checking element is not disabled and get element by pointer position is this element
    // so seems the correct solution is waiting for correct effect to happen,
    // for this case, it is total card element count and content change? which is nearly all the work done below?
    await delay(5);
    await client.click(selectTriggerElements[2]);
    await delay(5); // how do I determine this is clickable after this element exists?

    // .container>.option>.option-wrapper?>.text-wrapper?>textnode need maxdepth 4
    await client.waitElements('div.FloatSelect__SelectOption-lfnBui', 10);
    const selectOptionElements = await client.querySelectorAll('div.FloatSelect__SelectOption-lfnBui', { maxDepth: 4 });
    const selectOptionValues = selectOptionElements.map((e, i) => [i, e?.value?.children?.[0]?.value?.children?.[0]?.value?.children?.[0]?.value?.nodeValue] as const);
    // do not validate this, active element does not look like this
    // if (selectOptionValues.some(e => typeof e[1] != 'string')) {
    //     console.log(`select option list seems not ok, [${selectOptionValues.join(', ')}], ${JSON.stringify(selectOptionElements)}`);
    //     return;
    // }
    const selectOption = selectOptionValues.find(([i, e]) => e == categoryName);
    if (!selectOption) {
        console.log(`not found required category name?, [${selectOptionValues.join(', ')}], ${JSON.stringify(selectOptionElements)}`);
        return;
    }
    console.log(`category index is ${selectOption[0]}`);
    await client.click(selectOptionElements[selectOption[0]]);
    await delay(5); // how do I determine reloaded elements appear after click the filter?

    // const cardElements = await client.querySelectorAll('div.MedicineCard__Wrapper-hBmYsq.jPhsQP', { maxDepth: 3 });
    // cardElements1[0].value.children[0].value.children[0] this have a background-url style with image url
    // cardElements1[0].value.children[1].value.children[0].value.children[0].value.nodeValue this have a background-url style with image url
    // but bidi don't have css related function, need to call js, then you'd better get url for all elements in one call

    console.log('before eval');
    const evalResult = await client.call((function() {
        return Array.from(document.querySelectorAll('div.MedicineCard__Wrapper-hBmYsq.jPhsQP')).map(e => [
            getComputedStyle(e?.children?.[0]?.children?.[0]).backgroundImage,
            // @ts-ignore
            e?.children?.[1]?.children?.[0]?.innerText, e?.children?.[1]?.children?.[1]?.children?.[0]?.innerText, e?.children?.[1]?.children?.[1]?.children?.[1]?.innerText]);
    }).toString(), []);
    console.log('after eval: ' + JSON.stringify(evalResult));

    if (evalResult.type != 'success') {
        console.log(`eval result not success? ${JSON.stringify(evalResult)}`);
        return;
    } else if (evalResult.result.type != 'array') {
        console.log(`eval result type not array? ${JSON.stringify(evalResult)}`);
        return;
    }

    const items: Item[] = [];
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
        // @ts-ignore, ts does not recognize previous value.some()+continue operation for now
        items.push({ icon: value.value[0].value, name: value.value[1].value, desc1: value.value[2].value, desc2: value.value[3].value });
    }
    return items;
}

async function collect() {
    const logs: string[] = [];
    const client = await connect({ logs });
    console.log(`connection open attach session ${client.session.id}`);
    console.log(`driver status ${JSON.stringify(await client.driverStatus())}`);

    process.on('uncaughtException', () => { npfs.writeFileSync('/tmp/autobrowser.log', logs.join('\n')); process.exit(1); });
    process.on('unhandledRejection', () => { npfs.writeFileSync('/tmp/autobrowser.log', logs.join('\n')); process.exit(1); });

    const pages = await client.getPages();
    client.setPageId(pages[0].id);
    console.log(`devtools url: ${client.getDevToolsFrontEndURL()}`);
    const readlineInterface = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        removeHistoryDuplicates: true,
    }); await readlineInterface.question('input anything to continue');

    // if (pages[0].url != 'https://wiki.skland.com/endfield/catalog?typeMainId=1&typeSubId=6') {
    // }
    console.log(await client.navigate('https://wiki.skland.com/endfield/catalog?typeMainId=1&typeSubId=6', 'interactive'));


    const items1 = await getItems(client, '自然资源');
    console.log(items1);
    const items2 = await getItems(client, '工业产物');
    console.log(items2);
    const items3 = await getItems(client, '可用道具');
    console.log(items3);
    const items4 = await getItems(client, '采集材料'); // 驼兽粪便 is here
    console.log(items4);
    await fs.writeFile('data/rawitem.json', JSON.stringify([...(items1 ?? []), ...(items2 ?? []), ...(items3 ?? []), ...(items4 ?? [])]));
    await fs.writeFile('/tmp/autobrowser.log', logs.join('\n'));

    console.log('try close, start timeout 30s');
    setTimeout(() => process.exit(1), 30_000);
    // TODO why is this not exiting process?
    await client.close();
}
