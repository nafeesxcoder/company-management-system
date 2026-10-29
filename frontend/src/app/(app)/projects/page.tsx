'use client';

import * as React from 'react';
import Link from 'next/link';
import { Archive, FolderPlus, Search } from 'lucide-react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState, ErrorState, NoResults, PageHeading, Pagination, TableSkeleton } from '@/components/states';
import { useAuth } from '@/features/auth/auth-context';
import { useArchiveProject, useCreateProject, useProjects } from '@/services/queries';
import { useToast } from '@/hooks/use-toast';
import { ApiRequestError } from '@/lib/api-client';
import { formatDate, humanize } from '@/lib/utils';

const PROJECT_TYPES = [
  'SAAS',
  'WEB_APPLICATION',
  'MOBILE_APPLICATION',
  'CLIENT_WEBSITE',
  'CUSTOM_SOFTWARE',
  'OTHER',
] as const;

const REVENUE_MODELS = [
  'MONTHLY_SUBSCRIPTION',
  'ANNUAL_SUBSCRIPTION',
  'ONE_TIME_PAYMENT',
  'IN_APP_PURCHASE',
  'ADVERTISING',
  'CLIENT_MILESTONE',
  'MANUAL_BANK_TRANSFER',
  'OTHER',
] as const;

const STATUS_VARIANTS: Record<string, 'default' | 'gain' | 'outline' | 'pending'> = {
  ACTIVE: 'gain',
  PLANNING: 'outline',
  PAUSED: 'pending',
  COMPLETED: 'default',
  ARCHIVED: 'outline',
};

export default function ProjectsPage() {
  const { canWrite, activeCompany } = useAuth();
  const { toast, toastError } = useToast();

  const [page, setPage] = React.useState(1);
  const [search, setSearch] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  const [status, setStatus] = React.useState('all');
  const [includeArchived, setIncludeArchived] = React.useState(false);
  const [createOpen, setCreateOpen] = React.useState(false);

  React.useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, isLoading, isError, error, refetch } = useProjects({
    page,
    pageSize: 25,
    search: debounced || undefined,
    status: status === 'all' ? undefined : status,
    includeArchived,
  });

  const archiveProject = useArchiveProject();
  const hasFilters = Boolean(debounced) || status !== 'all';

  async function handleArchive(id: string, name: string) {
    try {
      await archiveProject.mutateAsync(id);
      toast({ title: `${name} archived`, description: 'Its financial history is kept.', variant: 'success' });
    } catch (err) {
      toastError(err, 'Could not archive the project');
    }
  }

  return (
    <>
      <PageHeading
        title="Projects"
        description="Every app, SaaS product and client site you earn from. Registering one here does not move its code."
        actions={
          canWrite ? (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <FolderPlus />
              Register a project
            </Button>
          ) : undefined
        }
      />

      <Card className="mb-4">
        <CardContent className="flex flex-wrap gap-3 p-4">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              className="pl-9"
              placeholder="Search by name or code"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="Search projects"
            />
          </div>

          <Select value={status} onValueChange={(value) => { setStatus(value); setPage(1); }}>
            <SelectTrigger className="w-[160px]" aria-label="Filter by status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any status</SelectItem>
              {['PLANNING', 'ACTIVE', 'PAUSED', 'COMPLETED'].map((value) => (
                <SelectItem key={value} value={value}>
                  {humanize(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            variant={includeArchived ? 'secondary' : 'ghost'}
            size="sm"
            aria-pressed={includeArchived}
            onClick={() => { setIncludeArchived((v) => !v); setPage(1); }}
          >
            <Archive />
            Archived
          </Button>
        </CardContent>
      </Card>

      {isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : isLoading ? (
        <TableSkeleton columns={5} />
      ) : data && data.items.length === 0 ? (
        hasFilters ? (
          <NoResults onClear={() => { setSearch(''); setStatus('all'); }} />
        ) : (
          <EmptyState
            title="No projects registered"
            description="Register your first app or client site, then income and expenses can be attributed to it."
            action={
              canWrite ? (
                <Button size="sm" onClick={() => setCreateOpen(true)}>
                  Register a project
                </Button>
              ) : undefined
            }
          />
        )
      ) : data ? (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Revenue model</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Records</TableHead>
                  {canWrite ? <TableHead className="w-10" /> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((project) => (
                  <TableRow key={project.id}>
                    <TableCell>
                      <Link
                        href={`/projects/${project.id}`}
                        className="text-sm font-medium underline-offset-2 hover:underline"
                      >
                        {project.name}
                      </Link>
                      <span className="ml-2 text-xs text-muted-foreground">{project.code}</span>
                      {project.launchDate ? (
                        <span className="block text-xs text-muted-foreground">
                          Launched {formatDate(project.launchDate)}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{humanize(project.type)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {humanize(project.revenueModel)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANTS[project.status] ?? 'default'}>
                        {humanize(project.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-sm tabular text-muted-foreground">
                      {(project._count?.transactions ?? 0) + (project._count?.expenses ?? 0)}
                    </TableCell>
                    {canWrite ? (
                      <TableCell>
                        {!project.archivedAt ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Archive ${project.name}`}
                            title="Archive"
                            onClick={() => void handleArchive(project.id, project.name)}
                          >
                            <Archive />
                          </Button>
                        ) : null}
                      </TableCell>
                    ) : null}
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

      {createOpen ? (
        <CreateProjectDialog
          onClose={() => setCreateOpen(false)}
          defaultCurrency={activeCompany?.baseCurrency ?? 'INR'}
        />
      ) : null}
    </>
  );
}

const createSchema = z.object({
  code: z
    .string()
    .min(2, 'Give the project a short code')
    .max(40)
    .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, 'Use letters, digits, hyphens and underscores only'),
  name: z.string().min(2, 'Give the project a name').max(160),
  type: z.string(),
  revenueModel: z.string(),
  currency: z.string().length(3),
  projectUrl: z.string().url('Enter a valid URL').optional().or(z.literal('')),
  repositoryUrl: z.string().url('Enter a valid URL').optional().or(z.literal('')),
  launchDate: z.string().optional(),
  description: z.string().max(5000).optional(),
});

type CreateValues = z.infer<typeof createSchema>;

function CreateProjectDialog({
  onClose,
  defaultCurrency,
}: {
  onClose: () => void;
  defaultCurrency: string;
}) {
  const { toast, toastError } = useToast();
  const createProject = useCreateProject();

  const {
    register,
    handleSubmit,
    control,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      type: 'SAAS',
      revenueModel: 'MONTHLY_SUBSCRIPTION',
      currency: defaultCurrency,
    },
  });

  async function onSubmit(values: CreateValues) {
    try {
      await createProject.mutateAsync({
        code: values.code.toUpperCase(),
        name: values.name,
        type: values.type as never,
        revenueModel: values.revenueModel as never,
        currency: values.currency.toUpperCase(),
        ...(values.projectUrl ? { projectUrl: values.projectUrl } : {}),
        ...(values.repositoryUrl ? { repositoryUrl: values.repositoryUrl } : {}),
        ...(values.launchDate ? { launchDate: values.launchDate } : {}),
        ...(values.description ? { description: values.description } : {}),
      });
      toast({ title: `${values.name} registered`, variant: 'success' });
      onClose();
    } catch (error) {
      if (error instanceof ApiRequestError) {
        for (const [field, message] of Object.entries(error.fieldErrors)) {
          setError(field as keyof CreateValues, { message });
        }
        if (error.code === 'CONFLICT') {
          setError('code', { message: error.message });
          return;
        }
        if (Object.keys(error.fieldErrors).length > 0) return;
      }
      toastError(error, 'Could not register the project');
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Register a project</DialogTitle>
          <DialogDescription>
            The project keeps running on its own server, domain and repository. This record is what
            payments and expenses attach to.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
            <div className="space-y-1.5">
              <Label htmlFor="name">Name</Label>
              <Input id="name" autoFocus {...register('name')} aria-invalid={Boolean(errors.name)} />
              {errors.name ? <p className="text-xs text-[hsl(var(--loss))]">{errors.name.message}</p> : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="code">Code</Label>
              <Input
                id="code"
                className="uppercase"
                placeholder="DESTINY-ONE"
                {...register('code')}
                aria-invalid={Boolean(errors.code)}
              />
              {errors.code ? <p className="text-xs text-[hsl(var(--loss))]">{errors.code.message}</p> : null}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="type">Type</Label>
              <Controller
                control={control}
                name="type"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PROJECT_TYPES.map((value) => (
                        <SelectItem key={value} value={value}>
                          {humanize(value)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="revenueModel">How it earns</Label>
              <Controller
                control={control}
                name="revenueModel"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="revenueModel">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {REVENUE_MODELS.map((value) => (
                        <SelectItem key={value} value={value}>
                          {humanize(value)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="currency">Currency</Label>
              <Input id="currency" maxLength={3} className="uppercase" {...register('currency')} />
              <p className="text-xs text-muted-foreground">
                Cannot be changed once payments are recorded.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="launchDate">Launch date (optional)</Label>
              <Input id="launchDate" type="date" {...register('launchDate')} />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="projectUrl">Live URL (optional)</Label>
              <Input id="projectUrl" placeholder="https://" {...register('projectUrl')} />
              {errors.projectUrl ? (
                <p className="text-xs text-[hsl(var(--loss))]">{errors.projectUrl.message}</p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="repositoryUrl">Repository (optional)</Label>
              <Input id="repositoryUrl" placeholder="https://" {...register('repositoryUrl')} />
              {errors.repositoryUrl ? (
                <p className="text-xs text-[hsl(var(--loss))]">{errors.repositoryUrl.message}</p>
              ) : null}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="description">Description (optional)</Label>
            <Textarea id="description" rows={2} {...register('description')} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={isSubmitting}>
              Register project
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
