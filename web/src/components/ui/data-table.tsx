"use client";

import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type Column,
  type ColumnDef,
  type RowData,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronsUpDown, Inbox, Settings2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Human label used in the column-visibility dropdown. */
    label?: string;
  }
}

interface PaginationMeta {
  current_page: number;
  last_page: number;
  per_page: number;
  total: number;
}

interface DataTableProps<TData> {
  columns: ColumnDef<TData, unknown>[];
  data: TData[] | undefined;
  loading?: boolean;
  emptyTitle: string;
  emptyDescription?: string;
  meta?: PaginationMeta;
  onPageChange?: (page: number) => void;
  totalLabel?: (total: number) => string;
  onRowClick?: (row: TData) => void;
  /** Filter controls rendered as an integrated toolbar above the table header. */
  toolbar?: React.ReactNode;
  /**
   * Controlled sorting → the SERVER orders the whole result set; the table
   * only renders. Omit both props to keep the default per-page client sort.
   */
  sorting?: SortingState;
  onSortingChange?: (sorting: SortingState) => void;
}

export function DataTable<TData>({
  columns,
  data,
  loading,
  emptyTitle,
  emptyDescription,
  meta,
  onPageChange,
  totalLabel,
  onRowClick,
  toolbar,
  sorting: controlledSorting,
  onSortingChange,
}: DataTableProps<TData>) {
  const [internalSorting, setInternalSorting] = useState<SortingState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});

  const manual = onSortingChange !== undefined;
  const sorting = manual ? (controlledSorting ?? []) : internalSorting;

  const table = useReactTable({
    data: data ?? [],
    columns,
    state: { sorting, columnVisibility },
    manualSorting: manual,
    onSortingChange: (updater) => {
      const next = typeof updater === "function" ? updater(sorting) : updater;
      if (manual) onSortingChange(next);
      else setInternalSorting(next);
    },
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const visibleColumnCount = table.getVisibleLeafColumns().length;
  const hideableColumns = table
    .getAllLeafColumns()
    .filter((column) => column.getCanHide() && column.columnDef.meta?.label);

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
      <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-3 py-2.5">
        {toolbar}
        {hideableColumns.length > 0 && (
          <div className="ms-auto">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 text-[13px] text-muted-foreground"
                >
                  <Settings2 className="size-3.5" />
                  الأعمدة
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuLabel className="text-xs">إظهار الأعمدة</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {hideableColumns.map((column) => (
                  <DropdownMenuCheckboxItem
                    key={column.id}
                    checked={column.getIsVisible()}
                    onCheckedChange={(checked) => column.toggleVisibility(!!checked)}
                    onSelect={(event) => event.preventDefault()}
                  >
                    {column.columnDef.meta?.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      <div className="max-h-[calc(100vh-20rem)] overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {loading &&
              Array.from({ length: 8 }).map((_, rowIndex) => (
                <TableRow key={`skeleton-${rowIndex}`} className="hover:bg-transparent">
                  {Array.from({ length: visibleColumnCount }).map((_, colIndex) => (
                    <TableCell key={colIndex} className="py-3">
                      <Skeleton
                        className="h-4"
                        style={{ width: `${55 + ((rowIndex * 17 + colIndex * 29) % 40)}%` }}
                      />
                    </TableCell>
                  ))}
                </TableRow>
              ))}

            {!loading && table.getRowModel().rows.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={visibleColumnCount} className="h-56">
                  <div className="flex flex-col items-center justify-center gap-2 text-center">
                    <div className="flex size-12 items-center justify-center rounded-full bg-muted">
                      <Inbox className="size-6 text-muted-foreground" />
                    </div>
                    <p className="text-sm font-medium text-foreground">{emptyTitle}</p>
                    {emptyDescription && (
                      <p className="max-w-sm text-xs text-muted-foreground">{emptyDescription}</p>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            )}

            {!loading &&
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  className={cn(onRowClick && "cursor-pointer")}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="py-3">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </div>

      {meta && meta.last_page > 1 && (
        <div className="flex items-center justify-between border-t px-4 py-3">
          <p className="text-xs text-muted-foreground">
            {totalLabel ? totalLabel(meta.total) : `${meta.total} سجل`} — صفحة{" "}
            {meta.current_page} من {meta.last_page}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={meta.current_page <= 1}
              onClick={() => onPageChange?.(meta.current_page - 1)}
            >
              السابق
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={meta.current_page >= meta.last_page}
              onClick={() => onPageChange?.(meta.current_page + 1)}
            >
              التالي
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Clickable column header that cycles asc → desc. */
export function SortableHeader<TData, TValue>({
  column,
  children,
}: {
  column: Column<TData, TValue>;
  children: React.ReactNode;
}) {
  const sorted = column.getIsSorted();
  return (
    <button
      type="button"
      onClick={() => column.toggleSorting(sorted === "asc")}
      className={cn(
        "-ms-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium transition-colors hover:bg-accent hover:text-foreground",
        sorted && "text-foreground",
      )}
    >
      {children}
      {sorted === "asc" ? (
        <ArrowUp className="size-3 text-primary" />
      ) : sorted === "desc" ? (
        <ArrowDown className="size-3 text-primary" />
      ) : (
        <ChevronsUpDown className="size-3 opacity-40" />
      )}
    </button>
  );
}
