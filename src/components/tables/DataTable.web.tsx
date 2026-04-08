/**
 * DataTable — A reusable dark-themed data table powered by @tanstack/react-table.
 *
 * Features: sorting (click headers), global search filter, pagination,
 * alternating row colors, selected row highlight. Web-only component.
 */
import React, { useState, useMemo } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Platform, ScrollView } from 'react-native';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';

// Re-export ColumnDef so consumers don't need a separate import
export type { ColumnDef } from '@tanstack/react-table';

interface DataTableProps<T> {
  data: T[];
  columns: ColumnDef<T, any>[];
  /** Rows per page. Defaults to 20 */
  pageSize?: number;
  /** Show a global search input above the table. Defaults to false */
  searchable?: boolean;
  /** Accent color for selected row highlight. Defaults to #6366f1 */
  accentColor?: string;
}

export function DataTable<T>({
  data,
  columns,
  pageSize = 20,
  searchable = false,
  accentColor = '#6366f1',
}: DataTableProps<T>) {
  // Web-only guard
  if (Platform.OS !== 'web') return null;

  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState('');
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter, pagination: { pageIndex: 0, pageSize } },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  const pageCount = table.getPageCount();
  const currentPage = table.getState().pagination.pageIndex;

  return (
    <View style={styles.wrapper}>
      {/* Optional global search */}
      {searchable && (
        <View style={styles.searchRow}>
          <Text style={styles.searchIcon}>/</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search..."
            placeholderTextColor="#444"
            value={globalFilter}
            onChangeText={setGlobalFilter}
            maxLength={100}
          />
          {globalFilter ? (
            <Pressable onPress={() => setGlobalFilter('')} style={styles.clearBtn}>
              <Text style={styles.clearBtnText}>Clear</Text>
            </Pressable>
          ) : null}
        </View>
      )}

      {/* Table */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          {/* Header */}
          <View style={styles.headerRow}>
            {table.getHeaderGroups().map(headerGroup =>
              headerGroup.headers.map(header => (
                <Pressable
                  key={header.id}
                  onPress={header.column.getToggleSortingHandler()}
                  style={[styles.headerCell, { width: header.getSize() }]}
                >
                  <Text style={styles.headerText}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                    {header.column.getIsSorted() === 'asc'
                      ? ' \u25B2'
                      : header.column.getIsSorted() === 'desc'
                        ? ' \u25BC'
                        : ''}
                  </Text>
                </Pressable>
              )),
            )}
          </View>

          {/* Body */}
          {table.getRowModel().rows.map((row, idx) => {
            const isSelected = selectedRowId === row.id;
            const bgColor = isSelected
              ? accentColor + '20'
              : idx % 2 === 0
                ? '#0a0a10'
                : '#0f0f18';

            return (
              <Pressable
                key={row.id}
                onPress={() => setSelectedRowId(isSelected ? null : row.id)}
                style={[
                  styles.bodyRow,
                  { backgroundColor: bgColor },
                  isSelected && { borderLeftColor: accentColor, borderLeftWidth: 3 },
                ]}
              >
                {row.getVisibleCells().map(cell => (
                  <View key={cell.id} style={[styles.bodyCell, { width: cell.column.getSize() }]}>
                    <Text style={styles.bodyText} numberOfLines={2}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </Text>
                  </View>
                ))}
              </Pressable>
            );
          })}

          {/* Empty state */}
          {table.getRowModel().rows.length === 0 && (
            <View style={styles.emptyRow}>
              <Text style={styles.emptyText}>No data</Text>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Pagination */}
      {pageCount > 1 && (
        <View style={styles.paginationRow}>
          <Pressable
            onPress={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            style={[styles.pageBtn, !table.getCanPreviousPage() && styles.pageBtnDisabled]}
          >
            <Text style={styles.pageBtnText}>&laquo; Prev</Text>
          </Pressable>

          <Text style={styles.pageInfo}>
            {currentPage + 1} / {pageCount}
          </Text>

          <Pressable
            onPress={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            style={[styles.pageBtn, !table.getCanNextPage() && styles.pageBtnDisabled]}
          >
            <Text style={styles.pageBtnText}>Next &raquo;</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: '#0a0a10',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#1a1a28',
    overflow: 'hidden',
  },
  // Search
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a28',
    backgroundColor: '#0d0d16',
  },
  searchIcon: {
    fontFamily: 'monospace',
    fontSize: 14,
    color: '#555',
    marginRight: 6,
  },
  searchInput: {
    flex: 1,
    fontFamily: 'monospace',
    fontSize: 13,
    color: '#f0f0f5',
    paddingVertical: 4,
    // @ts-ignore
    outlineStyle: 'none',
  },
  clearBtn: {
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  clearBtnText: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: '#888',
  },
  // Header
  headerRow: {
    flexDirection: 'row',
    backgroundColor: '#0d0d16',
    borderBottomWidth: 2,
    borderBottomColor: '#1a1a28',
    // @ts-ignore — sticky on web
    position: 'sticky',
    top: 0,
    zIndex: 10,
  },
  headerCell: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    minWidth: 100,
  },
  headerText: {
    fontFamily: 'monospace',
    fontSize: 11,
    fontWeight: '700',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  // Body
  bodyRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a28',
  },
  bodyCell: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 100,
    justifyContent: 'center',
  },
  bodyText: {
    fontFamily: 'monospace',
    fontSize: 12,
    color: '#f0f0f5',
  },
  // Empty
  emptyRow: {
    padding: 24,
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: 'monospace',
    fontSize: 12,
    color: '#555',
  },
  // Pagination
  paginationRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#1a1a28',
    gap: 12,
  },
  pageBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#2a2a3e',
    backgroundColor: '#111118',
  },
  pageBtnDisabled: {
    opacity: 0.35,
  },
  pageBtnText: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: '#f0f0f5',
  },
  pageInfo: {
    fontFamily: 'monospace',
    fontSize: 12,
    color: '#888',
  },
});
