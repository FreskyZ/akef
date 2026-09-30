
interface ItemData {
    name: string, // name for human
    icon?: [number, number],
    pinyin: string, // pinyin for string
}
interface RecipeData {
    name: string,
    machine: string,
    time?: number,
    vibe?: string,
    event?: true,
    inputs: { name: string, count?: number }[],
    outputs: { name: string, count?: number }[],
}

const pagedata = (window as any)['thepagedata'] as Readonly<{
    items: ReadonlyArray<ItemData>,
    'filled-items': ReadonlyArray<string>,
    recipes: ReadonlyArray<RecipeData>,
}>;
// spirit sheet size
function calculateItemImageSize(count: number) {
    const gridWidth = Math.ceil(Math.sqrt(count));
    const gridHeight = gridWidth * (gridWidth - 1) < count ? gridWidth : gridWidth - 1;
    return [gridWidth * 40, gridHeight * 40];
}
const itemImageSize = calculateItemImageSize(pagedata.items.filter(i => i.icon).length);

const elements = {
    itemList: document.querySelector('nav ul') as HTMLUListElement,
    searchInput: document.querySelector('input#search') as HTMLInputElement,
    main: document.querySelector('main'),
    sortButton: document.querySelector('button#sort') as HTMLButtonElement,
    clearButton: document.querySelector('button#clear') as HTMLButtonElement,
    limitedTimeCheckbox: document.querySelector('input#limited-time') as HTMLInputElement,
    recipeFilterInput: document.querySelector('textarea#muzumi') as HTMLTextAreaElement,
};
function setupNavigationBar() {
    for (const item of pagedata.items) {
        const itemElement = document.createElement('li');
        itemElement.dataset['id'] = item.name;
        const imageElement = document.createElement('div');
        imageElement.className = 'image';
        
        // allow item without image should be useful for test data and new data without image
        if (item.icon) {
            imageElement.style.backgroundImage = `url("./item.avif")`;
            imageElement.style.backgroundSize = `${itemImageSize[0]}px ${itemImageSize[1]}px`;
            // background-position is very mysterious
            // https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/background-position
            imageElement.style.backgroundPosition = `${-item.icon[1] * 40}px ${-item.icon[0] * 40}px`;
        } else {
            // there is already a name beside, so display a NA here
            // imageElement.alt = item.name;
            imageElement.innerText = 'N/A';
        }
        itemElement.appendChild(imageElement);
        const nameElement = document.createElement('div');
        nameElement.className = 'name';
        nameElement.innerText = item.name;
        itemElement.appendChild(nameElement);
        elements.itemList.appendChild(itemElement);
        itemElement.addEventListener('click', () => handleToggleOpen(item));
    }
}
setupNavigationBar();

// layout algorithm only need these
interface NodeLike {
    data?: any,
    children: NodeLike[],
    position?: number,
    thread?: NodeLike,
    threadOffset?: number,
}
interface ItemNode extends NodeLike {
    data: ItemData,
    // bottle item and fluid item, in that case, .data is fake object not from pagedata.items
    filled?: [ItemData, ItemData],
    // depth is x coordinate
    depth: number,
    // display an ellipsis for
    // - duplicate node on the path
    // - fresh water is normally collected, should not use other recipe's side product as major recipe
    // - sewage as input, this is side product, no need to display full
    // - phase transitioner, don't regard phase transitioning as major recipe
    // - unstable env, this recipe have stable env version, no need to display this
    ellipsisReason?: 'duplicate' | 'fresh-water' | 'sewage-reuse' | 'phase-transitioner' | 'unstable-env',
    children: RecipeNode[],
    possibleProducts: ItemData[],
    // recipes for sewage harmless treatment
    vanishingRecipes: RecipeData[],
}
interface RecipeNode extends NodeLike {
    // id, name, machineId, time, ingredients, products
    data: RecipeData,
    // depth is x coordinate
    depth: number,
    // use node[] here should make tree operations easier
    // when need to display count, find them in node.data.ingredients
    children: ItemNode[],
    // a placeholder node don't render itself, for now placeholder node is for
    // - a node place after ellipsis node so that the ellipsis does not collide with other connect lines
    // - a node to allocate space for multiple product recipes to display side products, allocate space
    //   mean it self is not a node to be rendered but leave space for the recipe node to display more information
    kind?: 'placeholder',
}

// for duplicate item in tree, allow same item appear in different line, disallow same item in same line
// path: node id[] from root to current item, include root, not include current item, empty for the main item
// return ItemNode
function collectRecipeTree(item: ItemData, path: string[], includeLimitedTime: boolean, ellipsisReasonHint?: ItemNode['ellipsisReason']) {
    const itemNode: ItemNode = {
        data: item,
        depth: path.length,
        children: [],
        possibleProducts: [],
        vanishingRecipes: [],
    };
    if (pagedata["filled-items"].includes(item.name)) {
        const [bottleName, fluidName] = item.name.split('-');
        const bottleData = pagedata.items.find(i => i.name == bottleName);
        const fluidData = pagedata.items.find(i => i.name == fluidName);
        itemNode.filled = [bottleData, fluidData];
    }

    if (path.includes(item.name)) {
        itemNode.ellipsisReason = 'duplicate';
        itemNode.children.push({ data: null, depth: path.length, children: [], kind: 'placeholder' });
        return itemNode;
    } else if (item.name == '清水' && path.length != 0) {
        itemNode.ellipsisReason = 'fresh-water';
        itemNode.children.push({ data: null, depth: path.length, children: [], kind: 'placeholder' });
        return itemNode;
    } else if (ellipsisReasonHint) {
        itemNode.ellipsisReason = ellipsisReasonHint;
        itemNode.children.push({ data: null, depth: path.length, children: [], kind: 'placeholder' });
        return itemNode;
    }

    // all following pagedata.recipes use this filter
    const disabledRecipes = parseRecipeFilterSetting();
    const visibleRecipes = pagedata.recipes.filter(r => (includeLimitedTime || !r.event) && !disabledRecipes.includes(r.name));
    if (!path.length) {
        const productItemNames = new Set<string>();
        for (const recipe of visibleRecipes.filter(r => r.inputs.some(r => r.name == item.name))) {
            // dont include fill bottle recipes in possible products...
            if (recipe.outputs.length == 1 && pagedata["filled-items"].includes(recipe.outputs[0].name)) {
                // ...but you can include the result bottle+fluid item's possible products
                for (const nextrecipe of visibleRecipes.filter(r => r.inputs.some(r => r.name == recipe.outputs[0].name))) {
                    // filled item don't have a filled item possible product
                    nextrecipe.outputs.forEach(r => productItemNames.add(r.name));
                }
            } else {
                recipe.outputs.forEach(r => productItemNames.add(r.name));
            }
        }
        itemNode.possibleProducts = Array.from(productItemNames).map(n => pagedata.items.find(i => i.name == n));
        // when will there be limited time vanishing recipes?
        itemNode.vanishingRecipes = visibleRecipes.filter(r => r.inputs.some(r => r.name == item.name) && r.outputs.length == 0);
    }
    // this was 10, but new game content, namely 赫铜 technology, really push this pass 10
    if (path.length > 20) {
        throw new Error('unexpected too deep');
    }

    let lastRecipeTrailingElementsSpace = 0;
    const relatedRecipes = visibleRecipes.filter(r => r.outputs.some(r => r.name == item.name));
    for (const recipe of relatedRecipes) {
        // see recipe node layout, if recipe's element require more space than available, namely 72px
        // allocate a dummy node that regard as a full node in layout process to leave space in real render process
        // NOTE this is effectively another push away logic that only happens between a subtree root node's direct child nodes,
        // while does not account for insufficient space between different subtrees e.g. between the rightmost direct child node
        // and one of the right subtrees' specific node, but the layout agorithm is already very complex and I don't want to add
        // a brand new layer of complexity so ignore this scenario for now
        const thisRecipeLeadingElementsSpace = (recipe.vibe ? 16 : 0) + (recipe.machine == '固气转化机' || recipe.machine == '液气转化机' ? 16 : 0);
        // UPDATE this is more error when you find the subtrees are already pushing away because of subtree themselves' descendent node
        // because current data don't have >16 leading space and > 24 trailing space, disable this logic for now, old value is 36 if you forget
        if (lastRecipeTrailingElementsSpace + thisRecipeLeadingElementsSpace > 360) {
            // console.log(`placeholder node before recipe ${recipe.name}`);
            itemNode.children.push({ data: recipe, depth: path.length, children: [], kind: 'placeholder' });
        }
        lastRecipeTrailingElementsSpace = (recipe.outputs.length - 1) * 24 + (recipe.event ? 12 : 0);

        const children: ItemNode[] = [];
        for (const input of recipe.inputs) {
            if (pagedata["filled-items"].includes(input.name)) {
                // bottle+fluid don't have a entry in pagedata.items
                children.push(collectRecipeTree({
                    name: input.name,
                    icon: null,
                    pinyin: null,
                }, [...path, item.name], includeLimitedTime));
            } else {
                // when will there be limited time sewage reuse recipes?
                const ellipsisReason = visibleRecipes.some(r => r.inputs.some(r => r.name == item.name) && r.outputs.length == 0) ? 'sewage-reuse'
                    // when there is only one recipe and is phase transitioning, don't ellipsis it
                    : relatedRecipes.length > 1 && recipe.machine == '固气转化机' || recipe.machine == '液气转化机' ? 'phase-transitioner'
                    : !recipe.vibe && relatedRecipes.some(r => {
                        if (r.vibe != '惰气') { return false; }
                        // lazy to handle side product
                        if (recipe.outputs.length != 1 || r.outputs.length != 1) { return false; }
                        if (recipe.inputs.length != r.inputs.length) { return false; }
                        // this compare only happen inside this function, so can use localecompare
                        const thisInputs = recipe.inputs.filter(i => i.name != '分离芯').sort((i1, i2) => i1.name.localeCompare(i2.name));
                        const thatInputs = r.inputs.filter(i => i.name != '分离芯').sort((i1, i2) => i1.name.localeCompare(i2.name));
                        // only compare name, the amount will be displayed before the branch is stopped by ellipsis reason
                        if (thisInputs.some((thisInput, index) => thisInput.name != thatInputs[index].name)) { return false; }
                        return true;
                    }) ? 'unstable-env'
                    : null;
                const inputItemData = pagedata.items.find(i => i.name == input.name);
                children.push(collectRecipeTree(inputItemData, [...path, item.name], includeLimitedTime, ellipsisReason));
            }
        }
        itemNode.children.push({ data: recipe, depth: path.length, children });
    }
    return itemNode;
}

function layoutRecipeTree(tree: NodeLike) {
    // position in this layout algorithm represents 1 unit in render operation, this min distance must be 1
    const MinDistance = 1;
    function setup(thisnode: NodeLike) {
        for (const child of thisnode.children.filter(c => c.children.length)) { setup(child); }
        if (thisnode.children.length == 1) { thisnode.children[0].position = 0; return; }

        const childCount = thisnode.children.length;
        const childIndexSequence = new Array(childCount).fill(0).map((_, i) => i);
        childIndexSequence.forEach(childIndex => thisnode.children[childIndex].position = childIndex == 0 ? 0 : MinDistance);

        let activeIndexes = childIndexSequence.map(i => i);
        const leftCursors = thisnode.children.map(n => n);
        const leftCursorOffsets = thisnode.children.map(() => 0);
        const rightCursors = thisnode.children.map(n => n);
        const rightCursorOffsets = thisnode.children.map(() => 0);

        let leftmostDescendantPosition = 0;
        let rightmostNodes = childIndexSequence.map(childIndex =>
            childIndex == childCount - 1 ? { node: thisnode.children[childIndex], offset: 0 } : { node: null, offset: undefined });

        while (activeIndexes.length) {

            for (const childIndex of activeIndexes) {
                if (leftCursors[childIndex].thread) {
                    leftCursorOffsets[childIndex] += leftCursors[childIndex].threadOffset;
                    leftCursors[childIndex] = leftCursors[childIndex].thread;
                } else if (leftCursors[childIndex].children.length) {
                    leftCursors[childIndex] = leftCursors[childIndex].children[0];
                    leftCursorOffsets[childIndex] += leftCursors[childIndex].position;
                } else if (childIndex != activeIndexes[0] || activeIndexes.length == 1) {
                    leftCursors[childIndex] = null;
                }

                if (rightCursors[childIndex].thread) {
                    rightCursorOffsets[childIndex] += rightCursors[childIndex].threadOffset;
                    rightCursors[childIndex] = rightCursors[childIndex].thread;
                } else if (rightCursors[childIndex].children.length) {
                    rightCursors[childIndex] = rightCursors[childIndex].children[rightCursors[childIndex].children.length - 1];
                    rightCursorOffsets[childIndex] += rightCursors[childIndex].position;
                } else if (childIndex != activeIndexes[activeIndexes.length - 1] || activeIndexes.length == 1) {
                    rightCursors[childIndex] = null;
                }
            }

            const newActiveIndexes = activeIndexes.filter((childIndex, i) => i == 0 ? rightCursors[childIndex] : leftCursors[childIndex]);
            if (newActiveIndexes.length > 1) {
                for (const [leftIndex, rightIndex] of new Array(newActiveIndexes.length - 1)
                    .fill(0).map((_, i) => [newActiveIndexes[i], newActiveIndexes[i + 1]]))
                {
                    let subtreeDistance = 0;
                    for (let childIndex = leftIndex + 1; childIndex <= rightIndex; childIndex++) {
                        subtreeDistance += thisnode.children[childIndex].position;
                    }
                    if (subtreeDistance + leftCursorOffsets[rightIndex] - rightCursorOffsets[leftIndex] < MinDistance) {
                        const increaseDistance = MinDistance - leftCursorOffsets[rightIndex] + rightCursorOffsets[leftIndex] - subtreeDistance;
                        if (leftIndex + 1 == rightIndex) {
                            thisnode.children[rightIndex].position += increaseDistance;
                        } else {
                            for (let childIndex = leftIndex + 1; childIndex <= rightIndex; childIndex++) {
                                thisnode.children[childIndex].position += increaseDistance / (rightIndex - leftIndex);
                            }
                        }
                    }
                }
            }

            // this initialized to activeindexes[0] and if subtree activeindexes[0] ends and created thread here,
            // this variable points to the threaded node's subtree, this does not necessary mean updated leftcursors[leftmostchildindex] is more left than initial leftcursors[leftmostchildindex] 
            let leftmostChildIndex = activeIndexes[0];
            if (activeIndexes.length > 1 && !rightCursors[leftmostChildIndex]) {
                let subtreeDistance = 0;
                let nextLeftmostChildIndexIndex = 1;
                while (nextLeftmostChildIndexIndex < activeIndexes.length && !leftCursors[activeIndexes[nextLeftmostChildIndexIndex]]) {
                    subtreeDistance += thisnode.children[activeIndexes[nextLeftmostChildIndexIndex]].position;
                    nextLeftmostChildIndexIndex += 1;
                }
                if (nextLeftmostChildIndexIndex < activeIndexes.length) {
                    const nextLeftmostChildIndex = activeIndexes[nextLeftmostChildIndexIndex];
                    subtreeDistance += thisnode.children[nextLeftmostChildIndex].position;
                    // if you think leftcursors records nodes at same level, that's because leftcursors[leftmostchildindex] has ended and don't move forward and kept at last level
                    leftCursors[leftmostChildIndex].thread = leftCursors[nextLeftmostChildIndex];
                    leftCursors[leftmostChildIndex].threadOffset = leftCursorOffsets[nextLeftmostChildIndex] - leftCursorOffsets[leftmostChildIndex] + subtreeDistance;
                    leftmostChildIndex = nextLeftmostChildIndex;
                }
            }
            let rightmostChildIndex = activeIndexes[activeIndexes.length - 1];
            if (activeIndexes.length > 1 && !leftCursors[rightmostChildIndex]) {
                let subtreeDistance = thisnode.children[rightmostChildIndex].position;
                let nextRightmostChildIndexIndex = activeIndexes.length - 2;
                while (nextRightmostChildIndexIndex >= 0 && !rightCursors[activeIndexes[nextRightmostChildIndexIndex]]) {
                    subtreeDistance += thisnode.children[activeIndexes[nextRightmostChildIndexIndex]].position;
                    nextRightmostChildIndexIndex -= 1;
                }
                if (nextRightmostChildIndexIndex >= 0) {
                    const nextRightmostChildIndex = activeIndexes[nextRightmostChildIndexIndex];
                    rightCursors[rightmostChildIndex].thread = rightCursors[nextRightmostChildIndex];
                    rightCursors[rightmostChildIndex].threadOffset = rightCursorOffsets[nextRightmostChildIndex] - rightCursorOffsets[rightmostChildIndex] - subtreeDistance;
                    rightmostChildIndex = nextRightmostChildIndex;
                }
            }

            activeIndexes = newActiveIndexes;
            if (activeIndexes.length) {
                leftmostDescendantPosition = Math.min(leftmostDescendantPosition, thisnode.children[leftmostChildIndex].position + leftCursorOffsets[leftmostChildIndex]);
                if (!rightmostNodes[rightmostChildIndex].node || rightmostNodes[rightmostChildIndex].offset < rightCursorOffsets[rightmostChildIndex]) {
                    rightmostNodes[rightmostChildIndex].node = rightCursors[rightmostChildIndex];
                    rightmostNodes[rightmostChildIndex].offset = rightCursorOffsets[rightmostChildIndex];
                }
            }
        } // this is end of the main loop if you lost track

        let subtreeDistance = 0;
        let rightmostDescendantPosition = 0;
        for (const childIndex of childIndexSequence) {
            if (childIndex != 0) {
                subtreeDistance += thisnode.children[childIndex].position;
            }
            if (rightmostNodes[childIndex].node) {
                rightmostDescendantPosition = Math.max(rightmostDescendantPosition, subtreeDistance + rightmostNodes[childIndex].offset);
            }
        }

        let currentPosition = -(leftmostDescendantPosition + rightmostDescendantPosition) / 2;
        for (const child of thisnode.children) {
            currentPosition = child.position += currentPosition;
        }
    }
    setup(tree);

    let cursor = tree;
    let cursorPosition = 0;
    let minCursorPosition = 0;
    while (true) {
        if (cursor.thread) {
            cursorPosition += cursor.threadOffset;
            cursor = cursor.thread;
            minCursorPosition = Math.min(minCursorPosition, cursorPosition);
        } else if (cursor.children.length) {
            cursor = cursor.children[0];
            cursorPosition += cursor.position;
            minCursorPosition = Math.min(minCursorPosition, cursorPosition);
        } else {
            break;
        }
    }
    function setPosition(node: NodeLike, position: number) {
        node.position = position;
        node.thread = null;
        node.threadOffset = undefined;
        for (const child of node.children) {
            setPosition(child, position + child.position);
        }
    }
    setPosition(tree, -minCursorPosition);
}

// this name inherits from jsx?
function j<K extends keyof HTMLElementTagNameMap>(parent: Element, tag: K, props: {
    className?: string,
    dataset?: Record<string, string>,
    style?: Partial<CSSStyleDeclaration>,
    // frequently used style, add a special props to make them simpler
    left?: number, top?: number, width?: number, height?: number,
    innerText?: string,
}, additionalOperations?: (e: HTMLElementTagNameMap[K]) => void): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag);
    if (props?.className) { element.className = props.className; }
    if (props?.dataset) { Object.assign(element.dataset, props.dataset); }
    if (props?.style) { Object.assign(element.style, props.style); }
    if (props?.left) { element.style.left = `${props.left}px`; }
    if (props?.top) { element.style.top = `${props.top}px`; }
    if (props?.width) { element.style.width = `${props.width}px`; }
    if (props?.height) { element.style.height = `${props.height}px`; }
    if (props?.innerText) { element.innerText = props.innerText; }
    if (additionalOperations) { additionalOperations(element); }
    parent.appendChild(element);
    return element;
}

const ClockIcon = [
    "M512 64C264.6 64 64 264.6 64 512s200.6 448 448 448 448-200.6 448-448S759.4 64 512 64zm0 820c-205.4 0-372-166.6-372-372s166.6-372 372-372 372 166.6 372 372-166.6 372-372 372z",
    "M686.7 638.6L544.1 535.5V288c0-4.4-3.6-8-8-8H488c-4.4 0-8 3.6-8 8v275.4c0 2.6 1.2 5 3.3 6.5l165.4 120.6c3.6 2.6 8.6 1.8 11.2-1.7l28.6-39c2.6-3.7 1.8-8.7-1.8-11.2z",
];
const ProductIcon = [
    "M464 144a16 16 0 0116 16v304a16 16 0 01-16 16H160a16 16 0 01-16-16V160a16 16 0 0116-16zm-52 68H212v200h200zm493.33 87.69a16 16 0 010 22.62L724.31 503.33a16 16 0 01-22.62 0L520.67 322.31a16 " +
    "16 0 010-22.62l181.02-181.02a16 16 0 0122.62 0zm-84.85 11.3L713 203.53 605.52 311 713 418.48zM464 544a16 16 0 0116 16v304a16 16 0 01-16 16H160a16 16 0 01-16-16V560a16 16 0 0116-16zm-52 " +
    "68H212v200h200zm452-68a16 16 0 0116 16v304a16 16 0 01-16 16H560a16 16 0 01-16-16V560a16 16 0 0116-16zm-52 68H612v200h200z",
];

function createSVGElement(parent: Element, pathdata: string[], className?: string) {
    const svgns = 'http://www.w3.org/2000/svg';
    const svgElement = document.createElementNS(svgns, 'svg');
    svgElement.setAttribute('viewBox', '64 64 896 896');
    svgElement.setAttribute('fill', 'currentColor');
    if (className) { svgElement.setAttribute('class', className); }
    for (const data of pathdata) {
        const pathElement = document.createElementNS(svgns, 'path');
        pathElement.setAttribute('d', data);
        svgElement.appendChild(pathElement);
    }
    parent.appendChild(svgElement);
    return svgElement;
}
function setupImageElement(element: HTMLDivElement, item: ItemData) {
    if (item.icon) {
        element.style.backgroundImage = `url("./item.avif")`;
        element.style.backgroundSize = `${itemImageSize[0]}px ${itemImageSize[1]}px`;
        element.style.backgroundPosition = `-${item.icon[1] * 40}px -${item.icon[0] * 40}px`;
        // // this is not good, cannot control alpha of one of the images, and if you want to make overlay image smaller, the other items again appears into the border
        // element.style.backgroundImage = `url("./item.avif"), url("./item.avif")`;
        // element.style.backgroundSize = `${itemImageSize[0]}px ${itemImageSize[1]}px, ${itemImageSize[0]}px ${itemImageSize[1]}px`;
        // // multiple background image z index is *defined* to be reversed, why?
        // element.style.backgroundPosition = `-${filled[1].icon[1] * 40}px -${filled[1].icon[0] * 40}px, -${filled[0].icon[1] * 40}px -${filled[0].icon[0] * 40}px`;
    } else {
        element.innerText = 'N/A';
    }
}
function setupSmallImageElement(element: HTMLDivElement, item: ItemData, size: number) {
    if (item.icon) {
        element.style.backgroundImage = `url("./item.avif")`;
        element.style.backgroundSize = `${itemImageSize[0]  * size / 40}px ${itemImageSize[1] * size / 40}px`;
        element.style.backgroundPosition = `-${item.icon[1] * size}px -${item.icon[0] * size}px`;
    } else {
        element.innerText = 'N/A';
    }
}

function setupDragMove(element: HTMLDivElement) {
    let beginX = 0;
    let beginY = 0;
    element.addEventListener('mousedown', e => {
        if ((e.target as any).matches('input')) {
            return; // do not drag input
        }
        e.preventDefault();
        beginX = e.clientX;
        beginY = e.clientY;
        element.style.cursor = 'grabbing';
        element.addEventListener('mouseup', handleMouseUp);
        element.addEventListener('mousemove', handleMouseMove);
        function handleMouseMove(e: MouseEvent) {
            e.preventDefault();
            element.style.left = (element.offsetLeft - beginX + e.clientX) + 'px';
            element.style.top = (element.offsetTop - beginY + e.clientY) + 'px';
            beginX = e.clientX;
            beginY = e.clientY;
        }
        function handleMouseUp(_: MouseEvent) {
            element.style.cursor = ''; // reset to use css specified cursor: grab
            element.removeEventListener('mouseup', handleMouseUp);
            element.removeEventListener('mousemove', handleMouseMove);
        }
    });
}

// TODO try move phase transitioning items beside main item,
// something like, 息壤溶液 <==5 相变机 2==> 息壤气 <==1 相变机 1==>, and draw their own recipes
// this is very large change, only work if there is other large change planed for this program,
// in that case, formalize node's width concept in layout algorithm, current layout algorithm node
// don't have a width and is only limited by their minimal distance is 1, to handle different width
// recipe nodes and item nodes, assign a calculated width (in px) to nodes, and change minimal distance to like 8px or 16px

function drawRecipeTree(root: ItemNode) {

    // you can go down boundaries of the tree for this information,
    // but I'd like to avoid layout algorithm internals outside, so visit all nodes
    let maxDepth = 0;
    let maxPosition = -100;
    function collectCoordinates(node: ItemNode | RecipeNode) {
        // don't count placeholder node
        if ((node as RecipeNode).kind == 'placeholder') { return; }
        maxDepth = Math.max(maxDepth, node.depth);
        maxPosition = Math.max(maxPosition, node.position);
        for (const child of node.children) {
            collectCoordinates(child);
        }
    }
    collectCoordinates(root);

    // position: unit of position, as in node.position and node.depth,
    //           one item *or* one recipe occupy 1 unit of height, one item *and* one recipe occupy 1 unit of width
    // standardize calculation:
    //   - panel left, right, bottom padding 32px, top padding 40px (because of title bar)
    //     this restrict on visual element, or item's img and text, recipe's machine name and information
    //   - item height img 48px + text 24px, recipe height info 12px * 2 + machine name 24px, so cell height is 72px
    //     node with .position = 0 starts at .top = 40, so for all nodes .top = cellheight * .position + 40
    //   - item node grid template 12px 48px 12px, recipe node grid template 12px 72px 12px
    //   - distance between item and item's recipe, recipe and recipe's item should be same
    //     this distance should contain leading connect line and following connect line width 12px and collect line width 8px
    //     so cell width = item img 48px + machine name 72px + 2 gaps 2 * 32px = 184px
    //   - item with .depth = maxdepth's img should be at .left = 32px, so .item-node's .left = 20px
    //     so for all .item-node, .left = cellwidth * (maxdepth - .depth) + 20
    //   - recipe with .depth = maxdepth - 1's machine name should be at img.left = 32px + img width 48px + gap 32px = 112px
    //     so .recipe-node's .left is 100px, so for all .recipe-node, .left = cellwidth * (maxdepth - 1 - .depth) + 100
    //   - if no possible products, root item with .depth = 0 have .left = cellwidth * maxdepth + 20
    //     root item's img calculated .right is cellwidth * maxdepth + 80, so panel .width = cellwidth * maxdepth + 112
    //     if have possible products, gap is 32px, product's img width 48px, so add 80 more to panel width, or + 192
    //   - if no possible products, item with .position = maxposition have top: cellheight * maxposition + 40
    //     add another cellheight for bottom of this node, add 32px panel padding bottom, so panel .height = cellheight * (maxposition + 1) + 72
    //     for possible products, height is cellheight * products.length + 40px padding top + 32px padding bottom
    //     so panel height is the larger one cellheight * max(maxposition + 1, products.length) + 72
    const CellWidth = 184;
    const CellHeight = 72;

    const panelElement = j(elements.main, 'div', {
        className: 'panel',
        dataset: { 'id': root.data.name },
        left: 100,
        top: 100,
        width: CellWidth * maxDepth + 112 + (root.possibleProducts.length + root.vanishingRecipes.length ? 80 : 0), 
        // calculate result require 72, but seems too much padding bottom, reduce some
        height: CellHeight * (Math.max(maxPosition + 1, root.possibleProducts.length  + root.vanishingRecipes.length)) + 60,
    }, element => {
        setupDragMove(element);
        element.addEventListener('mousedown', e => {
            handleFocusPanel(root.data.name);
        });
    });
    /* close */ j(panelElement, 'button', { className: 'close', innerText: 'X' },
        e => e.addEventListener('click', () => handleClosePanel(root.data.name)));
    /* title */ j(panelElement, 'span', { className: 'title', innerText: root.data.name });

    // try bfs to make element order in main element more clear
    let remainingItems: [ItemNode, string[]][] = [[root, []]]; // item and ancestor path
    while (remainingItems.length > 0) {
        const newRemainingItems: [ItemNode, string[]][] = [];
        for (const [item, path] of remainingItems) {
            createNode(item, path);
            for (const recipe of item.children) {
                for (const childItem of recipe.children) {
                    newRemainingItems.push([childItem, [...path, item.data.name, recipe.data.name]]);
                }
            }
        }
        remainingItems = newRemainingItems;
    }

    function createNode(item: ItemNode, path: string[]) {
        const parentRecipe = path.length == 0 ? null : pagedata.recipes.find(r => r.name == path.at(-1));

        const itemElement = j(panelElement, 'div', {
            className: 'item-node' + (item.data.name == root.data.name && path.length == 0 ? ' main-item-node' : ''),
            dataset: { 'id': item.data.name, 'parentrecipe': parentRecipe?.name },
            left: CellWidth * (maxDepth - item.depth) + 20,
            top: CellHeight * item.position + 40,
        });
        
        function setupItemImageHighlightTrigger(e: HTMLElement, itemName: string) {
            const selectors = [
                `div.item-node[data-id="${itemName}"]>div.image-wrapper`,
                `div.recipe-line[data-id="${itemName}"]`,
            ];
            e.addEventListener('mouseenter', () => selectors.map(selector =>
                Array.from(panelElement.querySelectorAll(selector)).forEach(e => e.classList.add('highlight'))));
            e.addEventListener('mouseleave', () => selectors.map(selector =>
                Array.from(panelElement.querySelectorAll(selector)).forEach(e => e.classList.remove('highlight'))));
        }

        // you can use background-origin: content-box to avoid background-position take padding into calculation,
        // but this still cannot avoid other item's image appear in padding area, so have to use an image wrapper
        const imageWrapperElement = j(itemElement, 'div', { className: 'image-wrapper' }, e => {
            setupItemImageHighlightTrigger(e, item.data.name);
            if (item.data.name != root.data.name) { e.addEventListener('click', () => handleOpenPanel(item.data)); }
        });
        if (item.filled) {
            /* image */ j(imageWrapperElement, 'div', { className: 'image' }, e => setupImageElement(e, item.filled[0]));
            /* overlay image */ j(imageWrapperElement, 'div', { className: 'image overlay-image' }, e => setupImageElement(e, item.filled[1]));
        } else {
            /* image */ j(imageWrapperElement, 'div', { className: 'image' }, e => setupImageElement(e, item.data));
        }
        // item-node width 72 cannot fit in "bottle with liquid" names, add a container to allow more width
        /* name-container */ j(itemElement, 'div', { className: 'name' }, nameContainer => {
            /* name */ j(nameContainer, 'span', { innerText: item.data.name });
        });

        if (item.ellipsisReason) {
            const tooltip = {
                'duplicate': '之前在链路上出现过了',
                'fresh-water': '虽然也有配方可以产生水，但是你应该用采集的水',
                'sewage-reuse': '污水是这些配方的副产物，所以就不继续显示了，想看可以点进去',
                'phase-transitioner': '相变机的配方就不继续显示了，想看可以点进去',
                'unstable-env': '这个配方有惰气环境版本，你总不需要这个吧',
            }[item.ellipsisReason];
            /* virtual left connect line */ j(itemElement, 'div', { className: 'connect-line connect-line1 connect-line-virtual' }, e => e.title = tooltip);
        } else if (item.children.length) {
            /* left connect line */ j(itemElement, 'div', { className: 'connect-line connect-line1' });
        }

        if (parentRecipe) {
            const amount = parentRecipe.inputs.find(i => i.name == item.data.name).count ?? 1;
            /* amount */ j(itemElement, 'span', { className: 'amount', innerText: `×${amount}` });
            /* right connect line */ j(itemElement, 'div', { className: 'connect-line connect-line2', dataset: { 'recipe': parentRecipe.name } });
        }
        for (const recipe of item.children) {
            if (recipe.kind == 'placeholder') { continue; } // don't connect with placeholder nodes

            const direction = item.position > recipe.position ? 'down' : item.position == recipe.position ? 'level' : 'up';
            // collect line belong to panel element, not item element
            /* collect line */ j(panelElement, 'div', {
                className: `collect-line collect-line-${direction}`,
                dataset: { 'item': item.data.name, 'recipe': recipe.data.name },
                // item-node.left - collect-line.width
                left: CellWidth * (maxDepth - item.depth) + 12,
                // item-node.top + half of img height 24
                top: CellHeight * (direction == 'up' ? item.position : recipe.position) + 64,
                height: CellHeight * Math.abs(recipe.position - item.position),
            });
        }

        if (item.possibleProducts.length + item.vanishingRecipes.length) {
            /* virtual right connect line */ j(itemElement, 'div', { className: 'connect-line connect-line2 connect-line-virtual' });

            const entries = item.possibleProducts
                .map<['product', ItemData] | ['recipe', RecipeData]>(p => ['product', p])
                .concat(item.vanishingRecipes.map(r => ['recipe', r]))
                .map((e, i) => [e, i] as const);
            // if products length < maxposition + 1, then products should be centered around root node's position
            //   if length == 1, baseposition should be same as root item position, if length == 2, baseposition should be root item position -0.5
            // else products should tightly fit in complete height of the panel
            const basePosition = entries.length < maxPosition + 1 ? root.position - (entries.length - 1) / 2 : 0;
            for (const [[kind, entryData], entryIndex] of entries) {
                const entryPosition = basePosition + entryIndex;
                const productElement = j(panelElement, 'div', {
                    className: 'product-node',
                    dataset: { 'id': kind == 'product' ? entryData.name : entryData.name },
                    // same gap between root item and possible product item,
                    // so this left is same as recipe position with depth = -1
                    left: CellWidth * maxDepth + 100,
                    // same as item-node regarding entryPosition as item.position
                    top: CellHeight * entryPosition + 40,
                }, kind == 'product' ? e => e.addEventListener('click', () => handleOpenPanel(entryData)) : undefined);

                const imageWrapperElement = j(productElement, 'div', { className: 'image-wrapper' });
                /* image */ j(imageWrapperElement, 'div', { className: 'image' }, e =>
                    // possible products don't include filled item
                    kind == 'product' ? setupImageElement(e, entryData) : e.innerText = entryData.name);

                /* name container */ j(productElement, 'div', { className: 'name' }, nameContainer => {
                    /* name */ j(nameContainer, 'span', { innerText: kind == 'product' ? entryData.name : entryData.machine })
                });
                /* connect line */ j(productElement, 'div', { className: 'connect-line' });

                // spread line: opposite of collect line
                // direction is source to target's direction, so direction is also kind of reversed compared to collect-line
                const direction = item.position > entryPosition ? 'up' : item.position == entryPosition ? 'level' : 'down';
                /* spread line */ j(panelElement, 'div', {
                    className: `spread-line spread-line-${direction}`,
                    dataset: { 'id': kind == 'product' ? entryData.name : entryData.name },
                    // product-node.left - spread line width 8
                    left: CellWidth * maxDepth + 92,
                    // same as item collect line, item-node.top + 24
                    top: CellHeight * (direction == 'up' ? entryPosition : item.position) + 64,
                    height: CellHeight * Math.abs(entryPosition - item.position),
                });
            }
        }

        for (const recipe of item.children.filter(r => r.kind != 'placeholder')) {

            const vibeItem = recipe.data.vibe ? pagedata.items.find(i =>
                i.name == { '息壤': '息壤气', '惰气': '惰气', '酸气': '酸气' }[recipe.data.vibe]) : null;
            const isPhaseTransitioner = recipe.data.machine == '固气转化机' || recipe.data.machine == '液气转化机';
            const leadingElementsSpace = (vibeItem ? 16 : 0) + (isPhaseTransitioner ? 16 : 0);

            const recipeElement = j(panelElement, 'div', {
                className: `recipe-node`,
                dataset: { 'id': recipe.data.name },
                left: CellWidth * (maxDepth - recipe.depth - 1) + 100,
                top: CellHeight * recipe.position + 40 - leadingElementsSpace,
            });

            // vibe
            if (vibeItem) {
                const vibeLineElement = j(recipeElement, 'div', {
                    className: 'recipe-line vibe-line',
                    dataset: { 'id': vibeItem.name },
                }, e => {
                    setupItemImageHighlightTrigger(e, vibeItem.name);
                    e.addEventListener('click', () => { if (item.data.name != vibeItem.name) { handleOpenPanel(vibeItem); } });
                });
                /* image */ j(vibeLineElement, 'div', { className: 'image' }, e => setupSmallImageElement(e, vibeItem, 16));
                /* description */ j(vibeLineElement, 'span', {}, e => e.innerText = `${recipe.data.vibe}环境`);
            }
            // extra input
            if (isPhaseTransitioner) {
                const xiranGasItem = pagedata.items.find(i => i.name == '息壤气');
                const extraInputLineElement = j(recipeElement, 'div', {
                    className: 'recipe-line extra-input-line',
                    dataset: { 'id': xiranGasItem.name },
                }, e => {
                    e.title = '意思是机器不在工作的时候也要息壤气6/min';
                    setupItemImageHighlightTrigger(e, xiranGasItem.name);
                    e.addEventListener('click', () => { if (item.data.name != xiranGasItem.name) { handleOpenPanel(xiranGasItem); } });
                });
                /* image */ j(extraInputLineElement, 'div', { className: 'image' }, e => setupSmallImageElement(e, xiranGasItem, 16));
                /* description */ j(extraInputLineElement, 'span', {}, e => e.innerText = `息壤气 6/min`);
            }

            // time and amount
            const amount = recipe.data.outputs.find(p => p.name == item.data.name).count ?? 1;
            const basicInfoElement = j(recipeElement, 'div', { className: 'recipe-line basic-info-line' });
            /* time icon */ createSVGElement(basicInfoElement, ClockIcon, 'time-icon');
            /* time */ j(basicInfoElement, 'span', { className: 'time', innerText: `${recipe.data.time ?? 2}s` });
            /* amount icon */ createSVGElement(basicInfoElement, ProductIcon, 'amount-icon');
            /* amount */ j(basicInfoElement, 'span', { className: 'amount' +
                (amount != 1 ? ` amount-not-1` : ''), innerText: `×${amount}` }, e => e.title = '产物数量' + (amount != 1 ? '大于1！' : ''));
    
            // machine name and connect lines
            const mainLineElement = j(recipeElement, 'div', { className: 'recipe-line main-line' });
            /* left connect line */ j(mainLineElement, 'div', { className: 'connect-line connect-line1' });
            /* machine name */ j(mainLineElement, 'div', { className: `machine-name`, innerText: recipe.data.machine }, e => {
                e.title = recipe.data.name;
                const selector = `div.recipe-node[data-id="${recipe.data.name}"]>div.main-line>div.machine-name`;
                e.addEventListener('mouseenter', () =>
                    Array.from(panelElement.querySelectorAll(selector)).forEach(e => e.classList.add('highlight')));
                e.addEventListener('mouseleave', () =>
                    Array.from(panelElement.querySelectorAll(selector)).forEach(e => e.classList.remove('highlight')));
            });
            /* right connect line */ j(mainLineElement, 'div', { className: 'connect-line connect-line2' });
            for (const item of recipe.children) {
                const direction = recipe.position > item.position ? 'down' : recipe.position == item.position ? 'level' : 'up';
                // collect line belong to panel element, not recipe element
                /* collect line */ j(panelElement, 'div', {
                    className: `collect-line collect-line-${direction}`,
                    dataset: { 'item': item.data.name, 'recipe': recipe.data.name },
                    // recipe-node.left - collect line width 8
                    left: CellWidth * (maxDepth - recipe.depth - 1) + 92,
                    // item-node.top + 24
                    top: CellHeight * (direction == 'up' ? recipe.position : item.position) + 64,
                    height: CellHeight * Math.abs(item.position - recipe.position),
                });
            }

            // side products
            for (const output of recipe.data.outputs.filter(o => o.name != item.data.name)) {
                // for now side product will not be filled item
                const sideProductItem = pagedata.items.find(i => i.name == output.name);
                const sideProductElement = j(recipeElement, 'div', {
                    className: 'recipe-line side-product-line',
                    dataset: { 'id': sideProductItem.name },
                }, e => {
                    e.title = '副产物（有的时候这个才是主产物）';
                    setupItemImageHighlightTrigger(e, sideProductItem.name);
                    e.addEventListener('click', () => { if (sideProductItem.name != root.data.name) { handleOpenPanel(sideProductItem); } });
                });
                /* image */ j(sideProductElement, 'div', { className: 'image' }, e => setupSmallImageElement(e, sideProductItem, 24));
                /* amount */ j(sideProductElement, 'span', { className: 'amount' }, e => e.innerText = `${sideProductItem.name}x${output.count ?? 1}`);
            }
            // limited time
            if (recipe.data.event) {
                const limitedTimeLineElement = j(recipeElement, 'div', { className: 'recipe-line limited-time-line' });
                /* text */ j(limitedTimeLineElement, 'span', {}, e => e.innerText = '活动限时配方');
            }

        }
    }
}

let sortMethod: 'normal' | 'active' = 'normal';
const sortMethodDescription = {
    'normal': '现在是默认排序，点一下换成打开的窗口排在前面',
    'active': '现在是打开的窗口排在前面，点一下换成默认排序',
};
elements.sortButton.title = sortMethodDescription[sortMethod];
elements.sortButton.addEventListener('click', () => {
    sortMethod = sortMethod == 'normal' ? 'active' : 'normal';
    elements.itemList.parentElement.scrollTo({ top: 0, behavior: 'smooth' });
    updateItemList();
});
elements.clearButton.addEventListener('click', () => {
    Array.from(elements.main.querySelectorAll('div.panel')).forEach(p => p.remove());
    updateItemList();
});
// update item list sort order, active state and by the way sort button
function updateItemList() {
    // active
    const panels: HTMLDivElement[] = Array.from(elements.main.querySelectorAll('div.panel'));
    const panelIds = new Set(panels.map(p => p.dataset['id']));
    const items: HTMLLIElement[] = Array.from(elements.itemList.querySelectorAll('li'));
    items.forEach(i => panelIds.has(i.dataset['id']) ? i.classList.add('active') : i.classList.remove('active'));

    // sort order
    elements.sortButton.title = sortMethodDescription[sortMethod];
    elements.sortButton.style.background = sortMethod == 'active' ? 'lightgray' : '';
    if (sortMethod == 'normal') {
        // NOTE don't localecompare here, it is not compatible with make- scripts that use utf8 byte sequence
        items.sort((i1, i2) => pagedata.items.findIndex(i => i.name == i1.dataset['id']) - pagedata.items.findIndex(i => i.name == i2.dataset['id']));
    } else {
        items.sort((i1, i2) => {
            const i1InPanel = panelIds.has(i1.dataset['id']) ? 0 : 1;
            const i2InPanel = panelIds.has(i2.dataset['id']) ? 0 : 1;
            return i1InPanel != i2InPanel ? i1InPanel - i2InPanel
                // NOTE don't localecompare here, it is not compatible with make- scripts that use utf8 byte sequence
                : pagedata.items.findIndex(i => i.name == i1.dataset['id']) - pagedata.items.findIndex(i => i.name == i2.dataset['id']);
        });
    }
    items.forEach(i => elements.itemList.appendChild(i));
}

elements.searchInput.addEventListener('change', () => {
    updateItemListDisplay();
});
// for now, it is NOT implemented to update or close opened panel because of this checkbox change
const limitedTimeCheckboxStorageKey = 'advanced-recipe-tree:display-limited-time';
elements.limitedTimeCheckbox.addEventListener('change', () => {
    updateItemListDisplay();
    localStorage.setItem(limitedTimeCheckboxStorageKey, elements.limitedTimeCheckbox.checked ? '1' : '0');
});
const recipeFilterInputStorageKey = 'advanced-recipe-tree:muzumi-setting';
elements.recipeFilterInput.addEventListener('input', () => {
    localStorage.setItem(recipeFilterInputStorageKey, elements.recipeFilterInput.value);
});
function parseRecipeFilterSetting() {
    const raw = elements.recipeFilterInput.value;
    const startIndex = raw.indexOf('这个，');
    const endIndex = raw.indexOf('不需要了');
    const rawRecipeNames = raw.substring(startIndex + 3, endIndex).split('，');
    const recipeNames = rawRecipeNames.filter(x => x).map(x => x.trim()).filter(x => pagedata.recipes.some(r => r.name == x));
    return recipeNames;
}
function setupNavigationBar2() {
    const checkboxValue = localStorage.getItem(limitedTimeCheckboxStorageKey);
    if (checkboxValue) {
        elements.limitedTimeCheckbox.checked = checkboxValue == '1';
    }
    const textareaValue = localStorage.getItem(recipeFilterInputStorageKey);
    if (textareaValue) {
        elements.recipeFilterInput.value = textareaValue;
    }
    updateItemListDisplay();
}
function updateItemListDisplay() {

    // search condition say this element can display
    const passSearch = (element: HTMLElement) => {
        if (!elements.searchInput.value) { return true; }
        const item = pagedata.items.find(i => i.name == element.dataset['id']);
        return item.name.includes(elements.searchInput.value) || item.pinyin.includes(elements.searchInput.value.toLocaleLowerCase());
    };
    // limited time checkbox say this element can display
    const passLimitedTime = (element: HTMLElement) => {
        if (elements.limitedTimeCheckbox.checked) { return true; }
        const item = pagedata.items.find(i => i.name == element.dataset['id']);
        const recipes = pagedata.recipes.filter(r => r.outputs.some(o => o.name == item.name));
        const limitedTimeRecipeCount = recipes.filter(r => r.event).length;
        // no recipe (like mineral item) or has recipe that is not limited time
        return recipes.length == 0 || recipes.length != limitedTimeRecipeCount;
    };

    for (const itemElement of Array.from<HTMLLIElement>(elements.itemList.children as any)) {
        // only if both condition pass can an item display
        // if it can display set style to empty string to remove the css property at element level to use that property from css file
        itemElement.style.display = passSearch(itemElement) && passLimitedTime(itemElement) ? '' : 'none';
    }
}
setupNavigationBar2();

function handleFocusPanel(itemId: string) {
    const panels: HTMLDivElement[] = Array.from(elements.main.querySelectorAll('div.panel'));
    const getZIndex = (e: HTMLDivElement) => e.dataset['id'] == itemId ? 1000 : +(e.style.zIndex ?? '0');
    panels.sort((e1, e2) => getZIndex(e1) - getZIndex(e2));
    for (const [panel, panelIndex] of panels.map((p, i) => [p, i] as const)) {
        panel.classList.remove('focus');
        panel.style.zIndex = (panelIndex + 1).toString();
    }
    panels[panels.length - 1].classList.add('focus');
}

function handleOpenPanel(item: ItemData) {
    // TODO consider make <main> scroll zoom, make main look like drag move that actually moves all panels
    const panels: HTMLDivElement[] = Array.from(elements.main.querySelectorAll('div.panel'));
    const existPanel = panels.find(p => p.dataset['id'] == item.name);
    if (existPanel) {
        handleFocusPanel(item.name);
    } else {
        const tree = collectRecipeTree(item, [], elements.limitedTimeCheckbox.checked);
        layoutRecipeTree(tree);
        drawRecipeTree(tree);
        handleFocusPanel(tree.data.name);
        updateItemList();
    }
}
function handleClosePanel(itemId: string) {
    const panels: HTMLDivElement[] = Array.from(elements.main.querySelectorAll('div.panel'));
    const panel = panels.find(p => p.dataset['id'] == itemId);
    if (panel) {
        // allCleanupHandlers[itemId].forEach(f => f());
        // delete allCleanupHandlers[itemId];
        panel.remove();
        updateItemList();
    } else {
        console.log(`what are you sending to handleClosePanel? ${itemId}`);
    }
}
function handleToggleOpen(item: ItemData) {
    const panels: HTMLDivElement[] = Array.from(elements.main.querySelectorAll('div.panel'));
    const maxZIndex = panels.reduce((a, p) => Math.max(a, +(p.style.zIndex ?? '0')), 0);
    const panel = panels.find(p => p.dataset['id'] == item.name);
    if (panel && panel.style.zIndex == maxZIndex.toString()) {
        // if have z-index and is max z-index, close
        handleClosePanel(item.name);
    } else if (panel) {
        // if not topmost panel, bring topmost
        handleFocusPanel(item.name);
    } else {
        // if not open, open panel
        handleOpenPanel(item);
    }
}
