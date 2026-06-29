export function comfyRowKey(nodeId, fieldName) {
    return `${nodeId}::${fieldName}`;
}

function objectOrNull(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
}

function cleanText(value) {
    return value == null ? "" : String(value).trim();
}

function isApiPromptObject(value) {
    const obj = objectOrNull(value);
    if (!obj) return false;
    return Object.values(obj).some((node) => objectOrNull(node)?.class_type && objectOrNull(node)?.inputs);
}

function canvasGraph(parsed) {
    return objectOrNull(parsed?.workflow) || objectOrNull(parsed) || {};
}

function canvasNodeList(parsed) {
    const graph = canvasGraph(parsed);
    if (Array.isArray(graph.nodes)) return graph.nodes;
    return objectOrNull(graph.nodes) ? Object.values(graph.nodes) : [];
}

function canvasGroupList(parsed) {
    const graph = canvasGraph(parsed);
    if (Array.isArray(graph.groups)) return graph.groups;
    return objectOrNull(graph.groups) ? Object.values(graph.groups) : [];
}

function canvasNodesById(parsed) {
    const map = new Map();
    for (const node of canvasNodeList(parsed)) {
        if (node?.id == null) continue;
        map.set(String(node.id), node);
    }
    return map;
}

function normalizeCanvasLink(link) {
    if (Array.isArray(link)) {
        return { id: link[0], origin_id: link[1], origin_slot: link[2], target_id: link[3], target_slot: link[4], type: link[5] };
    }
    return objectOrNull(link) || null;
}

function canvasLinksById(parsed) {
    const graph = canvasGraph(parsed);
    const links = Array.isArray(graph.links) ? graph.links : objectOrNull(graph.links) ? Object.values(graph.links) : [];
    const map = new Map();
    for (const raw of links) {
        const link = normalizeCanvasLink(raw);
        if (link?.id == null) continue;
        map.set(String(link.id), link);
    }
    return map;
}

function canvasNodeNaturallyActive(node) {
    return node && (node.mode == null || Number(node.mode) === 0);
}

function canvasNodeActive(node) {
    return node && (node._xlrhForceActive || canvasNodeNaturallyActive(node));
}

function hasCanvasWidgets(node) {
    return (Array.isArray(node?.widgets_values) && node.widgets_values.length > 0) || (Array.isArray(node?.widgets) && node.widgets.length > 0);
}

function nodeTitleCandidates(node) {
    return [
        node?._meta?.title,
        node?.properties?.sdppp_widgetable_title,
        node?.title,
        node?.properties?.["Node name for S&R"],
        node?.class_type,
        node?.type,
    ].map(cleanText).filter(Boolean);
}

function markerFromTitle(title) {
    const text = cleanText(title);
    if (!text.startsWith("#")) return null;
    const label = text.replace(/^#+\s*/, "").trim() || text;
    const match = label.match(/^(\d+(?:\.\d+)?)/);
    return {
        title: text,
        label,
        order: match ? Number(match[1]) : Number.POSITIVE_INFINITY,
    };
}

function markerInfo(node) {
    return markerFromTitle(nodeTitleCandidates(node).find((item) => item.startsWith("#")));
}

function inputMarkerInfo(node, inputName) {
    const meta = inputMetaInfo(node, inputName);
    const marker = markerFromTitle(meta.title) || (meta.label ? { title: meta.title || `#${meta.label}`, label: meta.label, order: meta.order ?? Number.POSITIVE_INFINITY } : null);
    return marker ? { ...marker, sourceNodeId: cleanText(meta.sourceNodeId), sourceFieldName: cleanText(meta.sourceFieldName) } : null;
}

function inputMetaInfo(node, inputName) {
    return objectOrNull(objectOrNull(node?._xlrhInputMeta)?.[inputName]) || {};
}

function isHiddenNode(node) {
    return nodeTitleCandidates(node)[0]?.startsWith(".");
}

function nodeDisplayName(nodeId, node) {
    return markerInfo(node)?.label || nodeTitleCandidates(node)[0] || `节点 ${nodeId}`;
}

function canvasTitleForPrompt(node) {
    return markerInfo(node)?.title || nodeTitleCandidates(node)[0] || cleanText(node?.type);
}

const GROUP_SELECTOR_FIELD = "__group_selector";
const GROUP_TOGGLE_FIELD = "__group_toggle";
const GROUP_TOGGLE_SELECT_FIELD = "__group_toggle_select";
const SOURCE_WIDGET_FIELD = "__source_widget";
const COLOR_ALIASES = { green: ["#8a8"] };

function nodeType(node) {
    return cleanText(node?.type || node?.class_type);
}

function sdpppTitle(node) {
    return cleanText(node?.properties?.sdppp_widgetable_title || node?.title || node?._meta?.title || nodeType(node));
}

function isRgthreeGroupSelector(node) {
    const type = nodeType(node);
    const props = objectOrNull(node?.properties) || {};
    return /rgthree/i.test(type) && /groups bypasser/i.test(type) && cleanText(props.toggleRestriction) === "always one";
}

function isRgthreeGroupControl(node) {
    const type = nodeType(node);
    return /rgthree/i.test(type) && /groups (bypasser|muter)/i.test(type);
}

function rgthreeInactiveMode(node) {
    return /groups muter/i.test(nodeType(node)) ? 2 : 4;
}

function isSingleGroupRestriction(value) {
    return /^(max one|always one)$/i.test(cleanText(value));
}

function shouldUseGroupDropdown(title, marker) {
    const text = `${cleanText(title)} ${cleanText(marker?.label)} ${cleanText(marker?.title)}`;
    return /\u63d0\u793a\u8bcd(?:\u9884\u8bbe)?\u9009\u62e9/.test(text) || /\u63d0\u793a\u8bcd\u9884\u8bbe/.test(text);
}

function nodeInsideGroup(node, group) {
    const box = Array.isArray(group?.bounding) ? group.bounding.map(Number) : null;
    const pos = Array.isArray(node?.pos) ? node.pos.map(Number) : null;
    if (!box || !pos) return false;
    const [x, y, width, height] = box;
    return pos[0] >= x && pos[1] >= y && pos[0] <= x + width && pos[1] <= y + height;
}

function colorMatches(filter, color) {
    const key = cleanText(filter).toLowerCase();
    const target = cleanText(color).toLowerCase();
    return (COLOR_ALIASES[key] || [key]).includes(target);
}

function rgthreeGroups(parsed, node) {
    const props = objectOrNull(node?.properties) || {};
    const colors = cleanText(props.matchColors).split(/[\s,]+/).filter(Boolean);
    const title = cleanText(props.matchTitle).toLowerCase();
    return canvasGroupList(parsed).filter((group) => {
        const groupTitle = cleanText(group?.title);
        if (!groupTitle) return false;
        if (title && !groupTitle.toLowerCase().includes(title)) return false;
        return colors.length === 0 || colors.some((color) => colorMatches(color, group?.color));
    }).sort((a, b) => {
        if (cleanText(props.sort) === "position") {
            const ab = Array.isArray(a?.bounding) ? a.bounding : [0, 0];
            const bb = Array.isArray(b?.bounding) ? b.bounding : [0, 0];
            return (Number(ab[1]) - Number(bb[1])) || (Number(ab[0]) - Number(bb[0]));
        }
        return cleanText(a?.title).localeCompare(cleanText(b?.title), "zh-Hans-CN", { numeric: true });
    });
}

function groupActive(parsed, group) {
    return canvasNodeList(parsed).some((node) => nodeInsideGroup(node, group) && canvasNodeActive(node));
}

function isPlaceholderGroupTitle(value) {
    return /select|choose|\u8bf7\u9009\u62e9|\u8acb\u9078\u64c7/i.test(cleanText(value));
}

function activeGroupTitle(parsed, groups, key, fieldValues) {
    const saved = cleanText(fieldValues?.[key]);
    if (saved && !isPlaceholderGroupTitle(saved) && groups.some((group) => cleanText(group?.title) === saved)) return saved;
    const active = groups.find((group) => groupActive(parsed, group));
    const activeTitle = cleanText(active?.title);
    if (activeTitle && !isPlaceholderGroupTitle(activeTitle)) return activeTitle;
    const firstReal = groups.find((group) => !isPlaceholderGroupTitle(group?.title));
    return cleanText(firstReal?.title || activeTitle || groups[0]?.title);
}

function rgthreeControlRows(parsed, fieldValues = {}) {
    const rows = [];
    for (const node of canvasNodeList(parsed)) {
        if (!canvasNodeActive(node) || isHiddenNode(node) || !isRgthreeGroupControl(node)) continue;
        const groups = rgthreeGroups(parsed, node);
        if (groups.length === 0) continue;
        const nodeId = String(node.id);
        const marker = markerInfo(node);
        const title = sdpppTitle(node);
        const restriction = cleanText(objectOrNull(node?.properties)?.toggleRestriction);
        if (isRgthreeGroupSelector(node)) {
            if (groups.length < 2) continue;
            const key = comfyRowKey(nodeId, GROUP_SELECTOR_FIELD);
            const options = groups.map((group) => cleanText(group.title));
            const realOptions = options.filter((item) => !isPlaceholderGroupTitle(item));
            rows.push({
                nodeId,
                fieldName: GROUP_SELECTOR_FIELD,
                key,
                nodeName: title,
                label: title,
                description: title,
                fieldValue: activeGroupTitle(parsed, groups, key, fieldValues),
                fieldType: "LIST",
                options: realOptions.length ? realOptions : options,
                originalType: "string",
                comfyControl: "RGTHREE_GROUP_SELECTOR",
                marked: !!marker,
                markerOrder: marker?.order,
            });
            continue;
        }
        if ((isSingleGroupRestriction(restriction) || shouldUseGroupDropdown(title, marker)) && groups.length > 1) {
            const key = comfyRowKey(nodeId, GROUP_TOGGLE_SELECT_FIELD);
            const options = groups.map((group) => cleanText(group.title));
            const realOptions = options.filter((item) => !isPlaceholderGroupTitle(item));
            rows.push({
                nodeId,
                fieldName: GROUP_TOGGLE_SELECT_FIELD,
                key,
                nodeName: title,
                label: title,
                description: title,
                fieldValue: activeGroupTitle(parsed, groups, key, fieldValues),
                fieldType: "LIST",
                options: realOptions.length ? realOptions : options,
                originalType: "string",
                comfyControl: "RGTHREE_GROUP_TOGGLE_SELECT",
                toggleRestriction: restriction,
                marked: !!marker,
                markerOrder: marker?.order,
            });
            continue;
        }
        const explicitSingleActive = isSingleGroupRestriction(restriction) && groups.some((group) => {
            const key = comfyRowKey(nodeId, `${GROUP_TOGGLE_FIELD}:${cleanText(group.id || cleanText(group.title))}`);
            return fieldValues && Object.prototype.hasOwnProperty.call(fieldValues, key) && (fieldValues[key] === true || fieldValues[key] === "true");
        });
        for (const group of groups) {
            const groupTitle = cleanText(group.title);
            const fieldName = `${GROUP_TOGGLE_FIELD}:${cleanText(group.id || groupTitle)}`;
            const key = comfyRowKey(nodeId, fieldName);
            const saved = fieldValues && Object.prototype.hasOwnProperty.call(fieldValues, key) ? fieldValues[key] : explicitSingleActive ? false : groupActive(parsed, group);
            rows.push({
                nodeId,
                fieldName,
                key,
                nodeName: title,
                label: groupTitle,
                description: `${marker?.label || title} · ${groupTitle}`,
                fieldValue: saved === true || saved === "true",
                fieldType: "BOOLEAN",
                originalType: "boolean",
                comfyControl: "RGTHREE_GROUP_TOGGLE",
                groupId: group.id,
                groupTitle,
                toggleRestriction: restriction,
                marked: !!marker,
                markerOrder: marker?.order,
            });
        }
    }
    return sortRows(rows);
}

function setGroupActive(nodes, group, active, inactiveMode = 4) {
    let changed = false;
    for (const node of nodes) {
        if (!nodeInsideGroup(node, group)) continue;
        if (active && Number(node.mode) === inactiveMode) {
            node.mode = 0;
            changed = true;
        } else if (!active && (node.mode == null || Number(node.mode) === 0)) {
            node.mode = inactiveMode;
            changed = true;
        }
    }
    return changed;
}

function applyGroupSelectorValues(parsed, fieldValues = {}) {
    const result = deepClone(parsed);
    for (let pass = 0; pass < 3; pass += 1) {
        let changed = false;
        const nodes = canvasNodeList(result);
        for (const row of rgthreeControlRows(result, fieldValues)) {
            const selector = nodes.find((node) => String(node.id) === String(row.nodeId));
            const groups = rgthreeGroups(result, selector);
            const inactiveMode = rgthreeInactiveMode(selector);
            if (row.comfyControl === "RGTHREE_GROUP_TOGGLE") {
                const active = row.fieldValue === true || row.fieldValue === "true";
                const target = groups.find((group) => String(group.id) === String(row.groupId) || cleanText(group.title) === row.groupTitle);
                if (!target) continue;
                if (active && isSingleGroupRestriction(row.toggleRestriction)) {
                    for (const group of groups) {
                        if (group === target) continue;
                        changed = setGroupActive(nodes, group, false, inactiveMode) || changed;
                    }
                }
                changed = setGroupActive(nodes, target, active, inactiveMode) || changed;
                continue;
            }
            if (row.comfyControl === "RGTHREE_GROUP_TOGGLE_SELECT") {
                for (const group of groups) {
                    const selected = cleanText(group.title) === row.fieldValue;
                    changed = setGroupActive(nodes, group, selected, inactiveMode) || changed;
                }
                continue;
            }
            for (const group of groups) {
                const selected = cleanText(group.title) === row.fieldValue;
                changed = setGroupActive(nodes, group, selected, inactiveMode) || changed;
            }
        }
        if (!changed) break;
    }
    return result;
}

function markCanvasUpstreamActive(nodes, links, nodeId, seen = new Set(), allowInactiveRoot = false) {
    const id = String(nodeId);
    const node = nodes.get(id);
    if (!node || seen.has(id)) return;
    seen.add(id);
    if (!canvasNodeNaturallyActive(node)) {
        if (!allowInactiveRoot) return;
        if (hasLinkedInputs(node)) {
            for (const input of Array.isArray(node.inputs) ? node.inputs : []) {
                if (input?.link == null) continue;
                const link = links.get(String(input.link));
                if (link?.origin_id != null) markCanvasUpstreamActive(nodes, links, link.origin_id, seen, true);
            }
            return;
        }
    }
    node._xlrhForceActive = true;
    for (const input of Array.isArray(node.inputs) ? node.inputs : []) {
        if (input?.link == null) continue;
        const link = links.get(String(input.link));
        if (link?.origin_id != null) markCanvasUpstreamActive(nodes, links, link.origin_id, seen, false);
    }
}

function applyStoredUeLinks(parsed) {
    const result = deepClone(parsed);
    const graph = canvasGraph(result);
    const ueLinks = Array.isArray(graph?.extra?.ue_links) ? graph.extra.ue_links : [];
    if (ueLinks.length === 0) return result;
    if (!Array.isArray(graph.links)) graph.links = Array.isArray(result.links) ? result.links : [];
    const nodes = canvasNodesById(result);
    const links = canvasLinksById(result);
    const liveSources = new Set();
    ueLinks.forEach((ue, index) => {
        const target = nodes.get(String(ue?.downstream));
        const source = nodes.get(String(ue?.upstream));
        const input = target?.inputs?.[Number(ue?.downstream_slot)];
        if (!target || !source || !input || input.link != null) return;
        const id = `ue:${ue.downstream}:${ue.downstream_slot}:${index}`;
        const link = { id, origin_id: source.id, origin_slot: Number(ue.upstream_slot) || 0, target_id: target.id, target_slot: Number(ue.downstream_slot) || 0, type: ue.type || input.type || "*" };
        input.link = id;
        graph.links.push(link);
        links.set(id, link);
        if (canvasNodeActive(target)) liveSources.add(String(source.id));
    });
    liveSources.forEach((id) => markCanvasUpstreamActive(nodes, links, id, new Set(), true));
    return result;
}

function setCanvasLinkOrigin(rawLink, originId, originSlot) {
    if (Array.isArray(rawLink)) {
        rawLink[1] = originId;
        rawLink[2] = originSlot;
        return;
    }
    if (!rawLink) return;
    rawLink.origin_id = originId;
    rawLink.origin_slot = originSlot;
}

function resolveGetSetNodes(parsed) {
    const result = deepClone(parsed);
    const graph = canvasGraph(result);
    const rawLinks = Array.isArray(graph.links) ? graph.links : objectOrNull(graph.links) ? Object.values(graph.links) : [];
    const nodes = canvasNodesById(result);
    const links = canvasLinksById(result);
    const setNodes = new Map();
    for (const node of nodes.values()) {
        if (cleanText(node?.type) !== "SetNode") continue;
        const key = cleanText(firstWidgetValue(node));
        const inputLink = links.get(String(node?.inputs?.[0]?.link));
        const current = setNodes.get(key);
        if (key && inputLink && (!current || canvasNodeActive(node))) setNodes.set(key, inputLink);
    }
    for (const node of nodes.values()) {
        if (cleanText(node?.type) !== "GetNode" || !canvasNodeActive(node)) continue;
        const source = setNodes.get(cleanText(firstWidgetValue(node)));
        if (!source) continue;
        for (const rawLink of rawLinks) {
            const link = normalizeCanvasLink(rawLink);
            if (String(link?.origin_id) === String(node.id)) setCanvasLinkOrigin(rawLink, source.origin_id, source.origin_slot);
        }
        markCanvasUpstreamActive(nodes, links, source.origin_id, new Set(), true);
    }
    return result;
}

function expandCanvasSubgraphs(parsed) {
    const result = deepClone(parsed);
    const graph = canvasGraph(result);
    const subgraphs = Array.isArray(result?.definitions?.subgraphs) ? result.definitions.subgraphs : [];
    if (!Array.isArray(graph.nodes) || !Array.isArray(graph.links) || subgraphs.length === 0) return result;
    const byType = new Map(subgraphs.map((item) => [cleanText(item.id), item]));
    const nodes = canvasNodesById(result);
    const links = canvasLinksById(result);
    const extraNodes = [];
    const extraLinks = [];
    const expandedIds = new Set();
    const outputSources = new Map();
    const nextLinkId = (base) => `sg:${base}`;
    const outerSource = (node, slot) => {
        const outerInput = node?.inputs?.[Number(slot)];
        return outerInput?.link == null ? null : links.get(String(outerInput.link));
    };
    const prefixed = (nodeId, id) => `${nodeId}:${id}`;
    for (const node of graph.nodes) {
        const sub = byType.get(cleanText(node?.type));
        if (!sub || !canvasNodeActive(node)) continue;
        expandedIds.add(String(node.id));
        const subLinks = (sub.links || []).map(normalizeCanvasLink).filter(Boolean);
        const cloneMap = new Map();
        for (const inner of sub.nodes || []) {
            const clone = deepClone(inner);
            clone.id = prefixed(node.id, inner.id);
            if (Number(clone.mode) === 4) clone.mode = 0;
            cloneMap.set(String(inner.id), clone);
            extraNodes.push(clone);
        }
        const addLink = (id, origin_id, origin_slot, target_id, target_slot, type) => {
            const link = { id, origin_id, origin_slot, target_id, target_slot, type };
            const target = cloneMap.get(String(String(target_id).split(":").pop())) || nodes.get(String(target_id));
            const input = target?.inputs?.[Number(target_slot)];
            if (input) input.link = id;
            extraLinks.push(link);
        };
        for (const link of subLinks) {
            if (link.target_id === -20) continue;
            const targetId = prefixed(node.id, link.target_id);
            if (link.origin_id === -10) {
                const source = outerSource(node, link.origin_slot);
                const input = cloneMap.get(String(link.target_id))?.inputs?.[Number(link.target_slot)];
                if (source) addLink(nextLinkId(`${node.id}:${link.id}`), source.origin_id, source.origin_slot, targetId, link.target_slot, link.type);
                else if (input) input.link = null;
            } else {
                addLink(nextLinkId(`${node.id}:${link.id}`), prefixed(node.id, link.origin_id), link.origin_slot, targetId, link.target_slot, link.type);
            }
        }
        for (const sourceLink of subLinks.filter((link) => link.target_id === -20)) {
            const source = sourceLink.origin_id === -10 ? outerSource(node, sourceLink.origin_slot) : { origin_id: prefixed(node.id, sourceLink.origin_id), origin_slot: sourceLink.origin_slot };
            if (source) outputSources.set(`${node.id}:${sourceLink.target_slot}`, { origin_id: source.origin_id, origin_slot: source.origin_slot });
        }
        for (const outer of graph.links.map(normalizeCanvasLink).filter((link) => String(link?.origin_id) === String(node.id))) {
            const sourceLink = subLinks.find((link) => link.target_id === -20 && Number(link.target_slot) === Number(outer.origin_slot));
            if (!sourceLink) continue;
            const source = sourceLink.origin_id === -10 ? outerSource(node, sourceLink.origin_slot) : { origin_id: prefixed(node.id, sourceLink.origin_id), origin_slot: sourceLink.origin_slot };
            if (source) extraLinks.push({ id: outer.id, origin_id: source.origin_id, origin_slot: source.origin_slot, target_id: outer.target_id, target_slot: outer.target_slot, type: outer.type });
        }
    }
    if (expandedIds.size === 0) return result;
    const remapSource = (link, seen = new Set()) => {
        const key = `${link.origin_id}:${Number(link.origin_slot) || 0}`;
        const source = outputSources.get(key);
        if (!source || seen.has(key)) return link;
        seen.add(key);
        return remapSource({ ...link, origin_id: source.origin_id, origin_slot: source.origin_slot }, seen);
    };
    const remappedExtraLinks = extraLinks.map((link) => remapSource(link));
    graph.nodes = graph.nodes.filter((node) => !expandedIds.has(String(node?.id))).concat(extraNodes);
    graph.links = graph.links.map(normalizeCanvasLink).filter((link) => link && !expandedIds.has(String(link.origin_id)) && !expandedIds.has(String(link.target_id))).concat(remappedExtraLinks);
    return result;
}

function firstWidgetValue(node) {
    return Array.isArray(node?.widgets_values) ? node.widgets_values[0] : undefined;
}

function finiteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
}

function numericRangeFromConfig(config) {
    const source = objectOrNull(config) || {};
    const range = { min: finiteNumber(source.min), max: finiteNumber(source.max), step: finiteNumber(source.step) };
    return Object.fromEntries(Object.entries(range).filter(([, value]) => value !== undefined));
}

function numericRangeFromCanvasNode(node, widgetIndex = 0) {
    const widget = Array.isArray(node?.widgets) ? node.widgets[widgetIndex] : null;
    const props = objectOrNull(node?.properties) || {};
    return {
        ...numericRangeFromConfig(widget?.options),
        ...numericRangeFromConfig({ min: props.sdppp_min, max: props.sdppp_max, step: props.sdppp_step }),
    };
}

function inputAtLinkTarget(node, link) {
    const targetSlot = Number(link?.target_slot ?? link?.targetSlot ?? -1);
    const inputs = Array.isArray(node?.inputs) ? node.inputs : [];
    return inputs[targetSlot] || null;
}

function mergeLinkedWidgetMarkers(result, parsed, objectInfo) {
    const canvasMap = canvasNodesById(parsed);
    const links = canvasLinksById(parsed);
    for (const sourceNode of canvasMap.values()) {
        if (!canvasNodeActive(sourceNode) || isHiddenNode(sourceNode) || !hasCanvasWidgets(sourceNode)) continue;
        const marker = markerInfo(sourceNode);
        if (!marker) continue;
        for (const link of links.values()) {
            if (String(link.origin_id ?? link.originId) !== String(sourceNode.id)) continue;
            const targetId = String(link.target_id ?? link.targetId ?? "");
            const targetCanvasNode = canvasMap.get(targetId);
            const targetInput = inputAtLinkTarget(targetCanvasNode, link);
            const inputName = cleanText(targetInput?.name || targetInput?.widget?.name);
            const promptNode = result[targetId];
            if (!inputName || !promptNode?.inputs || !Object.prototype.hasOwnProperty.call(promptNode.inputs, inputName)) continue;
            promptNode._xlrhInputMeta = { ...(objectOrNull(promptNode._xlrhInputMeta) || {}), [inputName]: { ...marker, ...numericRangeFromCanvasNode(sourceNode), sourceNodeId: String(sourceNode.id), sourceFieldName: SOURCE_WIDGET_FIELD } };
            const value = firstWidgetValue(sourceNode);
            if (targetInput?.widget && value !== undefined) promptNode.inputs[inputName] = normalizeComfyInputValue(value, objectInfoInputSpec(objectInfo, promptNode.class_type, inputName));
        }
    }
}

function mergeCanvasNodeMeta(prompt, parsed, objectInfo) {
    const result = deepClone(prompt);
    const canvasMap = canvasNodesById(parsed);
    for (const [nodeId, node] of Object.entries(result)) {
        const canvasNode = canvasMap.get(String(nodeId));
        if (!canvasNode) continue;
        const title = markerInfo(canvasNode)?.title || markerInfo(node)?.title || canvasTitleForPrompt(canvasNode);
        if (title) node._meta = { ...(objectOrNull(node._meta) || {}), title };
        const inputs = objectOrNull(node.inputs) || {};
        const names = canvasWidgetNames(canvasNode, {});
        names.forEach((inputName, index) => {
            if (!Object.prototype.hasOwnProperty.call(inputs, inputName)) return;
            const range = numericRangeFromCanvasNode(canvasNode, index);
            if (Object.keys(range).length === 0) return;
            node._xlrhInputMeta = { ...(objectOrNull(node._xlrhInputMeta) || {}), [inputName]: { ...(objectOrNull(objectOrNull(node._xlrhInputMeta)?.[inputName]) || {}), ...range } };
        });
    }
    mergeLinkedWidgetMarkers(result, parsed, objectInfo);
    return result;
}

function inputValue(node, inputName) {
    const inputs = objectOrNull(node?.inputs) || {};
    return inputs[inputName];
}

function isLinkedInput(value) {
    return Array.isArray(value);
}

function objectInfoInputSpec(objectInfo, classType, inputName) {
    const info = objectOrNull(objectInfo?.[classType]);
    const inputs = objectOrNull(info?.input) || {};
    const groups = [objectOrNull(inputs.required), objectOrNull(inputs.optional), objectOrNull(inputs.hidden)];
    for (const group of groups) {
        if (group && Object.prototype.hasOwnProperty.call(group, inputName)) return group[inputName];
    }
    return null;
}

function knownWidgetNames(classType) {
    if (/^LoadImage$/i.test(classType)) return ["image"];
    if (/^LoadImageMask$/i.test(classType)) return ["image", "channel"];
    if (/(load|upload|input|source).*image|image.*(load|upload|input|source)|photoshop.*(image|layer)|(image|layer).*photoshop/i.test(classType)) return ["image"];
    if (/^KSampler$/i.test(classType)) return ["seed", "steps", "cfg", "sampler_name", "scheduler", "denoise"];
    if (/^EmptyLatentImage$/i.test(classType)) return ["width", "height", "batch_size"];
    if (/^CLIPTextEncode$/i.test(classType)) return ["text"];
    if (/^CheckpointLoaderSimple$/i.test(classType)) return ["ckpt_name"];
    if (/^SaveImage$/i.test(classType)) return ["filename_prefix"];
    if (/^LoraLoader$/i.test(classType)) return ["lora_name", "strength_model", "strength_clip"];
    if (/^LoraLoaderModelOnly$/i.test(classType)) return ["lora_name", "strength_model"];
    if (/^FluxKontextMultiReferenceLatentMethod$/i.test(classType)) return ["reference_latents_method"];
    if (/^ModelSamplingAuraFlow$/i.test(classType)) return ["shift"];
    if (/^CFGNorm$/i.test(classType)) return ["strength"];
    if (/^ControlNetLoader$/i.test(classType)) return ["control_net_name"];
    return [];
}

function objectInfoInputNames(objectInfo, classType) {
    const info = objectOrNull(objectInfo?.[classType]);
    const inputs = objectOrNull(info?.input) || {};
    return [objectOrNull(inputs.required), objectOrNull(inputs.optional)]
        .filter(Boolean)
        .flatMap((group) => Object.keys(group));
}

function canvasWidgetNames(node, objectInfo) {
    const classType = cleanText(node?.type || node?.class_type);
    const known = knownWidgetNames(classType);
    if (known.length) return known;
    const names = [];
    for (const input of Array.isArray(node?.inputs) ? node.inputs : []) {
        const name = cleanText(input?.widget?.name || input?.name);
        if (name && input?.widget && !names.includes(name)) names.push(name);
    }
    if (names.length) return names;
    for (const name of objectInfoInputNames(objectInfo, classType)) {
        if (!names.includes(name)) names.push(name);
    }
    if (!names.length && hasCanvasWidgets(node) && looksImageSourceNode(node)) names.push("image");
    return names;
}

function isControlAfterGenerateValue(value) {
    return typeof value === "string" && /^(fixed|randomize|increment|decrement)$/i.test(value);
}

function hasGenerateControl(objectInfo, classType, name) {
    const config = comfySpecConfig(objectInfoInputSpec(objectInfo, classType, name));
    return config.control_after_generate === true || /(^|_)seed$/i.test(cleanText(name));
}

function cleanedWidgetValues(node, names = [], objectInfo = null) {
    const values = Array.isArray(node?.widgets_values) ? [...node.widgets_values] : [];
    const classType = cleanText(node?.type || node?.class_type);
    for (let index = names.length - 1; index >= 0; index -= 1) {
        if (hasGenerateControl(objectInfo, classType, names[index]) && isControlAfterGenerateValue(values[index + 1])) {
            values.splice(index + 1, 1);
        }
    }
    return values;
}

function normalizeComfyInputValue(value, spec) {
    const type = comfySpecType(spec);
    if (type !== "INT" && type !== "INTEGER" && type !== "FLOAT" && type !== "NUMBER") return value;
    const number = Number(value);
    if (!Number.isFinite(number)) return value;
    const config = comfySpecConfig(spec);
    const min = finiteNumber(config.min);
    const max = finiteNumber(config.max);
    let next = type === "INT" || type === "INTEGER" ? Math.round(number) : number;
    if (min !== undefined && next < min) next = min;
    if (max !== undefined && next > max) next = max;
    return next;
}

function normalizePromptInputs(prompt, objectInfo) {
    for (const node of Object.values(prompt || {})) {
        const inputs = objectOrNull(node?.inputs);
        if (!inputs) continue;
        for (const [name, value] of Object.entries(inputs)) {
            if (!Array.isArray(value)) inputs[name] = normalizeComfyInputValue(value, objectInfoInputSpec(objectInfo, node.class_type, name));
        }
    }
    return prompt;
}

function widgetInputsFromCanvas(node, objectInfo) {
    const names = canvasWidgetNames(node, objectInfo);
    const values = cleanedWidgetValues(node, names, objectInfo);
    const inputs = {};
    names.forEach((name, index) => {
        if (values[index] !== undefined) inputs[name] = normalizeComfyInputValue(values[index], objectInfoInputSpec(objectInfo, node?.type || node?.class_type, name));
    });
    return inputs;
}

function sourceWidgetValue(sourceNode) {
    if (!sourceNode || !hasCanvasWidgets(sourceNode)) return undefined;
    return firstWidgetValue(sourceNode);
}

function typeParts(value) {
    return cleanText(value).split(/[,|]/).map((item) => cleanText(item)).filter(Boolean);
}

function typesCompatible(inputType, outputType) {
    const outputs = typeParts(outputType).filter((item) => item !== "*");
    if (outputs.length === 0) return false;
    const inputs = typeParts(inputType);
    return inputs.includes("*") || outputs.some((type) => inputs.includes(type));
}

function bypassInputLink(node, sourceSlot, links) {
    const inputs = Array.isArray(node?.inputs) ? node.inputs : [];
    const outputs = Array.isArray(node?.outputs) ? node.outputs : [];
    const output = outputs[Number(sourceSlot)] || {};
    const sameSlot = inputs[Number(sourceSlot)];
    if (sameSlot?.link != null) return links.get(String(sameSlot.link));
    const match = inputs.find((input) => input?.link != null && typesCompatible(input.type, output.type));
    return match?.link == null ? null : links.get(String(match.link));
}

function resolveCanvasSource(sourceId, sourceSlot, canvasMap, links, seen = new Set()) {
    const id = String(sourceId);
    const node = canvasMap.get(id);
    if (!node || seen.has(id)) return { sourceId, sourceSlot };
    const isReroute = cleanText(node?.type) === "Reroute";
    const isBypassed = !isReroute && !canvasNodeActive(node) && Number(node?.mode) === 4;
    if (!isReroute && !isBypassed) return { sourceId, sourceSlot };
    seen.add(id);
    const link = isReroute ? links.get(String(node?.inputs?.[0]?.link)) : bypassInputLink(node, sourceSlot, links);
    if (!link) return { sourceId, sourceSlot };
    return resolveCanvasSource(link.origin_id ?? link.originId, Number(link.origin_slot ?? link.originSlot ?? 0) || 0, canvasMap, links, seen);
}

function hasLinkedInputs(node) {
    return Array.isArray(node?.inputs) && node.inputs.some((input) => input?.link != null);
}

function isPureWidgetSourceNode(node, canvasMap, links) {
    if (!hasCanvasWidgets(node) || hasLinkedInputs(node)) return false;
    let linked = false;
    for (const link of links.values()) {
        if (String(link.origin_id ?? link.originId) !== String(node.id)) continue;
        linked = true;
        const targetNode = canvasMap.get(String(link.target_id ?? link.targetId ?? ""));
        if (!inputAtLinkTarget(targetNode, link)?.widget) return false;
    }
    return linked;
}

function buildPromptFromCanvas(parsed, objectInfo) {
    const canvasMap = canvasNodesById(parsed);
    if (!canvasMap.size) return null;
    if (!objectInfo || Object.keys(objectInfo).length === 0) {
        throw new Error("普通 Comfy workflow JSON 需要先读取 Comfy 云端节点后才能提交。");
    }
    const links = canvasLinksById(parsed);
    const prompt = {};
    for (const [nodeId, canvasNode] of canvasMap.entries()) {
        const classType = cleanText(canvasNode?.type || canvasNode?.class_type);
        if (!canvasNodeActive(canvasNode) || !classType || !objectInfo?.[classType]) continue;
        if (isPureWidgetSourceNode(canvasNode, canvasMap, links)) continue;
        const promptNode = { class_type: classType, inputs: {}, _meta: { title: canvasTitleForPrompt(canvasNode) || classType } };
        for (const input of Array.isArray(canvasNode.inputs) ? canvasNode.inputs : []) {
            const inputName = cleanText(input?.name || input?.widget?.name);
            if (!inputName || input.link == null) continue;
            const link = links.get(String(input.link));
            const resolved = resolveCanvasSource(link?.origin_id ?? link?.originId, Number(link?.origin_slot ?? link?.originSlot ?? 0) || 0, canvasMap, links);
            const sourceId = resolved.sourceId;
            const sourceSlot = resolved.sourceSlot;
            const sourceNode = canvasMap.get(String(sourceId));
            const literal = input.widget && isPureWidgetSourceNode(sourceNode, canvasMap, links) ? sourceWidgetValue(sourceNode) : undefined;
            const value = literal !== undefined ? literal : [String(sourceId), sourceSlot];
            promptNode.inputs[inputName] = Array.isArray(value) ? value : normalizeComfyInputValue(value, objectInfoInputSpec(objectInfo, classType, inputName));
        }
        for (const [name, value] of Object.entries(widgetInputsFromCanvas(canvasNode, objectInfo))) {
            if (!Object.prototype.hasOwnProperty.call(promptNode.inputs, name)) promptNode.inputs[name] = value;
        }
        canvasWidgetNames(canvasNode, objectInfo).forEach((name, index) => {
            if (!Object.prototype.hasOwnProperty.call(promptNode.inputs, name)) return;
            const range = numericRangeFromCanvasNode(canvasNode, index);
            if (Object.keys(range).length === 0) return;
            promptNode._xlrhInputMeta = { ...(objectOrNull(promptNode._xlrhInputMeta) || {}), [name]: { ...(objectOrNull(objectOrNull(promptNode._xlrhInputMeta)?.[name]) || {}), ...range } };
        });
        prompt[nodeId] = promptNode;
    }
    return Object.keys(prompt).length ? prompt : null;
}

function findApiPrompt(parsed) {
    return isApiPromptObject(parsed?.prompt)
        ? parsed.prompt
        : isApiPromptObject(parsed?.output)
          ? parsed.output
          : isApiPromptObject(parsed?.api_prompt)
            ? parsed.api_prompt
            : isApiPromptObject(parsed?.workflow?.api_prompt)
              ? parsed.workflow.api_prompt
              : isApiPromptObject(parsed)
                ? parsed
                : null;
}

function hasComfyControlValues(fieldValues = {}) {
    return Object.keys(fieldValues || {}).some((key) => key.includes(`::${GROUP_SELECTOR_FIELD}`) || key.includes(`::${GROUP_TOGGLE_SELECT_FIELD}`) || key.includes(`::${GROUP_TOGGLE_FIELD}:`));
}

export function parseComfyWorkflowJson(raw, fallbackName = "未命名工作流", objectInfo = null, fieldValues = {}) {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    const apiPrompt = findApiPrompt(parsed);
    const useCanvasPrompt = !apiPrompt || (hasComfyControlValues(fieldValues) && canvasNodeList(parsed).length > 0);
    const prepared = useCanvasPrompt ? expandCanvasSubgraphs(resolveGetSetNodes(applyStoredUeLinks(applyGroupSelectorValues(parsed, fieldValues)))) : parsed;
    const prompt = normalizePromptInputs(useCanvasPrompt ? buildPromptFromCanvas(prepared, objectInfo) : apiPrompt, objectInfo);
    if (!prompt) {
        throw new Error("当前工作流不是 Comfy 可提交格式。普通画布 workflow JSON 暂不能直接提交。");
    }
    const name = String(parsed?.name || parsed?.title || fallbackName || "未命名工作流").trim();
    return { name, prompt: mergeCanvasNodeMeta(prompt, prepared, objectInfo), selectorRows: rgthreeControlRows(prepared, fieldValues), raw: parsed };
}

function fieldTitle(nodeId, node, inputName, marker) {
    return marker?.label || `${nodeDisplayName(nodeId, node)} · ${inputName}`;
}

function looksImageFieldName(inputName) {
    const name = String(inputName || "").toLowerCase();
    return name === "image" || /(^|[_\s-])(image|img|picture|photo)($|[_\s-])/i.test(name) || /(图像|图片|照片)/.test(name);
}

function looksImageSourceNode(node) {
    if (isImageOutputNode(node)) return false;
    const text = [node?.class_type, node?.type, ...nodeTitleCandidates(node)].map(cleanText).join(" ").toLowerCase();
    return /(load|upload|input|source).*image|image.*(load|upload|input|source)|photoshop|layer/.test(text) || /((上传|导入|输入).*(图像|图片|照片)|(图像|图片|照片).*(上传|导入|输入))/.test(text);
}

function looksImageInput(node, inputName, value) {
    if (isLinkedInput(value)) return false;
    const name = String(inputName || "").toLowerCase();
    const imageSource = looksImageSourceNode(node);
    const imageValue = value == null || typeof value === "string" || (imageSource && looksImageFieldName(name));
    if (!imageValue) return false;
    if (looksImageFieldName(name) && imageSource) return true;
    if (looksImageFieldName(name) && typeof value === "string") return true;
    if (imageSource && /^(input|upload|source|file|filename|path|url|mask)$/i.test(name)) return true;
    return /(upload|file|path)/i.test(name) && /(image|img|picture|photo)/i.test(name);
}

function comfyInputSpec(objectInfo, node, inputName) {
    return objectInfoInputSpec(objectInfo, node?.class_type, inputName);
}

function comfySpecType(spec) {
    const raw = Array.isArray(spec) ? spec[0] : spec;
    if (Array.isArray(raw)) return "LIST";
    return raw == null ? "" : String(raw).toUpperCase();
}

function comfySpecOptions(spec) {
    const raw = Array.isArray(spec) ? spec[0] : null;
    return Array.isArray(raw) ? raw.map(String) : [];
}

function comfySpecConfig(spec) {
    return objectOrNull(Array.isArray(spec) ? spec[1] : null) || {};
}

function comfyNumericSpec(spec) {
    const config = comfySpecConfig(spec);
    const read = (key) => Number.isFinite(Number(config[key])) ? Number(config[key]) : undefined;
    return { min: read("min"), max: read("max"), step: read("step") };
}

function fieldTypeFromSpec(spec, value) {
    const type = comfySpecType(spec);
    if (type === "IMAGE" || type === "IMAGEUPLOAD") return "IMAGE";
    if (type === "INT" || type === "INTEGER") return "INT";
    if (type === "FLOAT" || type === "NUMBER") return "FLOAT";
    if (type === "BOOLEAN" || type === "BOOL") return "BOOLEAN";
    if (type === "LIST") return "LIST";
    if (type === "STRING") return "TEXT";
    return fieldTypeFromValue(value);
}

const BLOCKED_PARAM_TYPES = new Set(["IMAGE", "LATENT", "MODEL", "CLIP", "VAE", "CONDITIONING"]);
function fieldTypeFromValue(value) {
    if (typeof value === "number") return Number.isInteger(value) ? "INT" : "FLOAT";
    if (typeof value === "boolean") return "BOOLEAN";
    return String(value || "").length > 48 || /text|prompt|positive|negative/i.test(String(value || "")) ? "TEXT" : "STRING";
}

const AUTO_PARAM_INPUT_RE = /^(text|prompt|positive|negative|seed|steps|cfg|denoise|width|height|batch_size|sampler_name|scheduler|noise_seed|guidance|strength|scale)$/i;
function isAutoParamCandidate(node, inputName, fieldType) {
    const name = cleanText(inputName);
    const cls = cleanText(node?.class_type);
    if (AUTO_PARAM_INPUT_RE.test(name)) return true;
    if ((fieldType === "TEXT" || fieldType === "STRING") && /prompt|positive|negative|text/i.test(`${name} ${cls}`)) return true;
    return /^(KSampler|KSamplerAdvanced|EmptyLatentImage|CLIPTextEncode)$/i.test(cls) && knownWidgetNames(cls).includes(name);
}

function sortRows(rows) {
    return rows
        .map((row, index) => ({ row, index }))
        .sort((a, b) => {
            const selectorDelta = Number(a.row.comfyControl !== "RGTHREE_GROUP_SELECTOR") - Number(b.row.comfyControl !== "RGTHREE_GROUP_SELECTOR");
            if (selectorDelta) return selectorDelta;
            const markedDelta = Number(!a.row.marked) - Number(!b.row.marked);
            if (markedDelta) return markedDelta;
            const orderDelta = (a.row.markerOrder ?? Number.POSITIVE_INFINITY) - (b.row.markerOrder ?? Number.POSITIVE_INFINITY);
            return orderDelta || a.index - b.index;
        })
        .map((item) => item.row);
}

function rowTarget(row) {
    return { nodeId: row.nodeId, fieldName: row.fieldName };
}

function rowTargets(row) {
    return Array.isArray(row?.targets) && row.targets.length > 0 ? row.targets : [rowTarget(row)];
}

function appendRowTarget(row, target) {
    if (!target?.nodeId || !target?.fieldName) return;
    row.targets = row.targets || [];
    if (!row.targets.some((item) => item.nodeId === target.nodeId && item.fieldName === target.fieldName)) row.targets.push(target);
}

function markedParamMergeKey(row) {
    if (!row?.marked || row?.comfyControl) return "";
    const label = cleanText(row.label || row.description);
    if (!label) return "";
    return [label, row.fieldType || "", row.markerOrder ?? ""].join("::");
}

function mergeSourceRows(rows) {
    const merged = [];
    const byKey = new Map();
    for (const row of rows) {
        if (!row.sourceNodeId) {
            merged.push(row);
            continue;
        }
        const existing = byKey.get(row.key);
        if (existing) {
            appendRowTarget(existing, rowTarget(row));
        } else {
            const next = { ...row, targets: [rowTarget(row)] };
            byKey.set(row.key, next);
            merged.push(next);
        }
    }
    return merged;
}

function mergeMarkedParamRows(rows) {
    const merged = [];
    const byTitle = new Map();
    for (const row of rows) {
        const mergeKey = markedParamMergeKey(row);
        if (!mergeKey) {
            merged.push(row);
            continue;
        }
        const existing = byTitle.get(mergeKey);
        if (existing) {
            for (const target of rowTargets(row)) appendRowTarget(existing, target);
        } else {
            const next = { ...row, targets: [...rowTargets(row)] };
            byTitle.set(mergeKey, next);
            merged.push(next);
        }
    }
    return merged;
}

export function analyzeComfyPrompt(prompt, objectInfo, selectorRows = []) {
    const imageRows = [];
    const autoImageRows = [];
    const paramRows = [];
    const autoParamRows = [];
    const nodes = objectOrNull(prompt) || {};
    for (const [nodeId, node] of Object.entries(nodes)) {
        const inputs = objectOrNull(node?.inputs) || {};
        const nodeMarker = markerInfo(node);
        for (const inputName of Object.keys(inputs)) {
            const value = inputValue(node, inputName);
            if (isLinkedInput(value)) continue;
            const inputMarker = inputMarkerInfo(node, inputName);
            if (isHiddenNode(node) && !inputMarker) continue;
            const inputMeta = inputMetaInfo(node, inputName);
            const marker = inputMarker || nodeMarker;
            const spec = comfyInputSpec(objectInfo, node, inputName);
            const specType = comfySpecType(spec);
            const base = {
                nodeId,
                fieldName: inputName,
                key: marker?.sourceNodeId ? comfyRowKey(marker.sourceNodeId, marker.sourceFieldName || SOURCE_WIDGET_FIELD) : comfyRowKey(nodeId, inputName),
                nodeName: nodeDisplayName(nodeId, node),
                label: marker?.label || "",
                marked: !!marker,
                sourceNodeId: marker?.sourceNodeId || "",
                markerOrder: marker?.order,
                description: fieldTitle(nodeId, node, inputName, marker),
                fieldValue: value == null ? "" : String(value),
            };
            if (!isImageOutputNode(node) && (specType === "IMAGE" || specType === "IMAGEUPLOAD" || looksImageInput(node, inputName, value))) {
                const row = { ...base, label: base.label || nodeDisplayName(nodeId, node), fieldType: "IMAGE" };
                (marker ? imageRows : autoImageRows).push(row);
            } else {
                const fieldType = spec ? fieldTypeFromSpec(spec, value) : fieldTypeFromValue(value);
                if (BLOCKED_PARAM_TYPES.has(fieldType)) continue;
                if (!marker && !isAutoParamCandidate(node, inputName, fieldType)) continue;
                const numeric = fieldType === "INT" || fieldType === "FLOAT" ? { ...comfyNumericSpec(spec), ...numericRangeFromConfig(inputMeta) } : {};
                (marker ? paramRows : autoParamRows).push({ ...base, fieldType, options: comfySpecOptions(spec), ...numeric, originalType: typeof value });
            }
        }
    }
    const markedImages = sortRows(mergeSourceRows(imageRows));
    const fallbackImages = sortRows(mergeSourceRows(autoImageRows));
    const markedParams = sortRows(mergeMarkedParamRows(mergeSourceRows(paramRows)));
    const selectors = selectorRows || [];
    const fallbackParams = markedParams.length ? markedParams : sortRows(mergeSourceRows(autoParamRows));
    return {
        imageRows: markedImages.length ? markedImages : fallbackImages,
        paramRows: [...selectors, ...fallbackParams],
    };
}

function coerceParamValue(originalValue, nextValue, spec = null) {
    let value = nextValue;
    if (typeof originalValue === "number") {
        const n = Number(nextValue);
        if (!Number.isFinite(n)) value = originalValue;
        else value = Number.isInteger(originalValue) ? Math.round(n) : n;
    } else if (typeof originalValue === "boolean") {
        value = nextValue === true || String(nextValue) === "true";
    } else {
        value = nextValue == null ? "" : String(nextValue);
    }
    return normalizeComfyInputValue(value, spec);
}

function uploadedFileValue(uploaded) {
    const name = String(uploaded?.name || uploaded?.filename || "").trim();
    const subfolder = String(uploaded?.subfolder || "").trim();
    if (!name || !subfolder || name.includes("/")) return name;
    return `${subfolder}/${name}`;
}

function imageRowLabel(row, index) {
    return cleanText(row?.label || row?.description || row?.nodeName) || `图${index + 1}`;
}

function singleUploadedImageValue(uploadedByKey) {
    const values = new Set();
    for (const uploaded of Object.values(uploadedByKey || {})) {
        const value = uploadedFileValue(uploaded);
        if (value) values.add(value);
    }
    return values.size === 1 ? [...values][0] : "";
}

function fillUnmarkedImageInputs(prompt, imageRows, uploadedByKey, objectInfo) {
    const fallbackValue = singleUploadedImageValue(uploadedByKey);
    if (!fallbackValue) return prompt;
    const explicit = new Set();
    for (const row of imageRows || []) {
        for (const target of rowTargets(row)) explicit.add(`${target.nodeId}::${target.fieldName}`);
    }
    for (const [nodeId, node] of Object.entries(prompt || {})) {
        const inputs = objectOrNull(node?.inputs);
        if (!inputs) continue;
        if (isImageOutputNode(node)) continue;
        for (const [name, value] of Object.entries(inputs)) {
            if (explicit.has(`${nodeId}::${name}`) || Array.isArray(value)) continue;
            const specType = comfySpecType(objectInfoInputSpec(objectInfo, node.class_type, name));
            if (specType === "IMAGE" || specType === "IMAGEUPLOAD" || looksImageInput(node, name, value)) {
                inputs[name] = fallbackValue;
            }
        }
    }
    return prompt;
}

function isImageOutputNode(node) {
    const text = [node?.class_type, node?.type, ...nodeTitleCandidates(node)].map(cleanText).join(" ").toLowerCase();
    return /^(SaveImage|PreviewImage)$/i.test(cleanText(node?.class_type)) || /(save|preview|output|export|write).*image|image.*(save|preview|output|export|write)/i.test(text) || /((\u4fdd\u5b58|\u9884\u89c8|\u8f93\u51fa|\u5bfc\u51fa).*(\u56fe\u50cf|\u56fe\u7247|\u7167\u7247)|(\u56fe\u50cf|\u56fe\u7247|\u7167\u7247).*(\u4fdd\u5b58|\u9884\u89c8|\u8f93\u51fa|\u5bfc\u51fa))/i.test(text);
}

function collectPromptDependencies(prompt, nodeId, keep = new Set()) {
    const id = String(nodeId);
    if (keep.has(id) || !prompt?.[id]) return keep;
    keep.add(id);
    for (const value of Object.values(objectOrNull(prompt[id].inputs) || {})) {
        if (Array.isArray(value) && value[0] != null) collectPromptDependencies(prompt, value[0], keep);
    }
    return keep;
}

function keepImageOutputPrompt(prompt) {
    const targets = Object.entries(prompt || {}).filter(([, node]) => isImageOutputNode(node)).map(([id]) => id);
    if (targets.length === 0) return prompt;
    const keep = new Set();
    targets.forEach((id) => collectPromptDependencies(prompt, id, keep));
    return Object.fromEntries(Object.entries(prompt).filter(([id]) => keep.has(String(id))));
}

function isMissingPromptLink(value, prompt) {
    return Array.isArray(value) && value[0] != null && !prompt?.[String(value[0])];
}

function isDynamicSwitchInput(node, inputName) {
    return /switch/i.test(cleanText(node?.class_type)) && /^any_\d+$/i.test(cleanText(inputName));
}

function isDynamicSwitchNode(node) {
    return /switch/i.test(cleanText(node?.class_type));
}

function dropMissingOptionalLinks(prompt, objectInfo) {
    let changed = true;
    while (changed) {
        changed = false;
        for (const node of Object.values(prompt || {})) {
            const optional = objectOrNull(objectOrNull(objectOrNull(objectInfo)?.[node?.class_type])?.input)?.optional;
            const inputs = objectOrNull(node?.inputs);
            if (!inputs) continue;
            for (const name of Object.keys(inputs)) {
                if ((optional && Object.prototype.hasOwnProperty.call(optional, name)) || isDynamicSwitchInput(node, name)) {
                    if (isMissingPromptLink(inputs[name], prompt)) {
                        delete inputs[name];
                        changed = true;
                    }
                }
            }
        }
        for (const [id, node] of Object.entries(prompt || {})) {
            if (isDynamicSwitchNode(node) && Object.keys(objectOrNull(node?.inputs) || {}).length === 0) {
                delete prompt[id];
                changed = true;
            }
        }
    }
    return prompt;
}

function dropMissingLinks(prompt) {
    for (const node of Object.values(prompt || {})) {
        const inputs = objectOrNull(node?.inputs);
        if (!inputs) continue;
        for (const [name, value] of Object.entries(inputs)) {
            if (isMissingPromptLink(value, prompt)) delete inputs[name];
        }
    }
    return prompt;
}

function isSeedInputName(name) {
    return /seed/i.test(cleanText(name));
}

function randomSeedForSpec(spec) {
    const config = comfySpecConfig(spec);
    const min = Math.max(0, Math.floor(finiteNumber(config.min) ?? 0));
    const maxRaw = finiteNumber(config.max);
    const max = Math.max(min, Math.min(Math.floor(maxRaw ?? 2147483647), 2147483647));
    return min + Math.floor(Math.random() * (max - min + 1));
}

export function randomizeComfyPromptSeeds(basePrompt, objectInfo = null) {
    const prompt = deepClone(basePrompt);
    let count = 0;
    for (const node of Object.values(prompt || {})) {
        const inputs = objectOrNull(node?.inputs);
        if (!inputs) continue;
        for (const [name, value] of Object.entries(inputs)) {
            if (Array.isArray(value) || !isSeedInputName(name) || !Number.isFinite(Number(value))) continue;
            inputs[name] = randomSeedForSpec(objectInfoInputSpec(objectInfo, node.class_type, name));
            count += 1;
        }
    }
    return { prompt: normalizePromptInputs(prompt, objectInfo), count };
}

export function buildComfyPromptForRun(basePrompt, imageRows, paramRows, fieldValues, uploadedByKey, objectInfo = null) {
    const prompt = deepClone(basePrompt);
    for (const [index, row] of (imageRows || []).entries()) {
        const key = row?.key || comfyRowKey(row.nodeId, row.fieldName);
        const uploaded = uploadedByKey?.[key];
        const value = uploadedFileValue(uploaded);
        if (!value) throw new Error(`请先捕获图像：${imageRowLabel(row, index)}`);
        let applied = false;
        for (const target of rowTargets(row)) {
            if (!prompt?.[target.nodeId]?.inputs) continue;
            prompt[target.nodeId].inputs[target.fieldName] = value;
            applied = true;
        }
        if (!applied) throw new Error(`工作流图像输入不存在：${imageRowLabel(row, index)}`);
    }
    fillUnmarkedImageInputs(prompt, imageRows, uploadedByKey, objectInfo);
    for (const row of paramRows || []) {
        if (row?.comfyControl) continue;
        const key = row?.key || comfyRowKey(row.nodeId, row.fieldName);
        if (!Object.prototype.hasOwnProperty.call(fieldValues || {}, key)) continue;
        for (const target of rowTargets(row)) {
            const node = prompt?.[target.nodeId];
            if (!node?.inputs) continue;
            node.inputs[target.fieldName] = coerceParamValue(node.inputs[target.fieldName], fieldValues[key], objectInfoInputSpec(objectInfo, node.class_type, target.fieldName));
        }
    }
    return normalizePromptInputs(keepImageOutputPrompt(dropMissingOptionalLinks(prompt, objectInfo)), objectInfo);
}

export function initialComfyFieldValues(paramRows) {
    const values = {};
    for (const row of paramRows || []) values[row.key || comfyRowKey(row.nodeId, row.fieldName)] = row.fieldValue ?? "";
    return values;
}

export function firstComfyImageMissing(imageRows, pendingUploads) {
    if (!Array.isArray(imageRows) || imageRows.length === 0) return "";
    const seen = new Set();
    for (const [index, row] of imageRows.entries()) {
        const key = row?.key || comfyRowKey(row.nodeId, row.fieldName);
        if (seen.has(key)) continue;
        seen.add(key);
        const upload = pendingUploads?.[key];
        if (upload?.base64 || upload?.uploadSessionId) continue;
        return `请先捕获图像：${imageRowLabel(row, index)}`;
    }
    return "";
}

export function workflowOptionLabel(item) {
    if (!item) return "选择工作流";
    return item.name || item.path || item.id || "未命名工作流";
}
