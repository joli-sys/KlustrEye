"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type RowSelectionState,
  type FilterFn,
} from "@tanstack/react-table";
import { useSearchParams, usePathname, useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowUpDown, MoreHorizontal, Trash2, Edit, Terminal, FileText, Star } from "lucide-react";
import { formatAge, cn } from "@/lib/utils";
import { useSavedSearches } from "@/lib/stores/saved-searches-store";
import { useTabStore } from "@/lib/stores/tab-store";
import Link from "next/link";

const globalFilterFn: FilterFn<Record<string, unknown>> = (row, _columnId, filterValue) => {
  const query = String(filterValue).toLowerCase();
  if (!query) return true;

  // Match visible column text
  for (const cell of row.getVisibleCells()) {
    const value = cell.getValue();
    if (value != null && String(value).toLowerCase().includes(query)) {
      return true;
    }
  }

  // Match labels
  const metadata = row.original.metadata as Record<string, unknown> | undefined;
  if (metadata) {
    const labels = metadata.labels as Record<string, string> | undefined;
    if (labels) {
      for (const [k, v] of Object.entries(labels)) {
        if (k.toLowerCase().includes(query) || String(v).toLowerCase().includes(query)) {
          return true;
        }
      }
    }
    // Match annotations
    const annotations = metadata.annotations as Record<string, string> | undefined;
    if (annotations) {
      for (const [k, v] of Object.entries(annotations)) {
        if (k.toLowerCase().includes(query) || String(v).toLowerCase().includes(query)) {
          return true;
        }
      }
    }
  }

  return false;
};

interface ResourceTableProps {
  data: Record<string, unknown>[];
  isLoading: boolean;
  columns: ColumnDef<Record<string, unknown>>[];
  onEdit?: (item: Record<string, unknown>) => void;
  onDelete?: (item: Record<string, unknown>) => void;
  onTerminal?: (item: Record<string, unknown>) => void;
  onLogs?: (item: Record<string, unknown>) => void;
  onBatchDelete?: (items: Record<string, unknown>[]) => void;
  detailLinkFn?: (item: Record<string, unknown>) => string;
  kind: string;
  currentNamespace?: string;
  resourceKind?: string;
}

export function ResourceTable({
  data,
  isLoading,
  columns,
  onEdit,
  onDelete,
  onTerminal,
  onLogs,
  onBatchDelete,
  detailLinkFn,
  kind,
  currentNamespace,
  resourceKind,
}: ResourceTableProps) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const { openTab } = useTabStore();

  // Derive cluster context from pathname: /clusters/<contextName>/...
  const contextName = (() => {
    const parts = pathname.split("/");
    const idx = parts.indexOf("clusters");
    return idx !== -1 && parts[idx + 1] ? decodeURIComponent(parts[idx + 1]) : "";
  })();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState(() => searchParams.get("filter") || "");
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const filterInputRef = useRef<HTMLInputElement>(null);
  const { searches, addSearch, removeSearch } = useSavedSearches();

  const handleFilterChange = useCallback(
    (value: string) => {
      setGlobalFilter(value);
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set("filter", value);
      } else {
        params.delete("filter");
      }
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const savedMatch = useMemo(() => {
    if (!globalFilter || !resourceKind) return null;
    const ns = currentNamespace === "__all__" ? undefined : currentNamespace;
    return searches.find(
      (s) => s.kind === resourceKind && s.query === globalFilter && s.namespace === ns
    ) ?? null;
  }, [searches, globalFilter, resourceKind, currentNamespace]);

  const toggleFavorite = () => {
    if (!resourceKind || !globalFilter) return;
    const ns = currentNamespace === "__all__" ? undefined : currentNamespace;
    if (savedMatch) {
      removeSearch(savedMatch.id);
    } else {
      const name = ns
        ? `${kind} - ${globalFilter} - ${ns}`
        : `${kind} - ${globalFilter}`;
      addSearch({
        id: crypto.randomUUID(),
        name,
        kind: resourceKind,
        query: globalFilter,
        namespace: ns,
      });
    }
  };

  useEffect(() => {
    function handleFocusFilter() {
      filterInputRef.current?.focus();
    }
    window.addEventListener("focus-table-filter", handleFocusFilter);
    return () => window.removeEventListener("focus-table-filter", handleFocusFilter);
  }, []);

  const allColumns = useMemo(() => {
    const hasActions = onEdit || onDelete || onTerminal || onLogs;

    const selectColumn: ColumnDef<Record<string, unknown>> = {
      id: "select",
      header: ({ table }) => (
        <Checkbox
          checked={table.getIsAllPageRowsSelected()}
          indeterminate={table.getIsSomePageRowsSelected()}
          onChange={table.getToggleAllPageRowsSelectedHandler()}
          aria-label="Select all"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onChange={row.getToggleSelectedHandler()}
          aria-label="Select row"
        />
      ),
      size: 40,
      enableSorting: false,
    };

    const cols: ColumnDef<Record<string, unknown>>[] = [selectColumn, ...columns];

    if (!hasActions) return cols;

    return [
      ...cols,
      {
        id: "actions",
        header: "",
        cell: ({ row }: { row: { original: Record<string, unknown> } }) => {
          const item = row.original;
          return (
            <div className="flex items-center gap-1 justify-end">
              {onLogs && (
                <Button variant="ghost" size="icon" onClick={() => onLogs(item)} title="Logs">
                  <FileText className="h-3.5 w-3.5" />
                </Button>
              )}
              {onTerminal && (
                <Button variant="ghost" size="icon" onClick={() => onTerminal(item)} title="Terminal">
                  <Terminal className="h-3.5 w-3.5" />
                </Button>
              )}
              {onEdit && (
                <Button variant="ghost" size="icon" onClick={() => onEdit(item)} title="Edit">
                  <Edit className="h-3.5 w-3.5" />
                </Button>
              )}
              {onDelete && (
                <Button variant="ghost" size="icon" onClick={() => onDelete(item)} title="Delete">
                  <Trash2 className="h-3.5 w-3.5 text-red-400" />
                </Button>
              )}
            </div>
          );
        },
        size: 120,
      } satisfies ColumnDef<Record<string, unknown>>,
    ];
  }, [columns, onEdit, onDelete, onTerminal, onLogs]);

  const table = useReactTable({
    data,
    columns: allColumns,
    state: { sorting, globalFilter, rowSelection },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onRowSelectionChange: setRowSelection,
    enableRowSelection: true,
    globalFilterFn,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const selectedRows = table.getFilteredSelectedRowModel().rows;
  const selectedCount = selectedRows.length;

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-10 w-full" />
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-4 mb-4">
        <div className="relative max-w-sm">
          <Input
            ref={filterInputRef}
            placeholder={`Filter ${kind}...`}
            value={globalFilter}
            onChange={(e) => handleFilterChange(e.target.value)}
            className="pr-8"
          />
          {!globalFilter && (
            <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground font-mono">
              /
            </kbd>
          )}
        </div>
        {globalFilter && resourceKind && (
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleFavorite}
            title={savedMatch ? "Remove from favorites" : "Save as favorite search"}
            className="shrink-0"
          >
            <Star className={`h-4 w-4 ${savedMatch ? "fill-yellow-400 text-yellow-400" : ""}`} />
          </Button>
        )}
        <span className="text-sm text-muted-foreground">
          {table.getFilteredRowModel().rows.length} items
        </span>
      </div>

      {selectedCount > 0 && (
        <div className="flex items-center gap-3 mb-4 px-3 py-2 rounded-md bg-muted/50 border">
          <span className="text-sm font-medium">{selectedCount} selected</span>
          {onBatchDelete && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                onBatchDelete(selectedRows.map((r) => r.original));
                setRowSelection({});
              }}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              Delete Selected
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => setRowSelection({})}>
            Clear Selection
          </Button>
        </div>
      )}

      <div className="rounded-md border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} className="border-b bg-muted/50">
                {headerGroup.headers.map((header) => {
                  const colMeta = header.column.columnDef.meta as { className?: string } | undefined;
                  return (
                  <th key={header.id} className={cn("px-4 py-3 text-left font-medium text-muted-foreground whitespace-nowrap", colMeta?.className)}>
                    {header.isPlaceholder ? null : (
                      <div
                        className={header.column.getCanSort() ? "flex items-center gap-1 cursor-pointer select-none" : ""}
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {header.column.getCanSort() && <ArrowUpDown className="h-3 w-3" />}
                      </div>
                    )}
                  </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className={`border-b hover:bg-muted/30 transition-colors ${row.getIsSelected() ? "bg-muted/40" : ""}`}>
                {row.getVisibleCells().map((cell) => {
                  const colMeta = cell.column.columnDef.meta as { className?: string } | undefined;
                  return (
                  <td key={cell.id} className={cn("px-4 py-2.5", colMeta?.className)}>
                    {cell.column.id === "name" && detailLinkFn ? (
                      <Link
                        href={detailLinkFn(row.original)}
                        className="text-primary hover:underline"
                        onClick={(e) => {
                          if (e.ctrlKey || e.metaKey || e.button === 1) {
                            e.preventDefault();
                            const href = detailLinkFn(row.original);
                            const name = (row.original.metadata as Record<string, unknown>)?.name as string || "Detail";
                            openTab(contextName, href, name);
                          }
                        }}
                        onAuxClick={(e) => {
                          if (e.button === 1) {
                            e.preventDefault();
                            const href = detailLinkFn(row.original);
                            const name = (row.original.metadata as Record<string, unknown>)?.name as string || "Detail";
                            openTab(contextName, href, name);
                          }
                        }}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </Link>
                    ) : (
                      flexRender(cell.column.columnDef.cell, cell.getContext())
                    )}
                  </td>
                  );
                })}
              </tr>
            ))}
            {table.getRowModel().rows.length === 0 && (
              <tr>
                <td colSpan={allColumns.length} className="px-4 py-8 text-center text-muted-foreground">
                  No {kind} found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Common column helpers
export function nameColumn(): ColumnDef<Record<string, unknown>> {
  return {
    accessorFn: (row) => (row.metadata as Record<string, unknown>)?.name,
    id: "name",
    header: "Name",
    cell: ({ getValue }) => <span className="font-medium">{getValue() as string}</span>,
  };
}

export function namespaceColumn(): ColumnDef<Record<string, unknown>> {
  return {
    accessorFn: (row) => (row.metadata as Record<string, unknown>)?.namespace,
    id: "namespace",
    header: "Namespace",
  };
}

export function ageColumn(): ColumnDef<Record<string, unknown>> {
  return {
    accessorFn: (row) => (row.metadata as Record<string, unknown>)?.creationTimestamp,
    id: "age",
    header: "Age",
    cell: ({ getValue }) => formatAge(getValue() as string),
  };
}

export function statusBadge(status: string) {
  const variant =
    status === "Running" || status === "Active" || status === "Bound" || status === "Available"
      ? "success"
      : status === "Pending" || status === "ContainerCreating"
      ? "warning"
      : status === "Failed" || status === "CrashLoopBackOff" || status === "Error"
      ? "destructive"
      : "secondary";
  return <Badge variant={variant}>{status}</Badge>;
}
