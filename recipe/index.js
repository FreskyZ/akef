import pagedata from './recipe.json' with { type: 'json' };
const elements = {
    itemList: document.querySelector('nav ul'),
    searchInput: document.querySelector('div#nav-header>input'),
    main: document.querySelector('main'),
    sortButton: document.querySelector('button#sort'),
    clearButton: document.querySelector('button#clear'),
};
for (const item of pagedata.items) {
    item.id = item.name;
}
for (const machine of pagedata.machines) {
    machine.id = machine.name;
    machine.desc = '';
}
for (const recipe of pagedata.recipes) {
    recipe.id = recipe.name;
    recipe.machineId = recipe['machine'];
    recipe.ingredients = recipe['input'].map((i) => ({ id: i.name, count: i.count }));
    recipe.products = recipe['output'].map((i) => ({ id: i.name, count: i.count }));
}
pagedata.icons = Object.fromEntries(pagedata.items.map(i => [i.name, i['icon']]));
function setupNavigationBar() {
    for (const item of pagedata.items) {
        const itemElement = document.createElement('li');
        itemElement.dataset['id'] = item.id;
        const imageElement = document.createElement('img');
        imageElement.alt = item.name;
        imageElement.title = item.name;
        imageElement.src = pagedata.icons[item.id];
        imageElement.width = 48;
        imageElement.height = 48;
        itemElement.appendChild(imageElement);
        const nameElement = document.createElement('div');
        nameElement.className = 'name';
        nameElement.innerText = item.name;
        itemElement.appendChild(nameElement);
        const descriptionElement = document.createElement('div');
        descriptionElement.className = 'description';
        descriptionElement.innerText = item.desc[0].replace('\n', '');
        descriptionElement.title = item.desc[0] + item.desc[1];
        itemElement.appendChild(descriptionElement);
        elements.itemList.appendChild(itemElement);
        itemElement.addEventListener('click', () => handleToggleOpen(item));
    }
    elements.searchInput.addEventListener('change', () => {
        for (const itemElement of Array.from(elements.itemList.children)) {
            if (!elements.searchInput.value) {
                itemElement.style.display = 'grid';
            }
            else {
                const item = pagedata.items.find(i => i.id == itemElement.dataset['id']);
                const found = item.name.includes(elements.searchInput.value) || item.pinyin.includes(elements.searchInput.value.toLocaleLowerCase());
                itemElement.style.display = found ? 'grid' : 'none';
            }
        }
    });
}
setupNavigationBar();
function collectRecipeTree(item, path) {
    const itemNode = { data: item, depth: path.length, duplicate: false, children: [], possibleProducts: [] };
    if (path.includes(item.id)) {
        itemNode.duplicate = true;
        return itemNode;
    }
    if (!path.length) {
        const possibleProductIds = pagedata.recipes.filter(r => r.ingredients.some(r => r.id == item.id)).flatMap(r => r.products.map(r => r.id));
        itemNode.possibleProducts = Array.from(new Set(possibleProductIds)).map(id => pagedata.items.find(i => i.id == id));
    }
    if (path.length > 10) {
        throw new Error('unexpected too deep');
    }
    if (item.kind != 'seed' || path.length == 0) {
        for (const recipe of pagedata.recipes.filter(r => r.kind != 'pour' && r.products.some(r => r.id == item.id))) {
            itemNode.children.push({
                data: recipe,
                depth: path.length,
                children: recipe.ingredients.map(ingredient => collectRecipeTree(pagedata.items.find(i => i.id == ingredient.id), [...path, item.id])),
            });
        }
    }
    return itemNode;
}
function layoutRecipeTree(tree) {
    const MinDistance = 1;
    function setup(thisnode) {
        for (const child of thisnode.children.filter(c => c.children.length)) {
            setup(child);
        }
        if (thisnode.children.length == 1) {
            thisnode.children[0].position = 0;
            return;
        }
        const childCount = thisnode.children.length;
        const childIndexSequence = new Array(childCount).fill(0).map((_, i) => i);
        childIndexSequence.forEach(childIndex => thisnode.children[childIndex].position = childIndex == 0 ? 0 : MinDistance);
        let activeIndexes = childIndexSequence.map(i => i);
        const leftCursors = thisnode.children.map(n => n);
        const leftCursorOffsets = thisnode.children.map(() => 0);
        const rightCursors = thisnode.children.map(n => n);
        const rightCursorOffsets = thisnode.children.map(() => 0);
        let leftmostDescendantPosition = 0;
        let rightmostNodes = childIndexSequence.map(childIndex => childIndex == childCount - 1 ? { node: thisnode.children[childIndex], offset: 0 } : { node: null, offset: undefined });
        while (activeIndexes.length) {
            for (const childIndex of activeIndexes) {
                if (leftCursors[childIndex].thread) {
                    leftCursorOffsets[childIndex] += leftCursors[childIndex].threadOffset;
                    leftCursors[childIndex] = leftCursors[childIndex].thread;
                }
                else if (leftCursors[childIndex].children.length) {
                    leftCursors[childIndex] = leftCursors[childIndex].children[0];
                    leftCursorOffsets[childIndex] += leftCursors[childIndex].position;
                }
                else if (childIndex != activeIndexes[0] || activeIndexes.length == 1) {
                    leftCursors[childIndex] = null;
                }
                if (rightCursors[childIndex].thread) {
                    rightCursorOffsets[childIndex] += rightCursors[childIndex].threadOffset;
                    rightCursors[childIndex] = rightCursors[childIndex].thread;
                }
                else if (rightCursors[childIndex].children.length) {
                    rightCursors[childIndex] = rightCursors[childIndex].children[rightCursors[childIndex].children.length - 1];
                    rightCursorOffsets[childIndex] += rightCursors[childIndex].position;
                }
                else if (childIndex != activeIndexes[activeIndexes.length - 1] || activeIndexes.length == 1) {
                    rightCursors[childIndex] = null;
                }
            }
            const newActiveIndexes = activeIndexes.filter((childIndex, i) => i == 0 ? rightCursors[childIndex] : leftCursors[childIndex]);
            if (newActiveIndexes.length > 1) {
                for (const [leftIndex, rightIndex] of new Array(newActiveIndexes.length - 1)
                    .fill(0).map((_, i) => [newActiveIndexes[i], newActiveIndexes[i + 1]])) {
                    let subtreeDistance = 0;
                    for (let childIndex = leftIndex + 1; childIndex <= rightIndex; childIndex++) {
                        subtreeDistance += thisnode.children[childIndex].position;
                    }
                    if (subtreeDistance + leftCursorOffsets[rightIndex] - rightCursorOffsets[leftIndex] < MinDistance) {
                        const increaseDistance = MinDistance - leftCursorOffsets[rightIndex] + rightCursorOffsets[leftIndex] - subtreeDistance;
                        if (leftIndex + 1 == rightIndex) {
                            thisnode.children[rightIndex].position += increaseDistance;
                        }
                        else {
                            for (let childIndex = leftIndex + 1; childIndex <= rightIndex; childIndex++) {
                                thisnode.children[childIndex].position += increaseDistance / (rightIndex - leftIndex);
                            }
                        }
                    }
                }
            }
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
                leftmostDescendantPosition = Math.min(leftmostDescendantPosition, leftCursorOffsets[leftmostChildIndex]);
                if (!rightmostNodes[rightmostChildIndex].node || rightmostNodes[rightmostChildIndex].offset < rightCursorOffsets[rightmostChildIndex]) {
                    rightmostNodes[rightmostChildIndex].node = rightCursors[rightmostChildIndex];
                    rightmostNodes[rightmostChildIndex].offset = rightCursorOffsets[rightmostChildIndex];
                }
            }
        }
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
        }
        else if (cursor.children.length) {
            cursor = cursor.children[0];
            cursorPosition += cursor.position;
            minCursorPosition = Math.min(minCursorPosition, cursorPosition);
        }
        else {
            break;
        }
    }
    function setPosition(node, position) {
        node.position = position;
        node.thread = null;
        node.threadOffset = undefined;
        for (const child of node.children) {
            setPosition(child, position + child.position);
        }
    }
    setPosition(tree, -minCursorPosition);
}
function j(parent, tag, props, additionalOperations) {
    const element = document.createElement(tag);
    if (props?.className) {
        element.className = props.className;
    }
    if (props?.dataset) {
        Object.assign(element.dataset, props.dataset);
    }
    if (props?.style) {
        Object.assign(element.style, props.style);
    }
    if (props?.left) {
        element.style.left = `${props.left}px`;
    }
    if (props?.top) {
        element.style.top = `${props.top}px`;
    }
    if (props?.width) {
        element.style.width = `${props.width}px`;
    }
    if (props?.height) {
        element.style.height = `${props.height}px`;
    }
    if (props?.innerText) {
        element.innerText = props.innerText;
    }
    if (additionalOperations) {
        additionalOperations(element);
    }
    parent.appendChild(element);
    return element;
}
const ClockIcon = [
    "M512 64C264.6 64 64 264.6 64 512s200.6 448 448 448 448-200.6 448-448S759.4 64 512 64zm0 820c-205.4 0-372-166.6-372-372s166.6-372 372-372 372 166.6 372 372-166.6 372-372 372z",
    "M686.7 638.6L544.1 535.5V288c0-4.4-3.6-8-8-8H488c-4.4 0-8 3.6-8 8v275.4c0 2.6 1.2 5 3.3 6.5l165.4 120.6c3.6 2.6 8.6 1.8 11.2-1.7l28.6-39c2.6-3.7 1.8-8.7-1.8-11.2z",
];
const ThunderboltIcon = [
    "M848 359.3H627.7L825.8 109c4.1-5.3.4-13-6.3-13H436c-2.8 0-5.5 1.5-6.9 4L170 547.5c-3.1 5.3.7 12 6.9 12h174.4l-89.4 " +
        "357.6c-1.9 7.8 7.5 13.3 13.3 7.7L853.5 373c5.2-4.9 1.7-13.7-5.5-13.7zM378.2 732.5l60.3-241H281.1l189.6-327.4h224.6L487 427.4h211L378.2 732.5z",
];
const ReloadIcon = [
    "M909.1 209.3l-56.4 44.1C775.8 155.1 656.2 92 521.9 92 290 92 102.3 279.5 102 511.5 101.7 743.7 289.8 932 521.9 932c181.3 0 335.8-115 394.6-276.1 1.5-4.2-.7-8.9-4.9-10.3l-56.7-19.5a8 " +
        "8 0 00-10.1 4.8c-1.8 5-3.8 10-5.9 14.9-17.3 41-42.1 77.8-73.7 109.4A344.77 344.77 0 01655.9 829c-42.3 17.9-87.4 27-133.8 27-46.5 0-91.5-9.1-133.8-27A341.5 341.5 0 01279 755.2a342.16 " +
        "342.16 0 01-73.7-109.4c-17.9-42.4-27-87.4-27-133.9s9.1-91.5 27-133.9c17.3-41 42.1-77.8 73.7-109.4 31.6-31.6 68.4-56.4 109.3-73.8 42.3-17.9 87.4-27 133.8-27 46.5 0 91.5 9.1 133.8 27a341.5 " +
        "341.5 0 01109.3 73.8c9.9 9.9 19.2 20.4 27.8 31.4l-60.2 47a8 8 0 003 14.1l175.6 43c5 1.2 9.9-2.6 9.9-7.7l.8-180.9c-.1-6.6-7.8-10.3-13-6.2z",
];
const SharpIcon = [
    "M872 394c4.4 0 8-3.6 8-8v-60c0-4.4-3.6-8-8-8H708V152c0-4.4-3.6-8-8-8h-64c-4.4 0-8 3.6-8 8v166H400V152c0-4.4-3.6-8-8-8h-64c-4.4 0-8 3.6-8 8v166H152c-4.4 0-8 3.6-8 8v60c0 4.4 3.6 8 8 " +
        "8h168v236H152c-4.4 0-8 3.6-8 8v60c0 4.4 3.6 8 8 8h168v166c0 4.4 3.6 8 8 8h64c4.4 0 8-3.6 8-8V706h228v166c0 4.4 3.6 8 8 8h64c4.4 0 8-3.6 8-8V706h164c4.4 0 8-3.6 " +
        "8-8v-60c0-4.4-3.6-8-8-8H708V394h164zM628 630H400V394h228v236z",
];
const ProductIcon = [
    "M464 144a16 16 0 0116 16v304a16 16 0 01-16 16H160a16 16 0 01-16-16V160a16 16 0 0116-16zm-52 68H212v200h200zm493.33 87.69a16 16 0 010 22.62L724.31 503.33a16 16 0 01-22.62 0L520.67 322.31a16 " +
        "16 0 010-22.62l181.02-181.02a16 16 0 0122.62 0zm-84.85 11.3L713 203.53 605.52 311 713 418.48zM464 544a16 16 0 0116 16v304a16 16 0 01-16 16H160a16 16 0 01-16-16V560a16 16 0 0116-16zm-52 " +
        "68H212v200h200zm452-68a16 16 0 0116 16v304a16 16 0 01-16 16H560a16 16 0 01-16-16V560a16 16 0 0116-16zm-52 68H612v200h200z",
];
const LinkIcon = [
    "M574 665.4a8.03 8.03 0 00-11.3 0L446.5 781.6c-53.8 53.8-144.6 59.5-204 0-59.5-59.5-53.8-150.2 0-204l116.2-116.2c3.1-3.1 3.1-8.2 0-11.3l-39.8-39.8a8.03 8.03 0 00-11.3 0L191.4 526.5c-84.6 " +
        "84.6-84.6 221.5 0 306s221.5 84.6 306 0l116.2-116.2c3.1-3.1 3.1-8.2 0-11.3L574 665.4zm258.6-474c-84.6-84.6-221.5-84.6-306 0L410.3 307.6a8.03 8.03 0 000 11.3l39.7 39.7c3.1 3.1 8.2 3.1 11.3 " +
        "0l116.2-116.2c53.8-53.8 144.6-59.5 204 0 59.5 59.5 53.8 150.2 0 204L665.3 562.6a8.03 8.03 0 000 11.3l39.8 39.8c3.1 3.1 8.2 3.1 11.3 0l116.2-116.2c84.5-84.6 84.5-221.5 0-306.1zM610.1 372.3a8.03 " +
        "8.03 0 00-11.3 0L372.3 598.7a8.03 8.03 0 000 11.3l39.6 39.6c3.1 3.1 8.2 3.1 11.3 0l226.4-226.4c3.1-3.1 3.1-8.2 0-11.3l-39.5-39.6z",
];
function createSVGElement(parent, pathdata, className) {
    const svgns = 'http://www.w3.org/2000/svg';
    const svgElement = document.createElementNS(svgns, 'svg');
    svgElement.setAttribute('viewBox', '64 64 896 896');
    svgElement.setAttribute('fill', 'currentColor');
    if (className) {
        svgElement.setAttribute('class', className);
    }
    for (const data of pathdata) {
        const pathElement = document.createElementNS(svgns, 'path');
        pathElement.setAttribute('d', data);
        svgElement.appendChild(pathElement);
    }
    parent.appendChild(svgElement);
    return svgElement;
}
function setupImageElement(element, item, size = 40) {
    element.src = pagedata.icons[item.id];
    element.alt = item.name;
    element.width = element.height = size;
}
function setupDragMove(element) {
    let beginX = 0;
    let beginY = 0;
    element.addEventListener('mousedown', e => {
        if (e.target.matches('input')) {
            return;
        }
        e.preventDefault();
        beginX = e.clientX;
        beginY = e.clientY;
        element.style.cursor = 'grabbing';
        element.addEventListener('mouseup', handleMouseUp);
        element.addEventListener('mousemove', handleMouseMove);
        function handleMouseMove(e) {
            e.preventDefault();
            element.style.left = (element.offsetLeft - beginX + e.clientX) + 'px';
            element.style.top = (element.offsetTop - beginY + e.clientY) + 'px';
            beginX = e.clientX;
            beginY = e.clientY;
        }
        function handleMouseUp(_) {
            element.style.cursor = 'grab';
            element.removeEventListener('mouseup', handleMouseUp);
            element.removeEventListener('mousemove', handleMouseMove);
        }
    });
}
function round2(value) {
    return Math.round(value * 100) / 100;
}
class EventEmitter {
    handlers;
    constructor() {
        this.handlers = [];
    }
    addEventListener(f) {
        this.handlers.push(f);
        return () => {
            const index = this.handlers.indexOf(f);
            if (index >= 0) {
                this.handlers.splice(index, 1);
            }
        };
    }
    send(data) {
        this.handlers.forEach(h => h(data));
    }
}
const activeRecipeStorage = [];
const activeRecipeChangeEvent = new EventEmitter();
const speedRequirementStorage = {};
const allCleanupHandlers = {};
function drawRecipeTree(root) {
    const cleanupHandlers = allCleanupHandlers[root.data.id] ??= [];
    let maxDepth = 0;
    let maxPosition = -100;
    function collectCoordinates(node) {
        maxDepth = Math.max(maxDepth, node.depth);
        maxPosition = Math.max(maxPosition, node.position);
        for (const child of node.children) {
            collectCoordinates(child);
        }
    }
    collectCoordinates(root);
    const CellWidth = 184;
    const CellHeight = 72;
    const panelElement = j(elements.main, 'div', {
        className: 'panel',
        dataset: { 'id': root.data.id },
        left: 100,
        top: 100,
        width: CellWidth * maxDepth + 112 + (root.possibleProducts.length ? 80 : 0),
        height: CellHeight * (Math.max(maxPosition + 1, root.possibleProducts.length)) + 60,
    }, element => {
        setupDragMove(element);
        element.addEventListener('mousedown', e => {
            handleFocusPanel(root.data.id);
        });
    });
    j(panelElement, 'button', { className: 'close', innerText: 'X' }, e => e.addEventListener('click', () => handleClosePanel(root.data.id)));
    j(panelElement, 'span', { className: 'title', innerText: root.data.name });
    let remainingItems = [[root, []]];
    while (remainingItems.length > 0) {
        const newRemainingItems = [];
        for (const [item, path] of remainingItems) {
            createNode(item, path);
            for (const recipe of item.children) {
                for (const childItem of recipe.children) {
                    newRemainingItems.push([childItem, [...path, item.data.id, recipe.data.id]]);
                }
            }
        }
        remainingItems = newRemainingItems;
    }
    function createNode(item, path) {
        const parentRecipe = path.length == 0 ? null : pagedata.recipes.find(r => r.id == path.at(-1));
        const itemElement = j(panelElement, 'div', {
            className: 'item-node' + (item.data.id == root.data.id ? ' main-item-node' : ''),
            dataset: { 'id': item.data.id, 'parentrecipe': parentRecipe?.id },
            left: CellWidth * (maxDepth - item.depth) + 20,
            top: CellHeight * item.position + 40,
        });
        j(itemElement, 'img', {}, e => {
            setupImageElement(e, item.data);
            if (item.data.id != root.data.id) {
                e.addEventListener('click', () => handleOpenPanel(item.data));
            }
            e.addEventListener('mouseenter', () => Array.from(panelElement.querySelectorAll(`div.item-node[data-id="${item.data.id}"]>img`)).forEach(e => e.classList.add('highlight')));
            e.addEventListener('mouseleave', () => Array.from(panelElement.querySelectorAll(`div.item-node[data-id="${item.data.id}"]>img`)).forEach(e => e.classList.remove('highlight')));
        });
        j(itemElement, 'div', { className: 'name' }, nameContainer => {
            j(nameContainer, 'span', { innerText: item.data.name }, e => e.title = item.data.desc[0]);
        });
        if (item.children.length) {
            j(itemElement, 'div', { className: 'connect-line connect-line1' });
        }
        else if (item.duplicate) {
            j(itemElement, 'div', { className: 'connect-line connect-line1 connect-line-virtual' }, e => e.title = '之前在链路上出现过了');
        }
        if (parentRecipe) {
            const amount = parentRecipe.ingredients.find(i => i.id == item.data.id).count;
            j(itemElement, 'span', { className: 'amount', innerText: `×${amount}` });
            j(itemElement, 'div', { className: 'connect-line connect-line2', dataset: { 'recipe': parentRecipe.id } });
        }
        for (const recipe of item.children) {
            const direction = item.position > recipe.position ? 'down' : item.position == recipe.position ? 'level' : 'up';
            j(panelElement, 'div', {
                className: `collect-line collect-line-${direction}`,
                dataset: { 'item': item.data.id, 'recipe': recipe.data.id },
                left: CellWidth * (maxDepth - item.depth) + 12,
                top: CellHeight * (direction == 'up' ? item.position : recipe.position) + 64,
                height: CellHeight * Math.abs(recipe.position - item.position),
            });
        }
        if (item.possibleProducts.length) {
            j(itemElement, 'div', { className: 'connect-line connect-line2 connect-line-virtual' });
            const basePosition = item.possibleProducts.length < maxPosition + 1 ? root.position - (item.possibleProducts.length - 1) / 2 : 0;
            for (const [product, productIndex] of item.possibleProducts.map((p, i) => [p, i])) {
                const productPosition = basePosition + productIndex;
                const productElement = j(panelElement, 'div', {
                    className: 'product-node',
                    dataset: { 'id': product.id },
                    left: CellWidth * maxDepth + 100,
                    top: CellHeight * productPosition + 40,
                }, e => e.addEventListener('click', () => handleOpenPanel(product)));
                j(productElement, 'img', {}, e => setupImageElement(e, product));
                j(productElement, 'div', { className: 'name' }, nameContainer => {
                    j(nameContainer, 'span', { innerText: product.name }, e => e.title = product.desc[0]);
                });
                j(productElement, 'div', { className: 'connect-line' });
                const direction = item.position > productPosition ? 'up' : item.position == productPosition ? 'level' : 'down';
                j(panelElement, 'div', {
                    className: `spread-line spread-line-${direction}`,
                    dataset: { 'id': product.id },
                    left: CellWidth * maxDepth + 92,
                    top: CellHeight * (direction == 'up' ? productPosition : item.position) + 64,
                    height: CellHeight * Math.abs(productPosition - item.position),
                });
            }
        }
        let activeRecipeEntry = activeRecipeStorage.find(s => s.length == path.length + 2
            && !new Array(path.length).fill(0).some((_, i) => s[i] != path[i]) && s.at(-2) == item.data.id);
        if (!activeRecipeEntry && item.children.length) {
            activeRecipeEntry = [...path, item.data.id, item.children[0].data.id];
            activeRecipeStorage.push(activeRecipeEntry);
        }
        for (const recipe of item.children) {
            const recipeElement = j(panelElement, 'div', {
                className: 'recipe-node' + (recipe.data.id == activeRecipeEntry?.at(-1) ? ' active' : ''),
                dataset: { 'id': recipe.data.id },
                left: CellWidth * (maxDepth - recipe.depth - 1) + 100,
                top: CellHeight * recipe.position + 40,
            }, e => {
                e.addEventListener('click', () => {
                    activeRecipeEntry[activeRecipeEntry.length - 1] = activeRecipeEntry.at(-1) == recipe.data.id ? null : recipe.data.id;
                    activeRecipeChangeEvent.send(activeRecipeEntry);
                });
            });
            cleanupHandlers.push(activeRecipeChangeEvent.addEventListener((entry) => {
                if (entry === activeRecipeEntry) {
                    entry.at(-1) == recipe.data.id ? recipeElement.classList.add('active') : recipeElement.classList.remove('active');
                }
            }));
            const amount = recipe.data.products.find(p => p.id == item.data.id).count;
            const infoElement1 = j(recipeElement, 'div', { className: 'info-container info-container1' });
            createSVGElement(infoElement1, ClockIcon, 'time-icon');
            j(infoElement1, 'span', { className: 'time', innerText: `${recipe.data.time}s` });
            createSVGElement(infoElement1, ProductIcon, 'amount-icon');
            j(infoElement1, 'span', { className: 'amount' +
                    (amount != 1 ? ` amount-not-1` : ''), innerText: `×${amount}` }, e => e.title = '产物数量' + (amount != 1 ? '大于1！' : ''));
            if (recipe.data.products.length > 1) {
                const sideProducts = recipe.data.products.filter(p => p.id != item.data.id)
                    .map(p => `${pagedata.items.find(i => i.id == p.id).name}×${p.count}`).join('，');
                const sideProductIconContainer = j(infoElement1, 'span', { className: 'side-product-icon-container' }, e => e.title = `副产物：${sideProducts}`);
                createSVGElement(sideProductIconContainer, LinkIcon, 'side-product-icon');
            }
            const machine = pagedata.machines.find(m => m.id == recipe.data.machineId);
            j(recipeElement, 'div', { className: 'machine-name', innerText: machine.name }, e => {
                e.title = "点击选择配方，点击选择了的配方可以关掉所有配方（把当前物品作为外部输入）";
                e.addEventListener('mouseenter', () => {
                    Array.from(panelElement.querySelectorAll(`div.item-line[data-recipe=${recipe.data.id}]`)).forEach(e => e.classList.add('highlight'));
                });
                e.addEventListener('mouseleave', () => {
                    Array.from(panelElement.querySelectorAll(`div.item-line[data-recipe=${recipe.data.id}]`)).forEach(e => e.classList.remove('highlight'));
                });
            });
            const infoElement2 = j(recipeElement, 'div', { className: 'info-container info-container2' });
            createSVGElement(infoElement2, ThunderboltIcon, 'power-icon');
            j(infoElement2, 'span', { className: 'power', innerText: `${machine.power}W` }, e => {
                e.style.fontWeight = machine.power == 50 ? 'bold' : '';
                e.title = machine.name == '研磨机'
                    ? `额定功率50W，我的天哪砂叶大人又用了50W的电`
                    : `额定功率${machine.power}W，注意啦注意啦机器摸鱼和卡住的时候也要用这么多电`;
            });
            createSVGElement(infoElement2, SharpIcon, 'size-icon');
            j(infoElement2, 'span', { className: 'size', innerText: `${machine.size[0]}×${machine.size[1]}` }, e => e.title = `占地面积`);
            j(recipeElement, 'div', { className: 'connect-line connect-line1' });
            j(recipeElement, 'div', { className: 'connect-line connect-line2' });
            for (const item of recipe.children) {
                const direction = recipe.position > item.position ? 'down' : recipe.position == item.position ? 'level' : 'up';
                j(panelElement, 'div', {
                    className: `collect-line collect-line-${direction}`,
                    dataset: { 'item': item.data.id, 'recipe': recipe.data.id },
                    left: CellWidth * (maxDepth - recipe.depth - 1) + 92,
                    top: CellHeight * (direction == 'up' ? recipe.position : item.position) + 64,
                    height: CellHeight * Math.abs(item.position - recipe.position),
                });
            }
        }
    }
    const calculationContainerElement = j(panelElement, 'div', {
        className: 'calc-container',
        left: CellWidth * maxDepth + 112 + (root.possibleProducts.length ? 80 : 0),
        top: 40,
        width: 600,
    });
    const initialSpeed = speedRequirementStorage[root.data.id] ?? (root.children.length != 1 ? 0.5
        : root.children[0].data.products.find(p => p.id == root.data.id).count / root.children[0].data.time);
    let currentRootSpeed = initialSpeed;
    const speedHandlers = [];
    speedHandlers.push(newSpeed => speedRequirementStorage[root.data.id] = newSpeed);
    const speedContainer = j(calculationContainerElement, 'span', { className: 'speed-container' });
    if (root.children.length) {
        j(speedContainer, 'input', {}, e => {
            e.type = 'number';
            e.name = 'item-count-requirement';
            e.value = round2(initialSpeed * 60).toString();
            e.addEventListener('change', () => {
                const newPerMinute = +e.value;
                if (newPerMinute) {
                    currentRootSpeed = newPerMinute / 60;
                    speedHandlers.forEach(h => h(newPerMinute / 60));
                }
            });
            speedHandlers.push(newSpeed => e.value = round2(newSpeed * 60).toString());
        });
        j(speedContainer, 'label', { innerText: '个每分钟' }, e => e.htmlFor = 'item-count-requirement');
        j(speedContainer, 'button', { className: 'reset' }, button => {
            createSVGElement(button, ReloadIcon);
            button.addEventListener('click', () => speedHandlers.forEach(h => h(initialSpeed)));
        });
    }
    const remainingItems2 = [[root, [], 1]];
    while (remainingItems2.length) {
        const [item, path, speed] = remainingItems2.shift();
        createLine(item, path, speed);
        for (const recipe of item.children) {
            const productAmount = recipe.data.products.find(p => p.id == item.data.id).count;
            for (const child of recipe.children) {
                const ingredientAmount = recipe.data.ingredients.find(i => i.id == child.data.id).count;
                remainingItems2.unshift([child, [...path, item.data.id, recipe.data.id], speed * ingredientAmount / productAmount]);
            }
        }
    }
    function createLine(item, path, relativeSpeed) {
        const getActive = () => {
            for (const length of new Array(path.length / 2).fill(0).map((_, i) => i + 1)) {
                if (!activeRecipeStorage.some(s => s.length == length * 2 && !new Array(length * 2).fill(0).some((_, i) => s[i] != path[i]))) {
                    return false;
                }
            }
            return true;
        };
        let activeRecipeEntry = activeRecipeStorage.find(s => s.length == path.length + 2
            && !new Array(path.length).fill(0).some((_, i) => s[i] != path[i]) && s.at(-2) == item.data.id);
        if (!activeRecipeEntry && item.children.length) {
            activeRecipeEntry = [...path, item.data.id, item.children[0].data.id];
            activeRecipeStorage.push(activeRecipeEntry);
        }
        const getElementsForHightlightRecipe = (recipeId) => {
            const recipe = pagedata.recipes.find(r => r.id == activeRecipeEntry.at(-1));
            const recipeNodeElements = Array.from(panelElement.querySelectorAll(`div.recipe-node[data-id=${recipeId}]`));
            const collectLineElements = Array.from(panelElement.querySelectorAll(`div.collect-line[data-recipe=${recipeId}]`));
            const itemNodeElements1 = recipe.ingredients.flatMap(item => Array.from(panelElement.querySelectorAll(`div.item-node[data-id=${item.id}][data-parentrecipe=${recipeId}]>img`)));
            const itemNodeElements2 = recipe.products.length != 1 ? []
                : Array.from(panelElement.querySelectorAll(`div.item-node[data-id=${recipe.products[0].id}]>img`));
            const connectLine2Elements = recipe.ingredients.flatMap(item => Array.from(panelElement.querySelectorAll(`div.item-node[data-id=${item.id}]>div.connect-line2[data-recipe=${recipeId}]`)));
            const connectLine1Elements = recipe.products.length != 1 ? []
                : Array.from(panelElement.querySelectorAll(`div.item-node[data-id=${recipe.products[0].id}]>div.connect-line1`));
            return [recipeNodeElements, collectLineElements, itemNodeElements1, itemNodeElements2, connectLine1Elements, connectLine2Elements].flat();
        };
        const lineElement = j(calculationContainerElement, 'div', { className: 'item-line', dataset: { 'id': item.data.id } }, e => {
            e.style.marginLeft = `${24 * item.depth}px`;
            e.style.height = getActive() ? '32px' : '0px';
            e.addEventListener('mouseenter', () => {
                if (!activeRecipeEntry.at(-1)) {
                    return;
                }
                getElementsForHightlightRecipe(activeRecipeEntry.at(-1)).forEach(e => e.classList.add('highlight'));
            });
            e.addEventListener('mouseleave', () => {
                if (!activeRecipeEntry.at(-1)) {
                    return;
                }
                getElementsForHightlightRecipe(activeRecipeEntry.at(-1)).forEach(e => e.classList.remove('highlight'));
            });
        });
        lineElement.dataset['recipe'] = activeRecipeEntry?.at(-1);
        cleanupHandlers.push(activeRecipeChangeEvent.addEventListener(() => {
            lineElement.style.height = getActive() ? '32px' : '0px';
            lineElement.dataset['recipe'] = activeRecipeEntry?.at(-1);
        }));
        j(lineElement, 'img', {}, e => setupImageElement(e, item.data, 32));
        j(lineElement, 'span', { className: 'name', innerText: item.data.name });
        const recipeLineElement = j(lineElement, 'span', { className: 'recipe-line' });
        const fillRecipeLine = (recipeId) => {
            recipeLineElement.innerHTML = '';
            delete recipeLineElement.dataset['id'];
            if (!recipeId) {
                return null;
            }
            const recipe = pagedata.recipes.find(r => r.id == recipeId);
            recipeLineElement.dataset['id'] = recipe.id;
            j(recipeLineElement, 'span', { className: 'arrow', innerText: `⇐` });
            for (const [{ id: itemId, count }, index] of recipe.ingredients.map((i, index) => [i, index])) {
                const item = pagedata.items.find(i => i.id == itemId);
                j(recipeLineElement, 'img', {}, e => setupImageElement(e, item, 32));
                j(recipeLineElement, 'span', { className: 'item-name', innerText: pagedata.items.find(i => i.id == itemId).name });
                j(recipeLineElement, 'span', { className: 'amount', innerText: `×${count}` });
                if (index != recipe.ingredients.length - 1) {
                    j(recipeLineElement, 'span', { className: 'plus', innerText: '+' });
                }
            }
            return recipeLineElement;
        };
        const activeRecipeId = activeRecipeEntry?.at(-1);
        if (item.children.length && activeRecipeId) {
            fillRecipeLine(activeRecipeId);
        }
        cleanupHandlers.push(activeRecipeChangeEvent.addEventListener(entry => {
            if (activeRecipeEntry === entry && recipeLineElement?.dataset['id'] != entry.at(-1)) {
                fillRecipeLine(entry.at(-1));
            }
        }));
        const getGetCountElementText = (recipeId) => {
            if (recipeId) {
                const recipe = pagedata.recipes.find(r => r.id == recipeId);
                const machineName = pagedata.machines.find(m => m.id == recipe.machineId).name;
                const productivity = recipe.products.find(p => p.id == item.data.id).count / recipe.time;
                return (rootSpeed) => `${machineName}×${round2(relativeSpeed * rootSpeed / productivity)}`;
            }
            else if (item.data.id != root.data.id) {
                if (item.data.kind == 'liquid') {
                    return (rootSpeed) => `${round2(relativeSpeed * rootSpeed / 1)}水泵，${round2(relativeSpeed * rootSpeed / 2)}管道`;
                }
                else {
                    return (rootSpeed) => `${round2(relativeSpeed * rootSpeed / 0.5)}带`;
                }
            }
            else {
                return (_) => '';
            }
        };
        let getCountElementText = getGetCountElementText(activeRecipeId);
        let countElement = j(lineElement, 'span', { className: 'count', innerText: getCountElementText(initialSpeed) });
        speedHandlers.push(newSpeed => countElement.innerText = getCountElementText(newSpeed));
        cleanupHandlers.push(activeRecipeChangeEvent.addEventListener(entry => {
            if (activeRecipeEntry === entry && recipeLineElement?.dataset['id'] != entry.at(-1)) {
                getCountElementText = getGetCountElementText(entry.at(-1));
                countElement.innerText = getCountElementText(currentRootSpeed);
            }
        }));
    }
    j(calculationContainerElement, 'div', { innerText: '总计...' });
}
let sortMethod = 'normal';
const sortMethodDescription = {
    'normal': '现在是正常排序，点一下换成打开的窗口排在前面',
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
function updateItemList() {
    const panels = Array.from(elements.main.querySelectorAll('div.panel'));
    const panelIds = new Set(panels.map(p => p.dataset['id']));
    const items = Array.from(elements.itemList.querySelectorAll('li'));
    items.forEach(i => panelIds.has(i.dataset['id']) ? i.classList.add('active') : i.classList.remove('active'));
    elements.sortButton.title = sortMethodDescription[sortMethod];
    elements.sortButton.style.background = sortMethod == 'active' ? 'lightgray' : '';
    if (sortMethod == 'normal') {
        items.sort((i1, i2) => i1.dataset['id'].localeCompare(i2.dataset['id']));
    }
    else {
        items.sort((i1, i2) => {
            const i1InPanel = panelIds.has(i1.dataset['id']) ? 0 : 1;
            const i2InPanel = panelIds.has(i2.dataset['id']) ? 0 : 1;
            return i1InPanel != i2InPanel ? i1InPanel - i2InPanel : i1.dataset['id'].localeCompare(i2.dataset['id']);
        });
    }
    items.forEach(i => elements.itemList.appendChild(i));
}
function handleFocusPanel(itemId) {
    const panels = Array.from(elements.main.querySelectorAll('div.panel'));
    const getZIndex = (e) => e.dataset['id'] == itemId ? 1000 : +(e.style.zIndex ?? '0');
    panels.sort((e1, e2) => getZIndex(e1) - getZIndex(e2));
    for (const [panel, panelIndex] of panels.map((p, i) => [p, i])) {
        panel.style.zIndex = (panelIndex + 1).toString();
    }
}
function handleOpenPanel(item) {
    const panels = Array.from(elements.main.querySelectorAll('div.panel'));
    const existPanel = panels.find(p => p.dataset['id'] == item.id);
    if (existPanel) {
        handleFocusPanel(item.id);
    }
    else {
        const tree = collectRecipeTree(item, []);
        layoutRecipeTree(tree);
        drawRecipeTree(tree);
        handleFocusPanel(tree.data.id);
        updateItemList();
    }
}
function handleClosePanel(itemId) {
    const panels = Array.from(elements.main.querySelectorAll('div.panel'));
    const panel = panels.find(p => p.dataset['id'] == itemId);
    if (panel) {
        allCleanupHandlers[itemId].forEach(f => f());
        delete allCleanupHandlers[itemId];
        panel.remove();
        updateItemList();
    }
    else {
        console.log(`what are you sending to handleClosePanel? ${itemId}`);
    }
}
function handleToggleOpen(item) {
    const panels = Array.from(elements.main.querySelectorAll('div.panel'));
    const maxZIndex = panels.reduce((a, p) => Math.max(a, +(p.style.zIndex ?? '0')), 0);
    const panel = panels.find(p => p.dataset['id'] == item.id);
    if (panel && panel.style.zIndex == maxZIndex.toString()) {
        handleClosePanel(item.id);
    }
    else if (panel) {
        handleFocusPanel(item.id);
    }
    else {
        handleOpenPanel(item);
    }
}
