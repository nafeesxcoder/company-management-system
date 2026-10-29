'use client';

import * as React from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState, ErrorState, PageHeading, Pagination, TableSkeleton } from '@/components/states';
import { useAuditLogs } from '@/services/queries';
import { formatDate, humanize } from '@/lib/utils';

/**
 * Activity log. Answers "who changed this figure, and when" — the question
 * that matters most when two partners disagree about a number.
 */
export default function AuditLogsPage() {
  const [page, setPage] = React.useState(1);
  const [action, setAction] = React.useState('');
  const [debounced, setDebounced] = React.useState('');

  React.useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(action);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [action]);

  const { data, isLoading, isError, error, refetch } = useAuditLogs({
    page,
    pageSize: 30,
    action: debounced || undefined,
  });

  return (
    <>
      <PageHeading
        title="Activity"
        description="Every change to a financial record, and who made it."
      />

      <Card className="mb-4">
        <CardContent className="p-4">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              className="pl-9"
              placeholder="Filter by action, e.g. refund"
              value={action}
              onChange={(event) => setAction(event.target.value)}
              aria-label="Filter activity"
            />
          </div>
        </CardContent>
      </Card>

      {isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : isLoading ? (
        <TableSkeleton columns={4} />
      ) : data && data.items.length === 0 ? (
        <EmptyState
          title="Nothing recorded yet"
          description="Changes to projects, income, expenses and the profit split will appear here."
        />
      ) : data ? (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Who</TableHead>
                  <TableHead>What happened</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {formatDate(entry.createdAt, { withTime: true })}
                    </TableCell>
                    <TableCell className="text-sm">
                      {entry.actor ? (
                        entry.actor.fullName
                      ) : (
                        <span className="text-muted-foreground">System</span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-md text-sm">
                      {entry.summary ?? `${humanize(entry.action)} on ${entry.entityType}`}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-[11px]">
                        {entry.action}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="px-4">
              <Pagination
                page={data.meta.page}
                totalPages={data.meta.totalPages}
                totalItems={data.meta.totalItems}
                onPageChange={setPage}
              />
            </div>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
