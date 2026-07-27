"use client";

import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronsUpDown, Inbox } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
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
}: DataTableProps<TData>) {
  const [sorting, setSorting] = useState<SortingState>([]);

  const table = useReactTable({
    data: data ?? [],
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
      <div className="max-h-[calc(100vh-20rem)] overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} className="whitespace-nowrap text-xs">
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
                  {columns.map((_, colIndex) => (
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
                <TableCell colSpan={columns.length} className="h-56">
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

/** Clickable column header that cycles asc → desc → none. */
export function SortableHeader<TData>({
  column,
  children,
}: {
  column: {
    getIsSorted: () => false | "asc" | "desc";
    toggleSorting: (desc?: boolean) => void;
  };
  children: React.ReactNode;
} & { column: import("@tanstack/react-table").Column<TData, unknown> }) {
  const sorted = column.getIsSorted();
  return (
    <button
      onClick={() => column.toggleSorting(sorted === "asc")}
      className="inline-flex items-center gap-1 text-xs font-medium hover:text-foreground"
    >
      {children}
      {sorted === "asc" ? (
        <ArrowUp className="size-3" />
      ) : sorted === "desc" ? (
        <ArrowDown className="size-3" />
      ) : (
        <ChevronsUpDown className="size-3 opacity-40" />
      )}
    </button>
  );
}
