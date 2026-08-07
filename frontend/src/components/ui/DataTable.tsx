import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export type DataTableColumn<T> = {
  key: string;
  header: string;
  align?: 'left' | 'right';
  numeric?: boolean;
  render: (row: T) => ReactNode;
};

type DataTableProps<T> = {
  columns: DataTableColumn<T>[];
  rows: T[];
  emptyMessage: string;
  getRowKey: (row: T) => string;
  className?: string;
};

export function DataTable<T>({
  columns,
  rows,
  emptyMessage,
  getRowKey,
  className,
}: DataTableProps<T>) {
  if (rows.length === 0) {
    return (
      <p className={cn('type-caption py-6 text-center', className)}>{emptyMessage}</p>
    );
  }

  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-border-subtle">
            {columns.map((col) => (
              <th
                key={col.key}
                className={cn(
                  'px-3 py-3 type-caption font-medium',
                  col.align === 'right' && 'text-right',
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={getRowKey(row)}
              className={cn(index % 2 === 1 && 'bg-glass-fill')}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={cn(
                    'px-3 py-3 align-middle',
                    col.numeric ? 'type-data-base' : 'text-[0.9375rem]',
                    col.align === 'right' && 'text-right',
                  )}
                >
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
