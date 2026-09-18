import fs from 'node:fs/promises';
import { styleText } from 'node:util';
import { randomInt } from 'node:crypto';
import yaml from 'yaml';

// 基质规划

// you call a 重度能量淤积点 protocol space? more on naming conventions:
// - 基础属性 is category 1, 附加属性 is category 2, 技能属性 is category 3
// - 敏捷提升 is an attribute, 敏捷提升·大 is a weapon attribute, 大，中，小 is attribute strength
// - 切骨·艺术暴论 is a skill attribute, 切骨 is an attribute, 艺术暴论 is a skill
interface SpaceData {
    name: string,
    cat1: string[],
    cat2: string[],
    cat3: string[],
}
interface WeaponData {
    name: string,
    rarity: number,
    attributes: string[],
    // the data file is tracked in git, it should be a good tracking of my game experience in theory,
    // but I'm lazy to frequently push changes this small scale, so the tracking is actually not working
    // beside that, after several versions, I always acquire all essences of all new weapons several days
    // after game update, making this tracking mechanism more meaningless
    // TODO most of the essences that I daily use actually goes to 443, making current common 111 record more meaningless
    progress?: [number, number, number],
}

const dedup = <T>(e: T, i: number, a: T[]) => a.indexOf(e) == i;
async function readData() {
    const alldata: {
        spaces: SpaceData[],
        weapons: Record<string, [number, [string, string, string], [number, number, number]?]>,
    } = yaml.parse(await fs.readFile('essence/data.yml', 'utf-8'));

    const spaceNames: string[] = [];
    const space1Cat1 = alldata.spaces[0].cat1;
    const allCat2Names: string[] = [];
    const allCat3Names: string[] = [];
    for (const space of alldata.spaces) {
        // no duplicate name
        if (spaceNames.includes(space.name)) {
            console.log(`essence.ts: duplicate protocol space name ${space.name}`);
        }
        spaceNames.push(space.name);
        // cat1 length 5
        if (space.cat1.length != 5) {
            console.log(`essence.ts: space ${space.name} cat1 length not 5: ${space.cat1.join(', ')}`);
        }
        // no duplication inside cat1
        if (space.cat1.length != space.cat1.filter(dedup).length) {
            console.log(`essence.ts: space ${space.name} cat1 duplicate value: ${space.cat1.join(', ')}`);
        }
        // cat1 name ends with 提升
        if (space.cat1.some(a => !a.endsWith('提升'))) {
            console.log(`essence.ts: space ${space.name} cat1 have name not ends with 提升? ${space.cat1.join(', ')}`);
        }
        // cat1 should be exactly same for all spaces
        if (space !== alldata.spaces[0]) {
            if (space.cat1.some(a => !space1Cat1.includes(a)) || space1Cat1.some(a => !space.cat1.includes(a))) {
                console.log(`essence.ts: space ${space.name} cat1 not same as before? ${space.cat1.join(', ')}`);
            }
        }
        // cat2 length 8
        if (space.cat2.length != 8) {
            console.log(`essence.ts: space ${space.name} cat2 length not 8: ${space.cat2.join(', ')}`);
        }
        // no duplication inside cat2
        if (space.cat2.length != space.cat2.filter(dedup).length) {
            console.log(`essence.ts: space ${space.name} cat2 duplicate value: ${space.cat2.join(', ')}`);
        }
        // cat2 name ends with 提升
        if (space.cat2.some(a => !a.endsWith('提升'))) {
            console.log(`essence.ts: space ${space.name} cat2 have name not ends with 提升? ${space.cat2.join(', ')}`);
        }
        // cat3 length 8
        if (space.cat3.length != 8) {
            console.log(`essence.ts: space ${space.name} cat3 length not 8: ${space.cat3.join(', ')}`);
        }
        // no duplication inside cat3
        if (space.cat3.length != space.cat3.filter(dedup).length) {
            console.log(`essence.ts: space ${space.name} cat2 duplicate value: ${space.cat3.join(', ')}`);
        }
        // cat3 name length 2
        if (space.cat3.some(a => a.length != 2)) {
            console.log(`essence.ts: space ${space.name} cat3 have name not length 2? ${space.cat3.join(', ')}`);
        }
        allCat2Names.push(...space.cat2);
        allCat3Names.push(...space.cat3);
    }

    const cat1NameSet = space1Cat1;
    // all names in cat2 should appear at least twice
    const cat2NameSet = allCat2Names.filter(dedup);
    for (const cat2Name of cat2NameSet) {
        if (allCat2Names.filter(n => n == cat2Name).length == 1) {
            console.log(`essence.ts: cat2 name ${cat2Name} only appear once?`);
        }
    }
    // all names in cat3 should appear at least twice
    const cat3NameSet = allCat3Names.filter(dedup);
    for (const cat3Name of cat3NameSet) {
        if (allCat3Names.filter(n => n == cat3Name).length == 1) {
            console.log(`essence.ts: cat3 name ${cat3Name} only appear once?`);
        }
    }

    // no duplicate name between cat1 and cat2, cat2 and cat3
    if (space1Cat1.some(a => cat2NameSet.includes(a))) {
        console.log(`essence.ts: duplicate name between cat1 and cat2, cat1=[${space1Cat1.join(', ')}], cat2set=[${cat2NameSet.join(', ')}]`);
    }
    if (cat2NameSet.some(a => cat3NameSet.includes(a))) {
        console.log(`essence.ts: duplicate name between cat2 and cat3, cat2=[${cat2NameSet.join(', ')}], cat3set=[${cat3NameSet.join(', ')}]`);
    }

    // other related observations from weapon data but not needed in this program:
    // - rarity 6 attribute length for cat1 and cat2 is always 大, rarity 5 中, rarity 4 小
    // - rarity 3 only have 2 attributes, cat1 and cat3, no cat2
    // - rarity 3 cat 3 skill name are all same

    // after validated space data, validate weapon data against space data
    const weaponNames: string[] = [];
    const weapons: WeaponData[] = [];
    for (const [weaponName, [rarity, attributes, progress]] of Object.entries(alldata.weapons)) {
        if (weaponNames.includes(weaponName)) {
            console.log(`essence.ts: duplicate weapon name ${weaponName}`);
        }
        weaponNames.push(weaponName);

        if (attributes?.length != 3) {
            console.log(`essence.ts: weapon ${weaponName} attribute length not 3?`);
        } else {
            if (!cat1NameSet.includes(attributes[0])) {
                console.log(`essence.ts: weapon ${weaponName} unknown attribute 1 ${attributes[0]}`);
            }
            if (!cat2NameSet.includes(attributes[1])) {
                console.log(`essence.ts: weapon ${weaponName} unknown attribute 2 ${attributes[1]}`);
            }
            if (!cat3NameSet.includes(attributes[2])) {
                console.log(`essence.ts: weapon ${weaponName} unknown attribute 3 ${attributes[2]}`);
            }
        }
        weapons.push({ name: weaponName, rarity, attributes, progress });
    }

    return { spaces: alldata.spaces, weapons };
}

// for now
// 正在用的武器: 100
// 想要练的干员的专武：2
// default: 1
// 不感兴趣：0.5
// 过期专武暂无复刻：0.5
// 过期通行证武器暂无复刻: 0.25
// rarity 5 not allowed in this list and is fixed: 0.25
// UPDATE this is not used for very long time, but keep it here in case needed in future
const weightOverwrites: { name: string, weight: number }[] = [
    // { name: '爆破单元', weight: 100 },
];
const { spaces: AllSpaces, weapons: AllWeapons } = await readData();

function getCombinations<T>(sequence: T[], length: number): T[][] {
    const result: T[][] = [];
    function backtrack(start: number, current: T[]) {
        // If we've reached the desired length, add to result
        if (current.length == length) {
            result.push([...current]);
            return;
        }
        // Try adding each remaining element
        for (let i = start; i < sequence.length; i++) {
            current.push(sequence[i]);
            backtrack(i + 1, current);
            current.pop(); // Backtrack
        }
    }
    backtrack(0, []);
    return result;
}

// frequently used helper functions
const displayAttribute = (a: string) => {
    const a1 = a.endsWith('提升') ? a.substring(0, a.length - 2) : a;
    const a2 = a1.endsWith('伤害') ? a1.substring(0, a1.length - 2) : a1;
    return a2
        .replace('主能力', '主能')
        .replace('源石技艺强度', '精通')
        .replace('终结技充能效率', '充能')
        .replace('治疗效率', '治疗')
        .replace('暴击率', '暴击')
}

interface ProgressOverwrite {
    name: string,
    progress: [number, number, number],
}
interface Strategy {
    space: string,
    cat1Names: string[],
    cat2Or3Name: string, // selected cat2 or cat3 attribute
    weapons: WeaponData[], // all weapons available in the strategy regardless of progress
    numbers: number[], // see usage, for now only 1 number, but left for future change?
    combinations: StrategyAttributeCombinations[],
}
interface StrategyAttributeCombinations {
    attributes: string, // one string "cat1,cat2,cat3"
    weapons: { name: string, weight: number }[],
}

function plan(progressOverwrites: ProgressOverwrite[]): Strategy[] {

    const strategies: Strategy[] = [];
    for (const space of AllSpaces) {
        // cat2 and cat3 handling only differ in filter weapon part, so can merge them together
        for (const [cat, weapons] of space.cat2.map<[string, WeaponData[]]>(cat2 => [cat2,
                AllWeapons.filter(w => space.cat1.includes(w.attributes[0]) && w.attributes[1] == cat2 && space.cat3.includes(w.attributes[2]))])
            .concat(space.cat3.map(cat3 => [cat3,
                AllWeapons.filter(w => space.cat1.includes(w.attributes[0]) && space.cat2.includes(w.attributes[1]) && w.attributes[2] == cat3)])))
        {
            // note weapons may be empty
            // remain 6 first, then remain 5, then progress 6, then progress 5
            weapons.sort((w1, w2) => {
                const p1 = progressOverwrites.find(p => p.name == w1.name)?.progress ?? w1.progress;
                const p2 = progressOverwrites.find(p => p.name == w2.name)?.progress ?? w2.progress;
                if (!p1 && p2) { return -1; }
                if (p1 && !p2) { return 1; }
                if (w1.rarity != w2.rarity) { return w2.rarity - w1.rarity; }
                return w1.name.localeCompare(w2.name);
            });
            // if cat1 is larger than 3, need to split them
            const cat1Attributes = weapons.map(w => w.attributes[0]).filter(dedup);
            if (cat1Attributes.length <= 3) {
                strategies.push({ space: space.name, cat2Or3Name: cat, cat1Names: cat1Attributes, weapons, numbers: [], combinations: [] });
            } else {
                // find all length 3 combinations of cat1set
                for (const combination of getCombinations(cat1Attributes, 3)) {
                    const thisCombinationWeapons = weapons.filter(w => combination.includes(w.attributes[0]));
                    strategies.push({ space: space.name, cat2Or3Name: cat, cat1Names: combination, weapons: thisCombinationWeapons, numbers: [], combinations: [] });
                }
            }
        }
    }
    // remove subset
    for (const strategy of strategies) {
        if (strategy.cat1Names.length == 3) { continue; }
        // cat1names is superset
        const superset = strategies.find(other =>
            strategy !== other
            && strategy.space == other.space
            && strategy.cat2Or3Name == other.cat2Or3Name
            && !strategy.cat1Names.some(n => !other.cat1Names.includes(n)));
        if (superset) {
            // TODO think why there is none
            console.log(`strategy ${strategy.space}:${strategy.cat2Or3Name}:${strategy.cat1Names.join(',')} is subset of ${superset.cat1Names.join(',')}`);
        }
    }

    // the original numbers used in score and display are
    // - remaining 6 star weapon attribute combination count (completely same attribute weapon count as 1), this is the probability to get essence for 6 star
    // - reamining 5/6 combination count, probability for 5 star
    // - total combination count, include 5/6 and include have progress, total probability
    // - remaining 6 weapon count, and remaining 5/6 weapon count, and total count
    // and then only sort by first number (prob), then second number (prob5/6)
    //
    // according to my usage experience, nearly never happens acquiring higher
    // level progress essence than existing essence, number include have progress weapon is not important
    // rarity is not important, my interesting characters is very limited and rarity 6 weapon is very enough
    // so try new strategy with the new weight mechanism
    // that only sort by remaining combination count weighted, if 2 weapons have same combination, choose the higher weight

    const notHaveProgress = (w: WeaponData) => !progressOverwrites.some(p => p.name == w.name) && !w.progress;
    for (const { weapons, numbers, combinations } of strategies) {
        if (!weapons.length) {
            numbers.push(0);
        } else {
            for (const combination of weapons.filter(notHaveProgress).map(w => w.attributes.join(',')).filter(dedup)) {
                const weaponAndWeights = weapons.filter(w => w.attributes.join(',') == combination).map(w => ({
                    name: w.name,
                    weight: w.rarity == 5 ? 0.25 : (weightOverwrites.find(weight => weight.name == w.name)?.weight ?? 1)
                }));
                combinations.push({ attributes: combination, weapons: weaponAndWeights });
            }
            numbers.push(combinations.reduce((acc, c) => acc + c.weapons.reduce((acc, w) => Math.max(acc, w.weight), 0), 0));
        }
    }

    // the core operation of "planning" is set priority of the strategies
    strategies.sort((p1, p2) => {
        // return p2-p1 means larger first, p1-p2 means smaller first,
        // or return negative means p1 before p2, positive means p2 before p1
        // score
        if (p1.numbers[0] != p2.numbers[0]) { return p2.numbers[0] - p1.numbers[0]; }
        // then complete weapon count
        if (p1.weapons.length != p2.weapons.length) { return p2.weapons.length - p1.weapons.length; }
        // normally by space name and attribute
        if (p1.space != p2.space) { return p1.space.localeCompare(p2.space); }
        if (p1.cat2Or3Name != p2.cat2Or3Name) { return p1.cat2Or3Name.localeCompare(p2.cat2Or3Name); }
        // last regard as same
        return 0;
    });
    return strategies;
}
function displayPlan(progressOverwrites: ProgressOverwrite[], strategies: Strategy[], top: number = 10, detailIndex: number = 0) {
    for (const [strategy, strategyIndex] of strategies.slice(0, top).map((s, i) => [s, i] as const)) {
        const { space, cat2Or3Name, weapons, cat1Names, numbers } = strategy;
        cat1Names.sort((a1, a2) => AllSpaces[0].cat1.indexOf(a1) - AllSpaces[0].cat1.indexOf(a2));
        if (!weapons.length) {
            // no weapon means no cat1
            console.log(`${space}:${displayAttribute(cat2Or3Name)}: ${styleText('cyan', 'no')}`);
            continue;
        }

        const placeDisplay = styleText('white', `${strategyIndex + 1}: ${space}:${displayAttribute(cat2Or3Name)}:${cat1Names.map(displayAttribute).join(',')}`);
        const scoreDisplay = styleText('cyan', numbers[0].toString());
        console.log(`${placeDisplay}: ${scoreDisplay}`);

        let sb = '  ';
        for (const weapon of weapons) {
            const haveProgress = progressOverwrites.some(p => p.name == weapon.name) || !!weapon.progress;
            sb += styleText(haveProgress ? 'dim' : weapon.rarity == 5 ? 'yellow' : 'red', weapon.name);
            sb += styleText('gray', `,`);
        }
        console.log(sb);

        if (strategyIndex == detailIndex) {
            for (const weapon of weapons) {
                const progress = progressOverwrites.find(p => p.name == weapon.name)?.progress ?? weapon.progress;
                const displayProgress = progress ? ` [${progress.join(',')}]` : '';
                console.log(styleText(progress ? 'gray' : 'white', `  - ${weapon.attributes.map(displayAttribute).join(',')}: ${weapon.name}${displayProgress}`));
            }
        }
    }
}

// total count estimate, seems only can by monte carlo
// by always choosing the topmost place, and randomly generate 3 essences, display result game count
// TODO make it clear about progress overwrite mechanism
function simulate(baseProgress: ProgressOverwrite[]) {
    let gameCount = 0;
    let foodCount = 0;
    const currentProgress = [...baseProgress];
    while (currentProgress.length != AllWeapons.length) {
        const strategies = plan(currentProgress)[0];
        gameCount += 1;
        // console.log(`#${gameCount}(${currentProgress.length}/${notAllWeapons.length}): ` +
        //     `goto ${plan.spacename}:${displayAttribute(plan.attribute)}:${plan.cat1Attributes.map(displayAttribute).join(',')}`);
        const space = AllSpaces.find(s => s.name == strategies.space);
        // if cat1 does not length 3, filling whatever reamin from remaining cat1s
        const cat1pool = strategies.cat1Names.length == 3 ? strategies.cat1Names
            : strategies.cat1Names.concat(...new Array(3 - strategies.cat1Names.length).fill(0).map(_ => space.cat1.filter(c => !strategies.cat1Names.includes(c))[0]));
        const fix2 = space.cat2.includes(strategies.cat2Or3Name);
        const cat23pool = fix2 ? space.cat3 : space.cat2;
        // console.log(`  cat1pool ${cat1pool} cat23pool ${cat23pool}`);
        let sb = '  ';
        for (const [pullAttribute1, pullAttribute23] of [1, 2, 3].map(_ => [cat1pool[randomInt(3)], cat23pool[randomInt(8)]])) {
            const ding = AllWeapons.filter(w => !currentProgress.some(p => p.name == w.name))
                .find(w => w.attributes[0] == pullAttribute1
                    && w.attributes[1] == (fix2 ? strategies.cat2Or3Name : pullAttribute23)
                    && w.attributes[2] == (fix2 ? pullAttribute23 : strategies.cat2Or3Name));
            if (ding) {
                currentProgress.push({ name: ding.name, progress: [1, 1, 1] });
            } else {
                foodCount += 1;
            }
            const displayPull = `${displayAttribute(pullAttribute1)}-${displayAttribute(pullAttribute23)}-${displayAttribute(strategies.cat2Or3Name)}`;
            const displayDing = ding ? styleText('cyanBright', `!!${ding.name}`) : '';
            sb += `${displayPull}${displayDing}, `;
        }
        sb = sb.substring(0, sb.length - 2);
        // console.log(sb);
        if (gameCount > 1000) {
            console.log('>1000??');
            displayPlan(currentProgress, plan(currentProgress));
            break;
        }
    }
    console.log(`game count ${gameCount} food count ${foodCount}`);
    return gameCount;
}
function estimateOverallProgress(baseProgress: ProgressOverwrite[], times: number = 100) {
    let totalGameCount = 0;
    for (const _ of new Array(times).fill(0)) {
        totalGameCount += simulate([]);
    }
    let remainingTotalGameCount = 0;
    for (const _ of new Array(times).fill(0)) {
        remainingTotalGameCount += simulate(baseProgress);
    }
    console.log(`avg remain ${remainingTotalGameCount / times}/${totalGameCount / times} = ${remainingTotalGameCount / totalGameCount}`);
}

if (process.argv[2] == 'plan') {
    const selectedStrategy = +process.argv[3]; // this start from 1 don't forget
    if (isNaN(selectedStrategy)) {
        displayPlan([], plan([]));
    } else {
        displayPlan([], plan([]), Math.max(10, selectedStrategy), selectedStrategy - 1);
    }
} else if (process.argv[2] == 'simulate') {
    console.log('estimating... error work in progress');
    // estimateOverallProgress([]);
} else {
    console.log(`USAGE: node essence.ts plan | simulate`);
    process.exit(1);
}
