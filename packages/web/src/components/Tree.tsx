import { useEffect, useState } from 'react';
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

interface RowProps {
  node: TreeNode;
  depth: number;
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
  selectedId: string | null;
  onSelect: (node: TreeNode) => void;
  filter: string;
}

function TreeRow({ node, depth, expandedIds, onToggle, selectedId, onSelect, filter }: RowProps) {
  if (filter && !nodeMatches(node, filter)) return null;
  const children = node.children ?? [];
  const hasChildren = children.length > 0;
  const expanded = filter ? true : expandedIds.has(node.id);
  const selected = selectedId === node.id;

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
            selectedId={selectedId}
            onSelect={onSelect}
            filter={filter}
          />
        ))}
    </div>
  );
}

export function Tree({ nodes, selectedId, onSelect, filter = '' }: TreeProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const normalizedFilter = filter.trim().toLowerCase();

  // Auto-expand everything once data arrives so the tree starts open.
  useEffect(() => {
    setExpandedIds(collectIds(nodes, new Set()));
  }, [nodes]);

  const onToggle = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div role="tree" aria-label="Connectivity tree" className="py-1">
      {nodes.map((node) => (
        <TreeRow
          key={node.id}
          node={node}
          depth={0}
          expandedIds={expandedIds}
          onToggle={onToggle}
          selectedId={selectedId}
          onSelect={onSelect}
          filter={normalizedFilter}
        />
      ))}
    </div>
  );
}
