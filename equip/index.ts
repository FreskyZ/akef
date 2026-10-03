import fs from 'node:fs/promises';
import yaml from 'yaml';

type EquipmentKind = '护甲' | '护手' | '配件';
const EquipmentKinds: EquipmentKind[] = ['护甲', '护手', '配件'];

type EquipmentTech = '息壤' | '赤铜' | '赫铜' | '灼铜';
const EquipmentTechs: EquipmentTech[] = ['息壤', '赤铜', '赫铜', '灼铜'];

interface EquipmentAttribute {
    name: string,
    // for now all cat1 don't use percentage,
    // for cat2 except 源石技艺强度 all use percentage,
    // for percentage values e.g. 46% result in value: 46 here
    value: number,
}
interface Equipment {
    set: string,
    name: string,
    kind: EquipmentKind,
    tech: EquipmentTech,
    // ingredient amount
    // 20 currently only in 集成实训, other all use 50
    price: 20 | 50,
    // this copies concept from essence script if you forget
    // cat1 is 敏力意智主, cat2 is like 源石技艺强度,etc. cat3 is not in equipment
    // NOTE that essence and equip have different cat1 set and cat2 set
    cat11: EquipmentAttribute,
    cat12?: EquipmentAttribute,
    cat2: EquipmentAttribute,
}

const Cat1Names = [
    '敏捷',
    '力量',
    '意志',
    '智识',
    // currently only in 集成实训,
    // because the parsing function allows any order of properties,
    // it is distinguished with cat2 by cat1 don't end with percentage
    '主能力',
    '副能力',
];
// cat1 base values,
// - all of them may be calculated from the most basic value 87, but the amount of special
//   values is not far less than this flat table, and is way more complex than a flat table
// - by the way, currently these numbers seems unique
const getCat1Value = (set: string, kind: EquipmentKind, cat1Sequence: 1 | 2, cat1Length: 1 | 2) => ({
    '护甲-cat11-#2': 87,
    '护手-cat11-#2': 65, // = 87x0.75
    '配件-cat11-#2': 32,
    // cat1-#1 seems x1.25
    '护甲-cat11-#1': 110,
    '护手-cat11-#1': 76, // currently no such data, I guess this
    '配件-cat11-#1': 41,
    // these only have #1, look like x1.05
    '涉渊纾难-护甲-cat11-#1': 115,
    '涉渊纾难-护手-cat11-#1': 86,
    '涉渊纾难-配件-cat11-#1': 43,
    // these only have #2, look like x0.85
    '集成实训-护甲-cat11-#2': 74,
    '集成实训-护手-cat11-#2': 55,
    '集成实训-配件-cat11-#2': 27,
    // cat2
    '护甲-cat12': 58, // = 87x0.66
    '护手-cat12': 43, // = 87x0.5
    '配件-cat12': 21, // = 87x0.25
    '集成实训-护甲-cat12': 49,
    '集成实训-护手-cat12': 37,
    '集成实训-配件-cat12': 18,
})[[
    set == '集成实训' ? '集成实训' : set == '涉渊' || set == '纾难' ? '涉渊纾难' : '',
    kind,
    `cat1${cat1Sequence}`,
    // cat12 implies length=2
    cat1Sequence == 1 ? `#${cat1Length}` : '',
].filter(x => x).join('-')];

// cat2 name to their base values
// these values appear in 配件 position,
// you may notice that 护甲 has highest cat1 values, and 配件 have highest cat2 values
const Cat2Values = {
    '主能力': 20.7,
    '副能力': 20.7,
    '生命值': 41.4,
    '全伤害减免': 17.2,
    '治疗效率加成': 20.7,
    '终结技充能效率': 24.6,
    '暴击率': 10.4,
    '源石技艺强度': 41,
    '普通攻击伤害加成': 27.6,
    '物理伤害加成': 23,
    '对失衡目标伤害加成': 41.4,
    '寒冷和电磁伤害加成': 23,
    '灼热和自然伤害加成': 23,
    // currently only in 集成实训, reverse calculate to this
    '法术伤害加成': 21.9,
    '战技伤害加成': 41.4,
    '连携技伤害加成': 41.4,
    '终结技伤害加成': 51.8,
    '所有技能伤害加成': 27.6,
};
const getCat2Value = (set: string, kind: EquipmentKind, attribute: string) =>
    Cat2Values[attribute]
    // kind multiplier, base value is 配件, 护手 x5/6, 护甲 x0.5
    * (kind == '配件' ? 1 : kind == '护手' ? 5 / 6 : 0.5)
    // special set multipler, 集成实训x0.85, 涉渊纾难x1.05
    * (set == '集成实训' ? 0.85 : set == '涉渊' || set == '纾难' ? 1.05 : 1);

function readData(originalContent: string) {

    const rawdata: Record<string, Record<string, string>> = yaml.parse(originalContent);
    if (!rawdata.装备) { console.log(`unrecognized file structure?`); return; }

    const allSetNames: string[] = [];
    const allEquipments: Equipment[] = [];
    for (const [rawSetName, equipments] of Object.entries(rawdata.装备)) {
        if (allSetNames.includes(rawSetName)) {
            console.log(`set name ${rawSetName} duplicate?`);
        }
        if (!rawSetName.endsWith('装备组')) {
            console.log(`set name ${rawSetName} not end with 装备组?`);
        }
        const setName = rawSetName.substring(0, rawSetName.length - 3);
        allSetNames.push(setName);
        for (const [equipmentName, rawValue] of Object.entries(equipments)) {
            if (equipmentName == '套组效果') { continue; }
            if (allEquipments.some(e => e.name == equipmentName)) {
                console.log(`${setName}-${equipmentName}: duplicate name?`);
            }

            // I may want to put something in second sentence, but for now the expected count is 1
            const splitted1 = rawValue.split('。').map(x => x.trim()).filter(x => x);
            if (splitted1.length != 1) {
                console.log(`${setName}-${equipmentName}: unexpected syntax? ${rawValue}`);
            }
            const rawProperties = splitted1[0].split('，').map(x => x.trim()).filter(x => x);
            if (rawProperties.length != 4 && rawProperties.length != 5) {
                console.log(`${setName}-${equipmentName}: unexpected sentence 1 syntax? ${splitted1[0]}`);
            }

            const data = { set: setName, name: equipmentName } as Equipment;
            for (const rawProperty of rawProperties) {
                // kind
                if (EquipmentKinds.includes(rawProperty as any)) {
                    if (data.kind) {
                        console.log(`${data.set}-${data.name}: kind specified multiple times? ${rawProperties}`);
                    } else {
                        data.kind = rawProperty as any;
                    }
                    continue;
                }
                // tech and price
                if (rawProperty.startsWith('50') || rawProperty.startsWith('20')) {
                    if (data.tech) {
                        console.log(`${data.set}-${data.name}: tech and price specified multiple times? ${rawProperties}`);
                        continue;
                    }
                    data.tech = EquipmentTechs.find(n => n == rawProperty.substring(2));
                    if (!data.tech) {
                        console.log(`${data.set}-${data.name}: looks like tech but unexpected syntax? ${rawProperty}`);
                        continue;
                    }
                    data.price = rawProperty.startsWith('50') ? 50 : 20;
                    if (setName == '集成实训' && data.price != 20) {
                        console.log(`${setName}-${equipmentName}: 集成实训 but price != 20?`);
                    } else if (setName != '集成实训' && data.price != 50) {
                        console.log(`${data.set}-${data.name}: price != 50?`);
                    }
                    continue;
                }
                // cat1, but not starts with 主能力 or 副能力 and ends with percentage
                if (Cat1Names.some(n => rawProperty.startsWith(n)) && !/^(主|副)能力.*%$/.test(rawProperty)) {
                    if (data.cat11 && data.cat12) {
                        console.log(`${data.set}-${data.name}: cat1 specified more than 2 times?`);
                        continue;
                    }

                    const attributeName = Cat1Names.find(n => rawProperty.startsWith(n));
                    // currently cat1 don't use percentage
                    // then you can directly parse the remaining content with leading plus sign
                    const value = +rawProperty.substring(attributeName.length);
                    if (isNaN(value)) {
                        console.log(`${data.set}-${data.name}: looks like cat1 but unexpected syntax? ${rawProperty}`);
                        continue;
                    }
                    if (!data.cat11) {
                        data.cat11 = { name: attributeName, value };
                    } else {
                        data.cat12 = { name: attributeName, value };
                    }
                    continue;
                }
                // cat2
                if (Object.keys(Cat2Values).some(n => rawProperty.startsWith(n))) {
                    if (data.cat2) {
                        console.log(`${data.set}-${data.name}: cat2 specified multiple times?`);
                        continue;
                    }
                    const attributeName = Object.keys(Cat2Values).find(n => rawProperty.startsWith(n));
                    let remaining = rawProperty.substring(attributeName.length);
                    // currently only this don't have a plus sign
                    if (attributeName == '全伤害减免') {
                        // no change to remaining
                    } else if (remaining.startsWith('+')) {// normal attributes have a plus sign
                        remaining = remaining.substring(1);
                    } else {
                        // print error and no change to remaining
                        console.log(`${data.set}-${data.name}: cat2 seems missing a +? ${rawProperty}`);
                    }
                    // currently only this don't use percentage
                    if (attributeName == '源石技艺强度') {
                        // no change to remaining
                    } else if (remaining.endsWith('%')) {
                         remaining = remaining.substring(0, remaining.length - 1);
                    } else {
                        // print error and no change to remaining
                        console.log(`${data.set}-${data.name}: cat2 seems missing a %? ${rawProperty}`);
                    }
                    const value = +remaining;
                    if (isNaN(value)) {
                        console.log(`${setName}.${equipmentName}: looks like cat2 but unexpected syntax? ${rawProperty}`);
                        continue;
                    }
                    data.cat2 = { name: attributeName, value };
                    continue;
                }
                // unexpected syntax
                console.log(`${setName}.${equipmentName}: unexpected syntax? ${rawProperty}`);
            }

            const missingProperties: string[] = [
                data.kind ? '' : 'kind',
                data.tech ? '' : 'tech',
                data.cat11 ? '' : 'cat1',
                data.cat2 ? '' : 'cat2',
            ].filter(x => x);
            if (missingProperties.length) {
                console.log(`${data.set}-${data.name}: missing required properties? ${missingProperties}`);
                continue;
            }

            // validate values
            const expectedValue11 = getCat1Value(data.set, data.kind, 1, data.cat12 ? 2 : 1);
            if (data.cat11.value != expectedValue11) {
                console.log(`${data.set}-${data.name}: cat11 ${data.cat11.name} value ${data.cat11.value} != expect ${expectedValue11}`);
                console.log(`${data.set}-${data.name}: this normally means a human error, but may be new game content and design in future`);
            }
            if (data.cat12) {
                const expectedValue12 = getCat1Value(data.set, data.kind, 2, 2);
                if (data.cat12.value != expectedValue12) {
                    console.log(`${data.set}-${data.name}: cat11 ${data.cat12.name} value ${data.cat12.value} != expect ${expectedValue12}`);
                    console.log(`${data.set}-${data.name}: this normally means a human error, but may be new game content and design in future`);
                }
            }
            const expectedValue2 = getCat2Value(data.set, data.kind, data.cat2.name);
            if (Math.abs((data.cat2.value - expectedValue2) / expectedValue2) > 0.025) {
                console.log(`${data.set}-${data.name}: cat11 ${data.cat2.name} value ${data.cat2.value} != expect ${expectedValue2}`);
                console.log(`${data.set}-${data.name}: this normally means a human error, but may be new game content and design in future`);
            }

            allEquipments.push(data);
        }
    }
    console.log(`collected ${allEquipments.length} equipments in ${allSetNames.length} sets`);
    return allEquipments;
}

const allEquipments = readData(await fs.readFile('equip/data.yml', 'utf-8'));
// for (const equipment of allEquipments) {
//     console.log(`${equipment.set}-${equipment.name}: ${equipment.kind}, ${equipment.tech}x${equipment.price}, ${equipment.cat11.name}+${equipment
//         .cat11.value}, ${equipment.cat12 ? `${equipment.cat12.name}+${equipment.cat12.value}` : '(nocat12)'}, ${equipment.cat2.name}+${equipment.cat2.value}`)
// }

// interesting investigation, how many attribute combinations are occupied
function test1() {
    let allCount = 0;
    let hitCount = 0;
    const notSpecialSetEquipments = allEquipments.filter(e => !['集成实训'].includes(e.set));
    for (const kind of EquipmentKinds) {
        for (const cat11Name of Cat1Names.slice(0, 4)) {
            const cat11ValueWithCat12 = getCat1Value('normal-set', kind, 1, 2);
            const cat11ValueWithoutCat12 = getCat1Value('normal-set', kind, 1, 1);
            for (const cat12Name of Cat1Names.slice(0, 4).filter(n => n != cat11Name)) {
                const cat12Value = getCat1Value('normal-set', kind, 2, 2);
                for (const cat2Name of Object.keys(Cat2Values).filter(n => n != '法术伤害加成')) {
                    const cat2Value = getCat2Value('normal-set', kind, cat2Name);
                    const matches = notSpecialSetEquipments.filter(e => e.kind == kind
                        && e.cat11.name == cat11Name && e.cat12?.name == cat12Name && e.cat2.name == cat2Name).map(e => e.name);
                    console.log(`${kind}: ${cat11Name}+${cat11ValueWithCat12}, ${cat12Name}+${cat12Value}, ${cat2Name}+${cat2Value}${matches.length ? ` (${matches})` : ''}`);
                    allCount += 1;
                    hitCount += matches.length ? 1 : 0;
                }
            }
            for (const cat2Name of Object.keys(Cat2Values).filter(n => n != '法术伤害加成')) {
                const cat2Value = getCat2Value('normal-set', kind, cat2Name);
                const matches = notSpecialSetEquipments.filter(e => e.kind == kind
                    && e.cat11.name == cat11Name && !e.cat12 && e.cat2.name == cat2Name).map(e => e.name);
                console.log(`${kind}: ${cat11Name}+${cat11ValueWithoutCat12}, ${cat2Name}+${cat2Value}${matches.length ? ` (${matches})` : ''}`);
                allCount += 1;
                hitCount += matches.length ? 1 : 0;
            }
        }
    }
    // include 主能力副能力 in cat1, include 法术伤害加成 in cat2:
    //   all 1944 combinations, hit 114 (5.86%) combinations with current 139 (non special set) equipments
    //   allcount = 3(kind) x 6(cat11) x (5(cat12) x 18(cat2) + 18(cat2)) = 1944
    // not include:
    //   all 816 combinations, hit 114 (13.97%) combinations with current 139 (non special set) equipments
    // match 涉渊纾难:
    //   all 816 combinations, hit 127 (15.56%) combinations with current 152 (non special set) equipments
    console.log(`all ${allCount} combinations, hit ${hitCount} (${hitCount / allCount
        * 100}%) combinations with current ${notSpecialSetEquipments.length} (non special set) equipments`);
}
// test1();

function dogfood() {
    // for 集成实训, they have low value so cannot be used as main equipment,
    // cat2 主能力 and 副能力 cannot use cat1 主能力 and 副能力 as dogfood, and
    // their cat 1 attribute 主能力 and 副能力 is not used outside, so they cannot be used as normal equipment's dogfood,
    // their cat 2 value is low so as long as normal equipment have same kind-attribute combination, it cannot use this
    // set of equipments as dogfood according to game rule, so can completely ignore 集成实训 here

    const relatedEquipments = allEquipments.filter(e => e.set != '集成实训');
    const kindAttributeCombinations = relatedEquipments
        .flatMap(e => [e.cat11.name, e.cat12?.name, e.cat2.name].filter(x => x).map(n => [e.kind, n] as const))
        .sort(([k1, a1], [k2, a2]) => // sort k and a in their definition order
            EquipmentKinds.indexOf(k1) * 100 + Cat1Names.concat(Object.keys(Cat2Values)).indexOf(a1)
            - EquipmentKinds.indexOf(k2) * 100 + Cat1Names.concat(Object.keys(Cat2Values)).indexOf(a2))
        .filter((e, i, a) => a.findIndex(o => o[0] == e[0] && o[1] == e[1]) == i);
    const possibleCombinationsCount = 3 * (Cat1Names.length - 2 + Object.keys(Cat2Values).length - 1);
    // currently 55/63
    console.log(`${kindAttributeCombinations.length} combinations of ${possibleCombinationsCount} possible combinations from ${relatedEquipments.length} related equipments`);

    const dogfoodTechs: { kind: string, attribute: string, 灼铜装备原件amount: number }[] = [];
    for (const [kind, attribute] of kindAttributeCombinations) {
        const equipments = relatedEquipments.map(e => e.kind != kind ? null
            : e.cat11.name == attribute ? [e, e.cat11.value] as const
            : e.cat12?.name == attribute ? [e, e.cat12.value] as const
            : e.cat2.name == attribute? [e, e.cat2.value] as const : null).filter(x => x);        
        const values = equipments.map(e => e[1]).sort((a, b) => b - a).filter((e, i, a) => a.indexOf(e) == i);
        console.log(`${kind}-${attribute}:`);
        for (const value of values) {
            const equipmentsOfThisValue = equipments.filter(e => e[1] == value).map(e => e[0]);
            // for max value, display their price
            if (value == values[0]) {
                equipmentsOfThisValue.sort((e1, e2) => EquipmentTechs.indexOf(e1.tech) - EquipmentTechs.indexOf(e2.tech));
                console.log(`   ${value}: ${equipmentsOfThisValue.map(e => `${e.name}(${e.tech})`).slice(0, 5)}${equipmentsOfThisValue.length > 5 ? '...' : ''}`);
                const tech = equipmentsOfThisValue[0].tech;
                dogfoodTechs.push({ kind, attribute, 灼铜装备原件amount: tech == '息壤' || tech == '赤铜' ? 5 : tech == '赫铜' ? 25 : 50 });
            } else {
                console.log(`   ${value}: ${equipmentsOfThisValue.map(e => e.name).slice(0, 5)}${equipmentsOfThisValue.length > 5 ? '...' : ''}`);
            }
        }
    }
    // RESULT
    // for cat1 attributes combinations, 4x3=12 is all covered by 涉渊纾难 equipments
    // for cat2 attributes combinations, 13 涉渊纾难 equipments cover 13 of 17x3 cat2 attributes
    // for remaining cat2 combinations, its cat2 value is exactly defined by kind-attribute combination, so they are all same
    // or more specifically, cat2 combination only have 1 kind of value (without 涉渊纾难) or 2 kinds of value (higher one is 涉渊纾难)

    // ratio of 灼铜装备原件 and 精锻助剂,
    // every 精锻 attempt use 1 精锻助剂 and 5/25/50 灼铜装备原件,
    // so the ratio for a specific equipment+attribute is irrelavent whether you use 3 attempts or 41 attempts
    // it is relavent if one equipment+attribute use more attempts than others, but they should use same probability so ignore
    let 精锻助剂Count = 0; // count by regarding as 1 attempt success
    let 灼铜装备原件Count = 0; // count by regarding as 1 attempt success
    for (const equipment of relatedEquipments) {
        精锻助剂Count += 2 + (equipment.cat12 ? 1 : 0);
        灼铜装备原件Count += dogfoodTechs.find(t => t.kind == equipment.kind && t.attribute == equipment.cat11.name).灼铜装备原件amount;
        灼铜装备原件Count += dogfoodTechs.find(t => t.kind == equipment.kind && t.attribute == equipment.cat2.name).灼铜装备原件amount;
        if (equipment.cat12) {
            灼铜装备原件Count += dogfoodTechs.find(t => t.kind == equipment.kind && t.attribute == equipment.cat12.name).灼铜装备原件amount;
        }
    }
    const average = 灼铜装备原件Count / 精锻助剂Count;
    console.log(`every *week* you need ${120 * average} 灼铜装备零件, that is ${120 * average / 7 / 1440} per minute`);
}
dogfood();
