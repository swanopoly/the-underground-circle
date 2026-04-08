import { TreeItem, TreeItemIndex } from 'react-complex-tree';

export interface RoomFileEntry {
  id: string;
  name: string;
  folder: string;
  file_type: string;
  size_bytes: number;
  is_deleted: boolean;
}

/**
 * Converts a flat list of room files into the nested tree structure
 * expected by react-complex-tree.
 *
 * The `folder` field on each file contains paths like `/`, `/src`, `/src/components`.
 * We build intermediate folder nodes for every unique path segment and wire
 * children so the tree renders a proper hierarchy.
 */
export function buildTreeData(files: RoomFileEntry[]): {
  items: Record<TreeItemIndex, TreeItem<RoomFileEntry>>;
  rootItem: TreeItemIndex;
} {
  const live = files.filter(f => !f.is_deleted);

  // ── Collect every unique folder path (including intermediate segments) ──
  const folderPaths = new Set<string>();
  folderPaths.add('/');

  for (const f of live) {
    const raw = f.folder || '/';
    folderPaths.add(raw);
    // Ensure parent folders also exist  (e.g. /src/components implies /src)
    const parts = raw.split('/').filter(Boolean);
    let running = '';
    for (const p of parts) {
      running += '/' + p;
      folderPaths.add(running);
    }
  }

  // ── Build items map ──
  const items: Record<TreeItemIndex, TreeItem<RoomFileEntry>> = {};

  // Create folder nodes — use `folder::<path>` as the tree index
  const folderIndex = (path: string) => `folder::${path}`;

  for (const fp of folderPaths) {
    const displayName = fp === '/' ? 'root' : fp.split('/').filter(Boolean).pop()!;
    items[folderIndex(fp)] = {
      index: folderIndex(fp),
      isFolder: true,
      canMove: false,
      canRename: false,
      children: [],
      data: {
        id: folderIndex(fp),
        name: displayName,
        folder: fp,
        file_type: 'folder',
        size_bytes: 0,
        is_deleted: false,
      },
    };
  }

  // Create file leaf nodes
  for (const f of live) {
    items[f.id] = {
      index: f.id,
      isFolder: false,
      canMove: false,
      canRename: false,
      data: f,
    };
  }

  // ── Wire children ──

  // Subfolders → parent folder
  for (const fp of folderPaths) {
    if (fp === '/') continue;
    const parts = fp.split('/').filter(Boolean);
    const parentPath = parts.length <= 1 ? '/' : '/' + parts.slice(0, -1).join('/');
    const parentNode = items[folderIndex(parentPath)];
    if (parentNode && parentNode.children) {
      parentNode.children.push(folderIndex(fp));
    }
  }

  // Files → their folder
  for (const f of live) {
    const fp = f.folder || '/';
    const parentNode = items[folderIndex(fp)];
    if (parentNode && parentNode.children) {
      parentNode.children.push(f.id);
    }
  }

  // ── Sort children: folders first (alphabetical), then files (alphabetical) ──
  for (const key of Object.keys(items)) {
    const node = items[key];
    if (node.children) {
      node.children.sort((a, b) => {
        const aItem = items[a];
        const bItem = items[b];
        if (!aItem || !bItem) return 0;
        const aFolder = !!aItem.isFolder;
        const bFolder = !!bItem.isFolder;
        if (aFolder !== bFolder) return aFolder ? -1 : 1;
        return aItem.data.name.localeCompare(bItem.data.name);
      });
    }
  }

  // Root
  items['root'] = {
    index: 'root',
    isFolder: true,
    canMove: false,
    canRename: false,
    children: items[folderIndex('/')]?.children ?? [],
    data: {
      id: 'root',
      name: 'root',
      folder: '/',
      file_type: 'folder',
      size_bytes: 0,
      is_deleted: false,
    },
  };

  return { items, rootItem: 'root' };
}
