import fs from 'node:fs/promises';
import yaml from 'yaml';

const rawdata: Record<
    string,
    Record<string, string> /* oh this place cannot have a comma */
> = yaml.parse(await fs.readFile('equip/data.yml', 'utf-8'));

interface Equipment {
    set: string,
    name: string,
    kind: '护甲' | '护手' | '配件',
    // cat1 don't use percentage if you ask
    cat11: { attribute: string, value: number },
    cat12?: { attribute: string, value: number },
    // for percentage values, e.g. 46% results in value: 46,
    cat2: { attribute: string, value: number },
    tech: '息壤' | '赤铜' | '赫铜' | '灼铜',
    // ingredient amount
    price: 20 | 50,
}

const allEquipmentSetNames: string[] = [];
const allEquipmentNames: string[] = [];
const allEquipments: Equipment[] = [];
for (const [rawSetName, equipments] of Object.entries(rawdata.装备)) {
    if (allEquipmentSetNames.includes(rawSetName)) {
        console.log(`set name ${rawSetName} duplicate?`);
    }
    if (!rawSetName.endsWith('装备组')) {
        console.log(`set name ${rawSetName} not ends with 装备组?`);
    }
    const setname = rawSetName.substring(0, rawSetName.length - 3);
    allEquipmentSetNames.push(setname);
    for (const [equipmentName, rawValue] of Object.entries(equipments)) {
        if (equipmentName == '套组效果') { continue; }
        if (allEquipmentNames.includes(equipmentName)) {
            console.log(`equipment ${setname}.${equipmentName} duplicate?`);
        }
        allEquipmentNames.push(equipmentName);

        const splitted1 = rawValue.split('。').map(x => x.trim()).filter(x => x);
        if (splitted1.length != 1) {
            console.log(`${setname}.${equipmentName}: unexpected syntax? ${rawValue}`);
        }
        const rawProperties = splitted1[0].split('，').map(x => x.trim()).filter(x => x);
        if (rawProperties.length != 4 && rawProperties.length != 5) {
            console.log(`${setname}.${equipmentName}: unexpected syntax? ${splitted1[0]}`);
        }

        let kind: Equipment['kind'];
        let cat1s: Equipment['cat11'][] = [];
        let cat2: Equipment['cat2'];
        let tech: Equipment['tech'];
        let price: Equipment['price'];
        for (const rawProperty of rawProperties) {
            if (['护甲', '护手', '配件'].includes(rawProperty)) {
                if (kind) {
                    console.log(`${setname}.${equipmentName}: kind seems specified multiple times`);
                    continue;
                }
                kind = rawProperty as typeof kind; // you need this as?
                continue;
            }
            const cat1Name = ['敏捷', '力量', '意志', '智识', '主能力', '副能力'].find(n => rawProperty.startsWith(n));
            // don't match 主能力 and 副能力 ends with percentage
            if (cat1Name && !((cat1Name == '副能力' || cat1Name == '主能力') && rawProperty.endsWith('%'))) {
                // the plus sign can use parseInt I guess
                const value = +rawProperty.substring(cat1Name.length);
                if (isNaN(value)) {
                    console.log(`${setname}.${equipmentName}: property looks like start with cat1 but unexpected syntax? ${rawProperty}`);
                    continue;
                }
                if (cat1s.length >= 2) {
                    console.log(`${setname}.${equipmentName}: cat1 seems specified more than 2 times?`);
                    continue;
                }
                cat1s.push({ attribute: cat1Name, value });
                continue;
            }
            const cat2Name = [
                '源石技艺强度',
                '终结技充能效率',
                '寒冷和电磁伤害加成',
                '灼热和自然伤害加成',
                '战技伤害加成',
                '物理伤害加成',
                '法术伤害加成',
                '终结技伤害加成',
                '连携技伤害加成',
                '对失衡目标伤害加成',
                '普通攻击伤害加成',
                '所有技能伤害加成',
                '暴击率',
                '生命值',
                '全伤害减免',
                '治疗效率加成',
                '主能力',
                '副能力',
            ].find(n => rawProperty.startsWith(n));
            if (cat2Name) {
                let remaining = rawProperty.substring(cat2Name.length);
                if (cat2Name == '全伤害减免') { // seems only this don't have a plus sign?
                    // and remaining unchange
                } else if (remaining.startsWith('+')) { // normal plus sign
                    remaining = remaining.substring(1);
                } else {
                    // raise and continue with remaining unchanged
                    console.log(`${setname}.${equipmentName}: this cat2 seems need a +? ${rawProperty}`);
                }
                if (cat2Name == '源石技艺强度') { // seems only this don't have a percent?
                    // and remaining unchange
                } else if (remaining.endsWith('%')) { // normal percentage
                    remaining = remaining.substring(0, remaining.length - 1);
                } else {
                    // raise and continue with remaining unchanged
                    console.log(`${setname}.${equipmentName}: this cat2 seems need a %? ${rawProperty}`);
                }
                const value = +remaining;
                if (isNaN(value)) {
                    console.log(`${setname}.${equipmentName}: looks like cat2 but unexpected value? ${rawProperty}`);
                    continue;
                }
                if (cat2) {
                    console.log(`${setname}.${equipmentName}: cat2 seems specified multiple times?`);
                    continue;
                }
                cat2 = { attribute: cat2Name, value };
                continue;
            }
            if (rawProperty.startsWith('20') || rawProperty.startsWith('50')) {
                const maybeName = rawProperty.substring(2);
                const ingredientName = ['息壤', '赤铜', '赫铜', '灼铜'].find(n => n == maybeName);
                if (!ingredientName) {
                    console.log(`${setname}.${equipmentName}: looks like cat2 but unexpected syntax? ${rawProperty}`);
                    continue;
                }
                if (tech) {
                    console.log(`${setname}.${equipmentName}: ingredient seems specified multiple times`);
                    continue;
                }
                tech = ingredientName as any;
                price = rawProperty.startsWith('50') ? 50 : 20;
                continue;
            }
            console.log(`${setname}.${equipmentName}: unexpected property? ${rawProperty}`);
        }
        if (!kind) {
            console.log(`${setname}.${equipmentName}: seems missing kind?`);
            continue;
        } else if (cat1s.length < 1) {
            console.log(`${setname}.${equipmentName}: seems missing cat1?`);
            continue;
        } else if (!cat2) {
            console.log(`${setname}.${equipmentName}: seems missing cat2?`);
            continue;
        } else if (!tech) {
            console.log(`${setname}.${equipmentName}: seems missing ingredient?`);
            continue;
        }
        allEquipments.push({ set: setname, name: equipmentName, kind, cat11: cat1s[0], cat12: cat1s[1], cat2, tech, price });
        // console.log(`${setname}.${equipmentName}: ${kind}, ${ingredient.name}x${ingredient.amount}, ${
        //     cat1s[0].attribute}+${cat1s[0].value}, ${cat1s.length > 1 ? `${cat1s[1].attribute}+${cat1s[1].value}` : '(no cat1[1])'}, ${cat2.attribute}+${cat2.value}`);
    }
}
console.log(allEquipmentSetNames.length, allEquipments.length);

let passCount = 0;
for (const equipment of allEquipments) {
    // console.log(`${equipment.set}-${equipment.name}: ${equipment.kind}, ${equipment.tech}x${
    //     equipment.price}, ${equipment.cat11.attribute}+${equipment.cat11.value}, ${equipment.cat12 ? `${
    //         equipment.cat12.attribute}+${equipment.cat12.value}` : ('no cat12')}, ${equipment.cat2.attribute}+${equipment.cat2.value}`);

    // check price by the way
    // for following investigations, exclude 集成实训
    if (equipment.set == '集成实训' && equipment.price != 20) {
        console.log(`${equipment.set}-${equipment.name}: price not 20?`);
    } if (equipment.set != '集成实训' && equipment.price != 50) {
        console.log(`${equipment.set}-${equipment.name}: price not 50?`);
    }

    // cat11, oh I find these numbers are unique after I write down this
    const expectValue11 = {
        '-护甲-#2': 87,
        '-护手-#2': 65,
        '-配件-#2': 32,
        // #1 seems x1.25
        '-护甲-#1': 110,
        '-护手-#1': 76, // none yet, this is I guess
        '-配件-#1': 41,
        // they only have #1
        '涉渊纾难-护甲-#1': 115,
        '涉渊纾难-护手-#1': 86,
        '涉渊纾难-配件-#1': 43,
        // they only have #2
        '集成实训-护甲-#2': 74,
        '集成实训-护手-#2': 55,
        '集成实训-配件-#2': 27,
    }[[
        equipment.set == '集成实训' ? '集成实训' : equipment.set == '涉渊' || equipment.set == '纾难' ? '涉渊纾难' : '',
        equipment.kind,
        equipment.cat12 ? '#2' : '#1',
    ].join('-')]; 
    if (equipment.cat11.value != expectValue11) {
        console.log(`${equipment.set}-${equipment.name}: cat11 value ${equipment.cat11.value} != ${expectValue11}`);
    } else {
        passCount += 1;
    }

    // cat12
    if (equipment.cat12) {
        const expectValue12 = {
            '-护甲': 58,
            '-护手': 43,
            '-配件': 21,
            '集成实训-护甲': 49,
            '集成实训-护手': 37,
            '集成实训-配件': 18,
        }[[
            // 涉渊纾难 don't have cat12, leave them here in case human error or game data update
            equipment.set == '集成实训' ? '集成实训' : equipment.set == '涉渊' || equipment.set == '纾难' ? '涉渊纾难' : '',
            equipment.kind,
            // equipment.cat12 ? '#2' : '#1',
        ].join('-')];
        if (equipment.cat12.value != expectValue12) {
            console.log(`${equipment.set}-${equipment.name}: cat12 value ${equipment.cat12.value} != ${expectValue12}`);
        } else {
            passCount += 1;
        }
    }

    // cat 2, 配件's value is largest, use as base value
    // these values deeply reflect game creator's insight on numbers in game
    const expectValue2Base = {
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
        // only in 集成实训, reverse calculate to this
        '法术伤害加成': 21.9,
        '战技伤害加成': 41.4,
        '连携技伤害加成': 41.4,
        '终结技伤害加成': 51.8,
        '所有技能伤害加成': 27.6,
    }[equipment.cat2.attribute];

    const kindMultiplier = equipment.kind == '配件' ? 1 : equipment.kind == '护手' ? 5/6 : 0.5;
    const specialSetMultiplier = equipment.set == '集成实训' ? 0.85 : equipment.set == '涉渊' || equipment.set == '纾难' ? 1.05 : 1;
    const expectValue2 = expectValue2Base * kindMultiplier * specialSetMultiplier;

    // 9 values cannot pass 0.02 but can pass 0.025
    if (Math.abs((equipment.cat2.value - expectValue2) / expectValue2) > 0.025) {
        console.log(`${equipment.set}-${equipment.name}: cat2 value ${equipment.cat2.value} expect ${expectValue2} alias>0.03`);
    } else {
        passCount += 1;
    }
}
console.log(`pass count ${passCount}`);

// // after exclude 集成实训, cat1 and cat2 are exclusive set
// const allCat1AttributeNames = cat1numbers.map(n => n.attribute).sort((n1, n2) => n1.localeCompare(n2)).filter((n, i, a) => a.indexOf(n) == i);
// for (const attribute of allCat1AttributeNames) {
//     console.log(`${attribute}:`);
//     // all attribute has this context
//     const baseEntry = cat1numbers.find(n => n.attribute == attribute && n.context == '护甲-cat11-#2');
//     for (const entry of cat1numbers.filter(n => n.attribute == attribute).sort((n1, n2) => n1.context.localeCompare(n2.context))) {
//         // RESULT
//         // for #cat1=2, all numbers are 87,58;65,43;32,21
//         // 护甲-cat11-#2: 87,
//         // 护甲-cat12-#2: 58, 0.66
//         // 护手-cat11-#2: 65, 0.75 I guess
//         // 护手-cat12-#2: 43, 0.5 I guess
//         // 配件-cat11-#2: 32, what is 32/87~0.3678? 3/8? 4/11? 7/19 is very close, so this is a manual game balance tweak, not a simple number
//         // 配件-cat12-#2: 21, 0.25 I guess
//         // 
//         // 配件-cat11-#1: 41, what is 0.4712? 8/17, so another manual tweak
//         // 护甲-cat11-#1: 110, what is 1.2643?
//         // 集成实训cat1 are all 0.85
//         // without set cat1 护甲 115 护手86 配件43, they are 1.05x of normal cat11#1
//         console.log(`  ${entry.context}: ${entry.value} occurance ${entry.count} ratio ${entry.value / baseEntry.value}`);
//     }
// }
// const allCat2AttributeNames = cat2numbers.map(n => n.attribute).sort((n1, n2) => n1.localeCompare(n2)).filter((n, i, a) => a.indexOf(n) == i);
// for (const attribute of allCat2AttributeNames) {
//     console.log(`${attribute}:`);
//     // all attribute have 配件
//     const 配件entry = cat2numbers.find(n => n.attribute == attribute && n.context == '配件');
//     for (const entry of cat2numbers.filter(n => n.attribute == attribute).sort((n1, n2) => n1.context.localeCompare(n2.context))) {
//         // RESULT: all 护甲 is 0.5, 护手 is 0.83
//         // 涉渊 and 纾难 are all 1.05x
//         console.log(`  ${entry.context}: ${entry.value} occurance ${entry.count} ratio ${entry.value / 配件entry.value}`);
//     }
// }

// 我他妈枚举
// 主能力副能力在集成实训以外不做cat1
const cat1set = ['敏捷', '力量', '意志', '智识'];
// 法术伤害在集成实训外面没有，但是太合理了所以留着
const cat2set = [
    '源石技艺强度',
    '终结技充能效率',
    '寒冷和电磁伤害加成',
    '灼热和自然伤害加成',
    '战技伤害加成',
    '物理伤害加成',
    '法术伤害加成',
    '终结技伤害加成',
    '连携技伤害加成',
    '对失衡目标伤害加成',
    '普通攻击伤害加成',
    '所有技能伤害加成',
    '暴击率',
    '生命值',
    '全伤害减免',
    '治疗效率加成',
    '主能力',
    '副能力',
];
const table11 = {
    '-护甲-#2': 87,
    '-护手-#2': 65,
    '-配件-#2': 32,
    // #1 seems x1.25
    '-护甲-#1': 110,
    '-护手-#1': 76, // none yet, this is I guess
    '-配件-#1': 41,
};
const table12 = {
    '护甲': 58,
    '护手': 43,
    '配件': 21,
};
const table2 = {
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
    // only in 集成实训, reverse calculate to this
    '法术伤害加成': 21.9,
    '战技伤害加成': 41.4,
    '连携技伤害加成': 41.4,
    '终结技伤害加成': 51.8,
    '所有技能伤害加成': 27.6,
}

// let allcount = 0;
// let hitcount = 0;
// for (const kind of ['护甲', '护手', '配件']) {
//     for (const cat11 of cat1set) {
//         const cat11value1 = table11[`-${kind}-#1`];
//         const cat11value2 = table11[`-${kind}-#2`];
//         for (const cat2 of cat2set) {
//             const cat2valueBase = table2[cat2];
//             const kindMultiplier = kind == '配件' ? 1 : kind == '护手' ? 5/6 : 0.5;
//             const cat2value = cat2valueBase * kindMultiplier;
    
//             for (const cat12 of cat1set) {
//                 const cat12value = table12[kind];
//                 if (cat11 != cat12) {
//                     allcount += 1;
//                     const match = allEquipments.find(e => e.kind == kind && e.cat11.attribute == cat11 && e.cat12?.attribute == cat12 && e.cat2.attribute == cat2);
//                     hitcount += match ? 1 : 0;
//                     console.log(`${cat11}+${cat11value2}, ${cat12}+${cat12value}, ${cat2}+${cat2value}${match ? ` (${match.name})` : ''}`);
//                 }
//             }
//             allcount += 1;
//             const match = allEquipments.find(e => e.kind == kind && e.cat11.attribute == cat11 && !e.cat12 && e.cat2.attribute == cat2);
//             hitcount += match ? 1 : 0;
//             console.log(`${cat11}+${cat11value1}, ${cat2}+${cat2value}${match ? ` (${match.name})` : ''}`);
//         }
//     }
// }
// // 127/864?
// console.log(`${hitcount} / ${allcount} = ${hitcount / allcount}`);

// TODO 狗粮
// TODO not this, that should be all kind-attribute combination's dogfood
// const equipmentOkUsages: { name: string, count: number }[] = [];
// const equipmentGoodUsages: { name: string, count: number }[] = [];
// for (const equipment of allEquipments) {
//     const query = (targetAttribute: string, targetValue: number) => {
//         const goods = allEquipments.filter(e => e.kind == equipment.kind
//             && ((e.cat11.attribute == targetAttribute && e.cat11.value > targetValue)
//             || (e.cat12 && e.cat12.attribute == targetAttribute && e.cat12.value > targetValue)
//             || (e.cat2.attribute == targetAttribute && e.cat2.value > targetValue)));
//         if (goods.length > 1) {
//             console.log(`${equipment.set}-${equipment.name}: attribute ${targetAttribute} multiple goods: ${goods.map(g => g.name)}`);
//         }
//         if (goods.length) {
//             const entry = equipmentGoodUsages.find(e => e.name == goods[0].name);
//             if (entry) { entry.count += 1; }
//             else { equipmentGoodUsages.push({ name: goods[0].name, count: 1 }); }
//         } else {
//             const oks = allEquipments.filter(e => e.kind == equipment.kind
//                 && ((e.cat11.attribute == targetAttribute && e.cat11.value == targetValue)
//                 || (e.cat12 && e.cat12.attribute == targetAttribute && e.cat12.value == targetValue)
//                 || (e.cat2.attribute == targetAttribute && e.cat2.value == targetValue)));
//             if (oks.length == 1) {
//                 console.log(`${equipment.set}-${equipment.name}: attribute ${targetAttribute} self only: ${oks[0].name}`);
//             }
//             // ok must include self
//             const entry = equipmentOkUsages.find(e => e.name == oks[0].name);
//             if (entry) { entry.count += 1; }
//             else { equipmentOkUsages.push({ name: oks[0].name, count: 1 }); }
//         }
//     };
//     query(equipment.cat11.attribute, equipment.cat11.value);
//     if (equipment.cat12) { query(equipment.cat12.attribute, equipment.cat12.value); }
//     query(equipment.cat2.attribute, equipment.cat2.value);
// }
// console.log('good:');
// for (const good of equipmentGoodUsages) {
//     console.log(`${good.name}: ${good.count}`);
// }
// console.log('ok:');
// for (const good of equipmentOkUsages) {
//     console.log(`${good.name}: ${good.count}`);
// }

const usefulEquipmentNames = new Set<string>();
for (const kind of ['护甲', '护手', '配件']) {
    for (const attribute of cat1set.concat(cat2set)) {
        let maxValue = 0;
        let equipmentNames: string[] = [];
        for (const equipment of allEquipments) {
            if (equipment.kind == kind) {
                if (equipment.cat11.attribute == attribute) {
                    equipmentNames = equipment.cat11.value > maxValue ? [equipment.name] : equipment.cat11.value == maxValue ? [...equipmentNames, equipment.name] : equipmentNames;
                    maxValue = Math.max(equipment.cat11.value, maxValue);
                    // console.log(`${equipment.name}: after ${maxValue}, ${equipmentNames}`);
                } else if (equipment.cat12 && equipment.cat12.attribute == attribute) {
                    equipmentNames = equipment.cat12.value > maxValue ? [equipment.name] : equipment.cat12.value == maxValue ? [...equipmentNames, equipment.name] : equipmentNames;
                    maxValue = Math.max(equipment.cat12.value, maxValue);
                } else if (equipment.cat2.attribute == attribute) {
                    equipmentNames = equipment.cat2.value > maxValue ? [equipment.name] : equipment.cat2.value == maxValue ? [...equipmentNames, equipment.name] : equipmentNames;
                    maxValue = Math.max(equipment.cat2.value, maxValue);
                }
            }
        }
        equipmentNames.forEach(n => usefulEquipmentNames.add(n));
        console.log(`${kind}-${attribute}: ${equipmentNames}: +${maxValue}`);
    }
}
// TODO their usages
const usefulEquipments = allEquipments.filter(e => usefulEquipmentNames.has(e.name));
console.log(usefulEquipments.map(e => `${e.set}-${e.name}`).join('\n'));
console.log(usefulEquipments.length, allEquipments.length);
