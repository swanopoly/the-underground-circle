import React, { useMemo, useRef, useEffect } from 'react';
import { View, Text, Platform } from 'react-native';
import {
  UncontrolledTreeEnvironment,
  Tree,
  StaticTreeDataProvider,
  InteractionMode,
} from 'react-complex-tree';
import { buildTreeData, RoomFileEntry } from './roomTreeAdapter';
import type { TreeItem, TreeItemRenderContext, TreeInformation } from 'react-complex-tree';

// ── File-extension icon map (monospace text badges) ──────────────────────────
const EXT_ICON: Record<string, string> = {
  ts: 'TS', tsx: 'TS', typescript: 'TS',
  js: 'JS', jsx: 'JS', javascript: 'JS',
  css: '#',  scss: '#',
  json: '{}',
  md: 'D', mdx: 'D', markdown: 'D',
  py: 'PY', python: 'PY',
  rs: 'RS', rust: 'RS',
  go: 'GO',
  html: '<>', htm: '<>',
  sql: 'SQ',
  bash: '>_', sh: '>_',
  yaml: 'YM', yml: 'YM',
  csv: 'CV',
  image: 'IM',
  canvas: 'CN',
};

function fileIcon(fileType: string): string {
  return EXT_ICON[fileType] ?? 'F';
}

// ── Props ────────────────────────────────────────────────────────────────────
interface RoomFileTreeProps {
  files: RoomFileEntry[];
  selectedFileId?: string;
  onSelectFile: (fileId: string) => void;
  accentColor: string;
}

// ── Component ────────────────────────────────────────────────────────────────
export default function RoomFileTree({ files, selectedFileId, onSelectFile, accentColor }: RoomFileTreeProps) {
  // Guard: web only
  if (Platform.OS !== 'web') return null;

  const { items, rootItem } = useMemo(() => buildTreeData(files), [files]);

  // StaticTreeDataProvider needs to be recreated when items change.
  // We use a ref + key trick to force re-mount.
  const versionRef = useRef(0);
  useEffect(() => { versionRef.current += 1; }, [files]);

  const dataProvider = useMemo(
    () => new StaticTreeDataProvider(items),
    [items],
  );

  return (
    <div
      style={{
        flex: 1,
        overflow: 'auto',
        fontSize: 13,
        fontFamily: 'monospace',
        // Override react-complex-tree CSS variables for our dark theme
        // @ts-ignore CSS custom properties
        '--rct-color-tree-bg': 'transparent',
        '--rct-color-tree-focus-outline': accentColor,
        '--rct-color-focustree-item-selected-bg': accentColor + '30',
        '--rct-color-focustree-item-focused-border': accentColor,
        '--rct-color-focustree-item-draggingover-bg': accentColor + '20',
        '--rct-color-focustree-item-draggingover-color': '#e8e8e8',
        '--rct-color-nonfocustree-item-selected-bg': accentColor + '18',
        '--rct-color-nonfocustree-item-focused-border': accentColor + '60',
        '--rct-color-search-highlight-bg': accentColor + '40',
        '--rct-color-drag-between-line-bg': accentColor,
        '--rct-color-arrow': '#888',
        '--rct-item-height': '28px',
      } as any}
    >
      <UncontrolledTreeEnvironment<RoomFileEntry>
        key={versionRef.current}
        dataProvider={dataProvider}
        getItemTitle={(item) => item.data.name}
        viewState={{
          'room-tree': {
            selectedItems: selectedFileId ? [selectedFileId] : [],
          },
        }}
        canDragAndDrop={false}
        canSearch={true}
        canRename={false}
        canSearchByStartingTyping={true}
        defaultInteractionMode={InteractionMode.ClickItemToExpand}
        onSelectItems={(itemIds) => {
          const first = itemIds[0];
          if (!first) return;
          const item = items[first];
          if (item && !item.isFolder) {
            onSelectFile(item.data.id);
          }
        }}
        onPrimaryAction={(item) => {
          if (!item.isFolder) {
            onSelectFile(item.data.id);
          }
        }}
        renderItemTitle={({ title, item }) => (
          <span
            style={{
              color: item.isFolder ? '#ccc' : '#e8e8e8',
              fontFamily: 'monospace',
              fontSize: 12,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {title}
          </span>
        )}
        renderItemArrow={({ item, context }) => {
          if (!item.isFolder) {
            // File icon badge
            const badge = fileIcon(item.data.file_type);
            return (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 20,
                  height: 16,
                  fontFamily: 'monospace',
                  fontSize: 9,
                  fontWeight: 700,
                  color: '#aaa',
                  marginRight: 2,
                  opacity: 0.7,
                }}
              >
                {badge}
              </span>
            );
          }
          return (
            <span
              {...context.arrowProps}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 20,
                height: 16,
                fontFamily: 'monospace',
                fontSize: 10,
                color: '#888',
                cursor: 'pointer',
                userSelect: 'none',
                marginRight: 2,
              }}
            >
              {context.isExpanded ? 'v' : '>'}
            </span>
          );
        }}
        renderItem={({ item, depth, children, title, arrow, context }) => {
          const isSelected = !!context.isSelected;
          const isFocused = !!context.isFocused;
          return (
            <li
              {...context.itemContainerWithChildrenProps}
              style={{ listStyle: 'none', padding: 0, margin: 0 }}
            >
              <div
                {...context.interactiveElementProps}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  height: 26,
                  paddingLeft: depth * 16 + 4,
                  paddingRight: 8,
                  cursor: 'pointer',
                  backgroundColor: isSelected
                    ? accentColor + '25'
                    : 'transparent',
                  borderLeft: isFocused
                    ? `2px solid ${accentColor}`
                    : '2px solid transparent',
                  transition: 'background-color 0.1s',
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) {
                    (e.currentTarget as HTMLElement).style.backgroundColor = '#ffffff08';
                  }
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.backgroundColor = isSelected
                    ? accentColor + '25'
                    : 'transparent';
                }}
              >
                {arrow}
                {title}
              </div>
              {children}
            </li>
          );
        }}
        renderTreeContainer={({ children, containerProps }) => (
          <div
            {...containerProps}
            style={{
              background: 'transparent',
              padding: 0,
              outline: 'none',
            }}
          >
            {children}
          </div>
        )}
        renderItemsContainer={({ children, containerProps, depth }) => (
          <ul
            {...containerProps}
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
            }}
          >
            {children}
          </ul>
        )}
        renderSearchInput={({ inputProps }) => (
          <div style={{ padding: '4px 6px', borderBottom: '1px solid #1a1a2e' }}>
            <input
              {...inputProps}
              style={{
                width: '100%',
                background: '#0a0a0f',
                border: '1px solid #2a2a3e',
                borderRadius: 2,
                color: '#e8e8e8',
                fontFamily: 'monospace',
                fontSize: 12,
                padding: '3px 6px',
                outline: 'none',
                boxSizing: 'border-box',
              }}
              placeholder="Search files..."
            />
          </div>
        )}
      >
        <Tree treeId="room-tree" rootItem={rootItem as string} treeLabel="Room Files" />
      </UncontrolledTreeEnvironment>
    </div>
  );
}
