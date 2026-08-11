import { useState } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
} from '@tanstack/react-table';

interface DataGridProps<TData> {
  data: TData[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns: ColumnDef<TData, any>[];
  getRowId?: (row: TData) => string;
  selectedRowId?: string | null;
  onRowSelect?: (row: TData) => void;
  emptyMessage?: string;
  pageSize?: number;
  ariaLabel?: string;
}

const focusRing =
  'focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent';

export function DataGrid<TData>({
  data,
  columns,
  getRowId,
  selectedRowId,
  onRowSelect,
  emptyMessage = 'No rows to display.',
  pageSize = 10,
  ariaLabel,
}: DataGridProps<TData>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnFilters },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getRowId,
    initialState: { pagination: { pageSize } },
    autoResetPageIndex: false,
  });

  const rows = table.getRowModel().rows;
  const { pageIndex } = table.getState().pagination;

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        <table aria-label={ariaLabel} className="w-full border-collapse text-[12px]">
          <thead className="sticky top-0 z-10">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} className="bg-panel">
                {headerGroup.headers.map((header) => {
                  const sorted = header.column.getIsSorted();
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      className="border-b border-r border-border px-0 py-0 text-left font-medium last:border-r-0"
                    >
                      {header.column.getCanSort() ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className={`flex w-full items-center gap-1 px-2 py-1 hover:bg-hover ${focusRing}`}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          <span aria-hidden="true" className="text-muted">
                            {sorted === 'asc' ? '▲' : sorted === 'desc' ? '▼' : ''}
                          </span>
                          {sorted && (
                            <span className="sr-only">
                              {sorted === 'asc' ? 'sorted ascending' : 'sorted descending'}
                            </span>
                          )}
                        </button>
                      ) : (
                        <span className="block px-2 py-1">
                          {flexRender(header.column.columnDef.header, header.getContext())}
                        </span>
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
            <tr className="bg-panel">
              {table.getHeaderGroups()[0]?.headers.map((header) => (
                <th
                  key={`filter-${header.id}`}
                  className="border-b border-r border-border px-1 py-0.5 font-normal last:border-r-0"
                >
                  {header.column.getCanFilter() ? (
                    <input
                      type="text"
                      aria-label={`Filter ${String(header.column.columnDef.header)}`}
                      placeholder="Filter…"
                      autoComplete="off"
                      spellCheck={false}
                      value={(header.column.getFilterValue() as string) ?? ''}
                      onChange={(e) => header.column.setFilterValue(e.target.value)}
                      className={`h-5 w-full min-w-12 rounded-sm border border-border bg-inset px-1 text-[11px] text-fg placeholder:text-muted ${focusRing}`}
                    />
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="border-b border-border px-2 py-4 text-center text-muted"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const selected = selectedRowId !== undefined && row.id === selectedRowId;
                return (
                  <tr
                    key={row.id}
                    tabIndex={onRowSelect ? 0 : undefined}
                    onClick={onRowSelect ? () => onRowSelect(row.original) : undefined}
                    onKeyDown={
                      onRowSelect
                        ? (e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              onRowSelect(row.original);
                            }
                          }
                        : undefined
                    }
                    className={`${selected ? 'bg-selected' : 'bg-inset hover:bg-hover'} ${
                      onRowSelect ? `cursor-pointer ${focusRing}` : ''
                    }`}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td
                        key={cell.id}
                        className="max-w-64 truncate border-b border-border px-2 py-1"
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <div className="flex h-7 items-center gap-2 border-t border-border bg-panel px-2 text-[11px] text-muted">
        <span className="tabular-nums">
          {table.getFilteredRowModel().rows.length} row
          {table.getFilteredRowModel().rows.length === 1 ? '' : 's'}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            aria-label="Previous page"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            className={`flex h-5 w-5 items-center justify-center rounded-sm enabled:hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40 ${focusRing}`}
          >
            ‹
          </button>
          <span className="tabular-nums">
            Page {rows.length === 0 ? 0 : pageIndex + 1} of {table.getPageCount()}
          </span>
          <button
            type="button"
            aria-label="Next page"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            className={`flex h-5 w-5 items-center justify-center rounded-sm enabled:hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40 ${focusRing}`}
          >
            ›
          </button>
        </div>
      </div>
    </div>
  );
}
