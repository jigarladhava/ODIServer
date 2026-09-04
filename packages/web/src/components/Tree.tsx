import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChannelIcon,
  ConnectivityIcon,
  DeviceIcon,
  EventLogIcon,
  GroupIcon,
} from './icons';

export type NodeType = 'connectivity' | 'channel' | 'device' | 'group' | 'eventlog';

export interface TreeNode {
  id: string;
  label: string;
  type: NodeType;
  children?: TreeNode[];
}

interface TreeProps {
  nodes: TreeNode[];
  selectedId: string | null;
  onSelect: (node: TreeNode) => void;
  filter?: string;
}

const focusRing =
  'focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent';

function NodeIcon({ type }: { type: NodeType }) {
  switch (type) {
    case 'connectivity':
      return <ConnectivityIcon />;
    case 'channel':
      return <ChannelIcon />;
    case 'device':
      return <DeviceIcon />;
    case 'group':
      return <GroupIcon />;
    case 'eventlog':
      return <EventLogIcon />;
  }
}

function nodeMatches(node: TreeNode, filter: string): boolean {
  if (node.label.toLowerCase().includes(filter)) return true;
  return (node.children ?? []).some((child) => nodeMatches(child, filter));
}

function collectIds(nodes: TreeNode[], into: Set<string>): Set<string> {
  for (const node of nodes) {
    into.add(node.id);
    if (node.children) collectIds(node.children, into);
  }
  return into;
}

/** Ids of the selected node and all its ancestors — the only rows a selection change can affect. */
function findSelectedPath(nodes: TreeNode[], selectedId: string | null): Set<string> {
  const path = new Set<string>();
  if (!selectedId) return path;
  const walk = (list: TreeNode[], trail: string[]): boolean => {
    for (const node of list) {
      if (node.id === selectedId) {
        for (const id of trail) path.add(id);
        path.add(node.id);
        return true;
      }
      if (node.children && walk(node.children, [...trail, node.id])) {
        path.add(node.id);
        return true;
      }
    }
    return false;
  };
  walk(nodes, []);
  return path;
}

interface RowProps {
  node: TreeNode;
  depth: number;
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
  selected: boolean;
  selectedId: string | null;
  /** Ids on the selected node's ancestor path (incl. itself) — rows off the path skip re-renders. */
  selectedPath: Set<string>;
  onSelect: (node: TreeNode) => void;
  filter: string;
}

function rowPropsEqual(prev: RowProps, next: RowProps): boolean {
  if (
    prev.node !== next.node ||
    prev.depth !== next.depth ||
    prev.expandedIds !== next.expandedIds ||
    prev.onToggle !== next.onToggle ||
    prev.onSelect !== next.onSelect ||
    prev.selected !== next.selected ||
    prev.filter !== next.filter
  ) {
    return false;
  }
  // Rows on the selected path re-render when the path changes (children's
  // selection state may change deeper down); rows off the path are unaffected.
  const prevOnPath = prev.selectedPath.has(prev.node.id);
  const nextOnPath = next.selectedPath.has(next.node.id);
  if (prevOnPath !== nextOnPath) return false;
  if (!prevOnPath && !nextOnPath) return true;
  return prev.selectedPath === next.selectedPath;
}

const TreeRow = memo(function TreeRow({
  node,
  depth,
  expandedIds,
  onToggle,
  selected,
  selectedId,
  selectedPath,
  onSelect,
  filter,
}: RowProps) {
  if (filter && !nodeMatches(node, filter)) return null;
  const children = node.children ?? [];
  const hasChildren = children.length > 0;
  const expanded = filter ? true : expandedIds.has(node.id);

  return (
    <div role="treeitem" aria-expanded={hasChildren ? expanded : undefined} aria-selected={selected}>
      <div
        className={`flex h-6 items-center gap-0.5 pr-2 ${selected ? 'bg-selected' : 'hover:bg-hover'}`}
        style={{ paddingLeft: depth * 14 + 4 }}
      >
        <button
          type="button"
          tabIndex={-1}
          aria-label={
            hasChildren ? (expanded ? `Collapse ${node.label}` : `Expand ${node.label}`) : undefined
          }
          aria-hidden={!hasChildren}
          onClick={() => hasChildren && onToggle(node.id)}
          className={`flex h-4 w-4 items-center justify-center text-muted ${hasChildren ? '' : 'invisible'} ${focusRing}`}
        >
          <svg
            className={`h-2.5 w-2.5 ${expanded ? 'rotate-90' : ''}`}
            viewBox="0 0 16 16"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M5 3l6 5-6 5V3z" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => onSelect(node)}
          className={`flex min-w-0 flex-1 items-center gap-1.5 text-left text-[12px] ${focusRing}`}
        >
          <span className={selected ? 'text-accent' : 'text-muted'}>
            <NodeIcon type={node.type} />
          </span>
          <span translate="no" className="truncate">
            {node.label}
          </span>
        </button>
      </div>
      {expanded &&
        children.map((child) => (
          <TreeRow
            key={child.id}
            node={child}
            depth={depth + 1}
            expandedIds={expandedIds}
            onToggle={onToggle}
            selected={selectedId === child.id}
            selectedId={selectedId}
            selectedPath={selectedPath}
            onSelect={onSelect}
            filter={filter}
          />
        ))}
    </div>
  );
}, rowPropsEqual);

export function Tree({ nodes, selectedId, onSelect, filter = '' }: TreeProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const normalizedFilter = filter.trim().toLowerCase();
  const selectedPath = useMemo(() => findSelectedPath(nodes, selectedId), [nodes, selectedId]);

  // react-router's setSearchParams changes identity per navigation, which would
  // defeat the TreeRow memo via the onSelect prop — dispatch through a ref so
  // rows always call the latest handler with a stable prop identity.
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  });
  const onSelectStable = useCallback((node: TreeNode) => onSelectRef.current(node), []);

  // Auto-expand everything once data arrives so the tree starts open.
  useEffect(() => {
    setExpandedIds(collectIds(nodes, new Set()));
  }, [nodes]);

  const onToggle = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return (
    <div role="tree" aria-label="Connectivity tree" className="py-1">
      {nodes.map((node) => (
        <TreeRow
          key={node.id}
          node={node}
          depth={0}
          expandedIds={expandedIds}
          onToggle={onToggle}
          selected={selectedId === node.id}
          selectedId={selectedId}
          selectedPath={selectedPath}
          onSelect={onSelectStable}
          filter={normalizedFilter}
        />
      ))}
    </div>
  );
}
