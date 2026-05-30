/**
 * treeUtils.js — pure helpers for the Parts View tree.
 *
 * The API returns a nested tree (product → capability → feature …). For
 * virtualization we flatten the *currently-visible* nodes into a single ordered
 * array, carrying the metadata each row needs to draw itself: depth, sibling
 * magnitude reference, last-child flag, and the ancestor "guide line" pattern that
 * makes parentage traceable past two levels.
 */

export const INDENT = 22; // px per depth level (deliberate rhythm, not a default gap)

// Estimated row heights feed TanStack Virtual; actual heights are measured for the
// ticket drilldown rows (which vary), but parts rows are stable per depth.
export const ROW_HEIGHT = { product: 48, capability: 40, feature: 34, unknown: 40, tickets: 320 };
export const rowHeightFor = (row) =>
  row.kind === "tickets" ? ROW_HEIGHT.tickets : ROW_HEIGHT[row.node.type] || ROW_HEIGHT.feature;

/** Recursively filter the tree by a query (matches node name OR display_id). */
export const filterTree = (nodes, q) => {
  if (!q) return nodes;
  const out = [];
  for (const node of nodes) {
    const selfMatch =
      (node.name || "").toLowerCase().includes(q) ||
      (node.display_id || "").toLowerCase().includes(q);
    const kids = filterTree(node.children || [], q);
    if (selfMatch || kids.length) out.push({ ...node, children: kids });
  }
  return out;
};

/** Root (product) ids — used by "Expand all" which stops at the capability level. */
export const collectRootIds = (roots) => roots.map((r) => r.id);

/** Depth-first lookup of a node by id. */
export const findNode = (nodes, id) => {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children?.length) {
      const hit = findNode(n.children, id);
      if (hit) return hit;
    }
  }
  return null;
};

/** Path of nodes from a root down to `id` (inclusive), or [] if not found. */
export const findPath = (nodes, id, trail = []) => {
  for (const n of nodes) {
    const next = [...trail, n];
    if (n.id === id) return next;
    if (n.children?.length) {
      const hit = findPath(n.children, id, next);
      if (hit.length) return hit;
    }
  }
  return [];
};

/** Every node id in the tree (used to auto-expand a search result set). */
export const collectAllIds = (nodes, acc = []) => {
  for (const n of nodes) {
    acc.push(n.id);
    if (n.children?.length) collectAllIds(n.children, acc);
  }
  return acc;
};

/**
 * Flatten the visible tree into ordered rows.
 *
 * @param {Array} roots          top-level nodes (already scoped/filtered/sorted).
 * @param {Set<string>} expanded set of expanded node ids.
 * @returns {Array} rows: { key, kind, node, depth, isLast, hasChildren, expanded,
 *                          siblingMax, guides:boolean[] }
 *   guides[i] === true  → an ancestor at level i has a following sibling, so a
 *                         continuing vertical line should be drawn in that column.
 */
export const flattenTree = (roots, expanded) => {
  const rows = [];
  const walk = (nodes, depth, parentGuides) => {
    const siblingMax = Math.max(1, ...nodes.map((n) => n.count || 0));
    nodes.forEach((node, i) => {
      const isLast = i === nodes.length - 1;
      const hasChildren = (node.children || []).length > 0;
      const isOpen = expanded.has(node.id);
      rows.push({
        key: node.id,
        kind: "part",
        node,
        depth,
        isLast,
        hasChildren,
        expanded: isOpen,
        siblingMax,
        guides: parentGuides,
      });
      if (isOpen) {
        if (hasChildren) {
          walk(node.children, depth + 1, [...parentGuides, !isLast]);
        } else if (node.count > 0) {
          // Leaf → inline ticket sub-table row.
          rows.push({
            key: `${node.id}::tickets`,
            kind: "tickets",
            node,
            depth: depth + 1,
            isLast: true,
            hasChildren: false,
            expanded: true,
            siblingMax: 1,
            guides: [...parentGuides, !isLast],
          });
        }
      }
    });
  };
  walk(roots, 0, []);
  return rows;
};
