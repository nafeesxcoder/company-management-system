'use client';

import * as React from 'react';
import { Copy, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { ErrorState, LoadingBlock, PageHeading } from '@/components/states';
import { useAuth } from '@/features/auth/auth-context';
import { useInviteMember, useMembers, useUpdateMember } from '@/services/queries';
import { useToast } from '@/hooks/use-toast';
import { formatDate, formatRelativeTime, humanize, initials } from '@/lib/utils';

const ROLE_DESCRIPTIONS: Record<string, string> = {
  OWNER: 'Full control, including ownership and removing members',
  ADMIN: 'Manage integrations, roles and the profit split',
  PARTNER: 'Record income and expenses, see everything',
  VIEWER: 'Read-only',
};

export default function TeamPage() {
  const { canAdminister, isOwner, user } = useAuth();
  const { data: members, isLoading, isError, error, refetch } = useMembers();
  const [inviteOpen, setInviteOpen] = React.useState(false);

  return (
    <>
      <PageHeading
        title="Team"
        description="Who can see and change the company's finances."
        actions={
          canAdminister ? (
            <Button size="sm" onClick={() => setInviteOpen(true)}>
              <UserPlus />
              Invite a partner
            </Button>
          ) : undefined
        }
      />

      {isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : isLoading || !members ? (
        <LoadingBlock label="Loading the team" />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last seen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((member) => {
                  const isSelf = member.user.id === user?.id;
                  return (
                    <TableRow key={member.id}>
                      <TableCell>
                        <span className="flex items-center gap-2.5">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-medium text-accent-foreground">
                            {initials(member.user.fullName)}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium">
                              {member.user.fullName}
                              {isSelf ? (
                                <span className="ml-1.5 text-xs font-normal text-muted-foreground">you</span>
                              ) : null}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {member.user.email}
                            </span>
                          </span>
                        </span>
                      </TableCell>
                      <TableCell>
                        {canAdminister && !isSelf ? (
                          <RoleSelect member={member} canSetOwner={isOwner} />
                        ) : (
                          <Badge variant="outline">{humanize(member.role)}</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            member.status === 'ACTIVE'
                              ? 'gain'
                              : member.status === 'INVITED'
                                ? 'pending'
                                : 'loss'
                          }
                        >
                          {humanize(member.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {member.user.lastLoginAt
                          ? formatRelativeTime(member.user.lastLoginAt)
                          : member.status === 'INVITED'
                            ? 'Invitation not accepted'
                            : 'Never'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <div className="mt-6 max-w-2xl space-y-1 text-sm">
        <p className="font-medium">What each role can do</p>
        {Object.entries(ROLE_DESCRIPTIONS).map(([role, description]) => (
          <p key={role} className="text-muted-foreground">
            <span className="font-medium text-foreground">{humanize(role)}</span> — {description}
          </p>
        ))}
      </div>

      {inviteOpen ? <InviteDialog onClose={() => setInviteOpen(false)} /> : null}
    </>
  );
}

function RoleSelect({
  member,
  canSetOwner,
}: {
  member: { id: string; role: string };
  canSetOwner: boolean;
}) {
  const { toast, toastError } = useToast();
  const updateMember = useUpdateMember();

  const roles = canSetOwner ? ['OWNER', 'ADMIN', 'PARTNER', 'VIEWER'] : ['ADMIN', 'PARTNER', 'VIEWER'];

  return (
    <Select
      value={member.role}
      onValueChange={async (role) => {
        try {
          await updateMember.mutateAsync({ id: member.id, role });
          toast({ title: 'Role updated', variant: 'success' });
        } catch (error) {
          toastError(error, 'Could not change the role');
        }
      }}
    >
      <SelectTrigger className="h-8 w-[130px]" aria-label="Change role">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {roles.map((role) => (
          <SelectItem key={role} value={role}>
            {humanize(role)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function InviteDialog({ onClose }: { onClose: () => void }) {
  const { toast, toastError } = useToast();
  const inviteMember = useInviteMember();

  const [email, setEmail] = React.useState('');
  const [fullName, setFullName] = React.useState('');
  const [role, setRole] = React.useState('PARTNER');
  const [inviteUrl, setInviteUrl] = React.useState<string | null>(null);
  const [deliveryNote, setDeliveryNote] = React.useState<string | null>(null);

  async function submit() {
    try {
      const result = await inviteMember.mutateAsync({ email, fullName, role });
      if (result.inviteUrl) {
        setInviteUrl(result.inviteUrl);
        setDeliveryNote(result.deliveryNote ?? null);
      } else {
        toast({ title: `${email} added to the company`, variant: 'success' });
        onClose();
      }
    } catch (error) {
      toastError(error, 'Could not send the invitation');
    }
  }

  async function copyLink() {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
    toast({ title: 'Link copied', variant: 'success' });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{inviteUrl ? 'Send this link' : 'Invite a partner'}</DialogTitle>
          <DialogDescription>
            {inviteUrl
              ? deliveryNote ?? 'Pass this link to them over a channel you trust.'
              : 'They will set their own password. There is no public sign-up for this company.'}
          </DialogDescription>
        </DialogHeader>

        {inviteUrl ? (
          <div className="space-y-3">
            <div className="flex gap-2">
              <Input readOnly value={inviteUrl} className="font-mono text-xs" />
              <Button variant="outline" size="icon" onClick={() => void copyLink()} aria-label="Copy link">
                <Copy />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              The link works once and expires in 72 hours.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="invite-name">Full name</Label>
              <Input
                id="invite-name"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-role">Role</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger id="invite-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {['ADMIN', 'PARTNER', 'VIEWER'].map((value) => (
                    <SelectItem key={value} value={value}>
                      {humanize(value)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{ROLE_DESCRIPTIONS[role]}</p>
            </div>
          </div>
        )}

        <DialogFooter>
          {inviteUrl ? (
            <Button onClick={onClose}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                onClick={() => void submit()}
                loading={inviteMember.isPending}
                disabled={!email || fullName.trim().length < 2}
              >
                Create invitation
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
