'use client';

import * as React from 'react';
import { Check, Copy, Plug, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import { EmptyState, ErrorState, LoadingBlock, PageHeading } from '@/components/states';
import {
  useCreateMapping,
  useCreateProvider,
  useDeleteMapping,
  useProjects,
  useProviderMappings,
  useProviders,
  useWebhookEvents,
} from '@/services/queries';
import { useToast } from '@/hooks/use-toast';
import { API_BASE_URL } from '@/lib/api-client';
import { formatDate, formatRelativeTime, humanize } from '@/lib/utils';
import type { ProviderAccount } from '@/types/api';

/**
 * Payment integrations.
 *
 * The readiness checklist is the point of this screen. A provider is only
 * "ready" once credentials are stored, products are mapped to projects, AND a
 * correctly signed event has actually arrived — so the UI never shows a green
 * tick for a setup that would silently drop income.
 */
export default function IntegrationsPage() {
  const { data: providers, isLoading, isError, error, refetch } = useProviders();
  const [createOpen, setCreateOpen] = React.useState(false);

  return (
    <>
      <PageHeading
        title="Payments"
        description="Connect a payment provider so income arrives here without anyone typing it."
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus />
            Add a provider
          </Button>
        }
      />

      <Tabs defaultValue="providers">
        <TabsList>
          <TabsTrigger value="providers">Providers</TabsTrigger>
          <TabsTrigger value="events">Delivery log</TabsTrigger>
        </TabsList>

        <TabsContent value="providers">
          {isError ? (
            <ErrorState error={error} onRetry={() => void refetch()} />
          ) : isLoading || !providers ? (
            <LoadingBlock label="Loading integrations" />
          ) : providers.length === 0 ? (
            <EmptyState
              icon={Plug}
              title="No providers connected"
              description="Add Stripe, Razorpay or your own app backend to bring payments in automatically. Until then, record income by hand."
              action={
                <Button size="sm" onClick={() => setCreateOpen(true)}>
                  Add a provider
                </Button>
              }
            />
          ) : (
            <div className="space-y-4">
              {providers.map((provider) => (
                <ProviderCard key={provider.id} provider={provider} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="events">
          <WebhookLog />
        </TabsContent>
      </Tabs>

      {createOpen ? <AddProviderDialog onClose={() => setCreateOpen(false)} /> : null}
    </>
  );
}

function ProviderCard({ provider }: { provider: ProviderAccount }) {
  const { toast } = useToast();
  const [mappingOpen, setMappingOpen] = React.useState(false);
  const { data: mappings } = useProviderMappings(provider.id);
  const deleteMapping = useDeleteMapping(provider.id);

  // The API returns a path; make it the absolute URL the provider must call.
  const origin = API_BASE_URL.replace(/\/api\/v1$/, '');
  const webhookUrl = `${origin}${provider.webhookUrl}`;

  async function copyWebhook() {
    await navigator.clipboard.writeText(webhookUrl);
    toast({ title: 'Webhook URL copied', variant: 'success' });
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            {provider.label}
            <Badge variant="outline">{humanize(provider.provider)}</Badge>
            {provider.readiness.ready ? (
              <Badge variant="gain">Receiving payments</Badge>
            ) : (
              <Badge variant="pending">Setup incomplete</Badge>
            )}
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {provider.transactionCount} payment{provider.transactionCount === 1 ? '' : 's'} received
            {provider.lastWebhookAt ? ` · last ${formatRelativeTime(provider.lastWebhookAt)}` : ''}
          </p>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* Honest readiness, step by step. */}
        <div className="space-y-1.5">
          <ReadinessRow done={provider.readiness.credentialsStored}>
            Webhook secret stored
          </ReadinessRow>
          <ReadinessRow done={provider.readiness.productMappingsConfigured}>
            Products mapped to projects ({provider.productMappingCount})
          </ReadinessRow>
          <ReadinessRow done={provider.readiness.signedEventReceived}>
            A correctly signed event has been received
          </ReadinessRow>
          {!provider.readiness.ready ? (
            <p className="pt-1 text-xs text-muted-foreground">
              Until all three are done, payments from this provider may arrive unattributed or not at
              all. Nothing is assumed to work before a real signed event has been processed.
            </p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`webhook-${provider.id}`}>Webhook URL</Label>
          <div className="flex gap-2">
            <Input
              id={`webhook-${provider.id}`}
              readOnly
              value={webhookUrl}
              className="font-mono text-xs"
            />
            <Button variant="outline" size="icon" onClick={() => void copyWebhook()} aria-label="Copy webhook URL">
              <Copy />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Register this in the provider&apos;s dashboard. It must be reachable over HTTPS in production.
          </p>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium">Product mappings</p>
            <Button variant="outline" size="sm" onClick={() => setMappingOpen(true)}>
              <Plus />
              Map a product
            </Button>
          </div>

          {!mappings || mappings.length === 0 ? (
            <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
              No mappings yet. Without one, a payment from this provider is recorded but flagged for
              review rather than attributed to a project.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Provider product</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {mappings.map((mapping) => (
                  <TableRow key={mapping.id}>
                    <TableCell className="font-mono text-xs">{mapping.externalProductId}</TableCell>
                    <TableCell className="text-sm">
                      {mapping.project.name} · {mapping.project.code}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Remove mapping"
                        onClick={() => void deleteMapping.mutateAsync(mapping.id)}
                      >
                        <X />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </CardContent>

      {mappingOpen ? (
        <AddMappingDialog providerId={provider.id} onClose={() => setMappingOpen(false)} />
      ) : null}
    </Card>
  );
}

function ReadinessRow({ done, children }: { done: boolean; children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-sm">
      <span
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${
          done ? 'bg-primary text-primary-foreground' : 'border border-border'
        }`}
        aria-hidden
      >
        {done ? <Check className="h-3 w-3" /> : null}
      </span>
      <span className={done ? '' : 'text-muted-foreground'}>{children}</span>
      <span className="sr-only">{done ? 'done' : 'not done'}</span>
    </p>
  );
}

function AddProviderDialog({ onClose }: { onClose: () => void }) {
  const { toast, toastError } = useToast();
  const createProvider = useCreateProvider();

  const [provider, setProvider] = React.useState('STRIPE');
  const [label, setLabel] = React.useState('');
  const [webhookSecret, setWebhookSecret] = React.useState('');
  const [apiKey, setApiKey] = React.useState('');

  async function submit() {
    try {
      await createProvider.mutateAsync({
        provider,
        label,
        ...(webhookSecret ? { webhookSecret } : {}),
        ...(apiKey ? { apiKey } : {}),
      });
      toast({ title: 'Provider added', variant: 'success' });
      onClose();
    } catch (error) {
      toastError(error, 'Could not add the provider');
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a payment provider</DialogTitle>
          <DialogDescription>
            Secrets are encrypted before they are stored and are never shown again or sent to the
            browser.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="provider">Provider</Label>
            <Select value={provider} onValueChange={setProvider}>
              <SelectTrigger id="provider">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="STRIPE">Stripe</SelectItem>
                <SelectItem value="RAZORPAY">Razorpay</SelectItem>
                <SelectItem value="GOOGLE_PLAY">Google Play</SelectItem>
                <SelectItem value="OTHER">Your own app backend</SelectItem>
              </SelectContent>
            </Select>
            {provider === 'GOOGLE_PLAY' ? (
              <p className="text-xs text-[hsl(var(--pending))]">
                Google Play notifications carry no amount, so this build records them for audit but
                does not create revenue from them. See docs/payment-integrations.md.
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="label">Label</Label>
            <Input
              id="label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Stripe – main account"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="webhookSecret">Webhook signing secret</Label>
            <Input
              id="webhookSecret"
              type="password"
              value={webhookSecret}
              onChange={(event) => setWebhookSecret(event.target.value)}
              placeholder="whsec_…"
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              Without this, every incoming webhook is rejected — which is the correct behaviour, since
              an unsigned request could fabricate income.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="apiKey">API key (optional)</Label>
            <Input
              id="apiKey"
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              autoComplete="off"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            loading={createProvider.isPending}
            disabled={label.trim().length < 2}
          >
            Add provider
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddMappingDialog({ providerId, onClose }: { providerId: string; onClose: () => void }) {
  const { toast, toastError } = useToast();
  const createMapping = useCreateMapping(providerId);
  const { data: projects } = useProjects({ pageSize: 200 });

  const [externalProductId, setExternalProductId] = React.useState('');
  const [projectId, setProjectId] = React.useState('');

  async function submit() {
    try {
      await createMapping.mutateAsync({ externalProductId, projectId });
      toast({ title: 'Mapping added', variant: 'success' });
      onClose();
    } catch (error) {
      toastError(error, 'Could not add the mapping');
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Map a product to a project</DialogTitle>
          <DialogDescription>
            This is how an incoming payment is attributed. Payments are matched on this id and never
            on a guess.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="externalProductId">Provider price or product id</Label>
            <Input
              id="externalProductId"
              value={externalProductId}
              onChange={(event) => setExternalProductId(event.target.value)}
              placeholder="price_1A2b3C…"
              className="font-mono text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mapping-project">Project</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger id="mapping-project">
                <SelectValue placeholder="Choose a project" />
              </SelectTrigger>
              <SelectContent>
                {(projects?.items ?? []).map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name} · {project.code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            loading={createMapping.isPending}
            disabled={!externalProductId || !projectId}
          >
            Add mapping
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WebhookLog() {
  const [page, setPage] = React.useState(1);
  const { data, isLoading } = useWebhookEvents({ page, pageSize: 25 });

  if (isLoading || !data) return <LoadingBlock label="Loading the delivery log" />;

  if (data.items.length === 0) {
    return (
      <EmptyState
        title="No webhook deliveries yet"
        description="Once a provider sends its first event, every delivery appears here with its signature result."
      />
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Received</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>Event</TableHead>
              <TableHead>Signature</TableHead>
              <TableHead>Outcome</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.items.map((event) => (
              <TableRow key={event.id}>
                <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                  {formatDate(event.receivedAt, { withTime: true })}
                </TableCell>
                <TableCell className="text-sm">{humanize(event.provider)}</TableCell>
                <TableCell className="font-mono text-xs">{event.eventType}</TableCell>
                <TableCell>
                  <Badge variant={event.signatureValid ? 'gain' : 'loss'}>
                    {event.signatureValid ? 'Verified' : 'Not verified'}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge
                    variant={
                      event.status === 'PROCESSED'
                        ? 'gain'
                        : event.status === 'NEEDS_REVIEW'
                          ? 'pending'
                          : event.status === 'FAILED'
                            ? 'loss'
                            : 'outline'
                    }
                  >
                    {humanize(event.status)}
                  </Badge>
                  {event.lastError ? (
                    <p className="mt-1 max-w-sm text-xs text-muted-foreground">{event.lastError}</p>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
