'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeading, LoadingBlock } from '@/components/states';
import { useAuth } from '@/features/auth/auth-context';
import { useChangePassword, useCompany, useProfile, useUpdateCompany, useUpdateProfile } from '@/services/queries';
import { useToast } from '@/hooks/use-toast';
import { ApiRequestError } from '@/lib/api-client';
import { formatDate } from '@/lib/utils';

export default function SettingsPage() {
  const { canAdminister } = useAuth();

  return (
    <>
      <PageHeading title="Settings" />

      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">Your profile</TabsTrigger>
          <TabsTrigger value="security">Password</TabsTrigger>
          {canAdminister ? <TabsTrigger value="company">Company</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="profile">
          <ProfileSettings />
        </TabsContent>
        <TabsContent value="security">
          <PasswordSettings />
        </TabsContent>
        {canAdminister ? (
          <TabsContent value="company">
            <CompanySettings />
          </TabsContent>
        ) : null}
      </Tabs>
    </>
  );
}

function ProfileSettings() {
  const { toast, toastError } = useToast();
  const { data: profile, isLoading } = useProfile();
  const updateProfile = useUpdateProfile();

  const [fullName, setFullName] = React.useState('');
  const [timezone, setTimezone] = React.useState('');

  React.useEffect(() => {
    if (profile) {
      setFullName(profile.fullName);
      setTimezone(profile.timezone);
    }
  }, [profile]);

  if (isLoading || !profile) return <LoadingBlock />;

  async function save() {
    try {
      await updateProfile.mutateAsync({ fullName, timezone });
      toast({ title: 'Profile saved', variant: 'success' });
    } catch (error) {
      toastError(error, 'Could not save your profile');
    }
  }

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>Your profile</CardTitle>
        <CardDescription>
          Dates and times across the app are shown in your timezone.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="fullName">Full name</Label>
          <Input id="fullName" value={fullName} onChange={(event) => setFullName(event.target.value)} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" value={profile.email} readOnly disabled />
          <p className="text-xs text-muted-foreground">
            Ask an owner if your email address needs to change.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="timezone">Timezone</Label>
          <Input
            id="timezone"
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
            placeholder="Asia/Kolkata"
          />
        </div>

        <p className="text-xs text-muted-foreground">
          Joined {formatDate(profile.createdAt)}
          {profile.lastLoginAt ? ` · last signed in ${formatDate(profile.lastLoginAt, { withTime: true })}` : ''}
        </p>

        <Button onClick={() => void save()} loading={updateProfile.isPending}>
          Save changes
        </Button>
      </CardContent>
    </Card>
  );
}

function PasswordSettings() {
  const { toast, toastError } = useToast();
  const changePassword = useChangePassword();

  const [currentPassword, setCurrentPassword] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;

  async function save() {
    setError(null);
    if (mismatch) return;
    try {
      await changePassword.mutateAsync({ currentPassword, newPassword });
      toast({
        title: 'Password changed',
        description: 'You have been signed out everywhere else.',
        variant: 'success',
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      if (err instanceof ApiRequestError) {
        const fieldMessage = Object.values(err.fieldErrors)[0];
        setError(fieldMessage ?? err.message);
        return;
      }
      toastError(err, 'Could not change your password');
    }
  }

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>Change password</CardTitle>
        <CardDescription>
          Changing your password signs you out on every other device.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <div
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-[hsl(var(--loss))]"
          >
            {error}
          </div>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor="currentPassword">Current password</Label>
          <Input
            id="currentPassword"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="newPassword">New password</Label>
          <Input
            id="newPassword"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            At least 12 characters, with an uppercase letter, a lowercase letter and a digit.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="confirmPassword">Confirm new password</Label>
          <Input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            aria-invalid={mismatch}
          />
          {mismatch ? (
            <p className="text-xs text-[hsl(var(--loss))]">These passwords do not match.</p>
          ) : null}
        </div>

        <Button
          onClick={() => void save()}
          loading={changePassword.isPending}
          disabled={!currentPassword || newPassword.length < 12 || mismatch}
        >
          Change password
        </Button>
      </CardContent>
    </Card>
  );
}

function CompanySettings() {
  const { toast, toastError } = useToast();
  const { data: company, isLoading } = useCompany();
  const updateCompany = useUpdateCompany();

  const [name, setName] = React.useState('');
  const [legalName, setLegalName] = React.useState('');
  const [timezone, setTimezone] = React.useState('');

  React.useEffect(() => {
    if (company) {
      setName(company.name);
      setLegalName(company.legalName ?? '');
      setTimezone(company.timezone);
    }
  }, [company]);

  if (isLoading || !company) return <LoadingBlock />;

  async function save() {
    try {
      await updateCompany.mutateAsync({ name, legalName, timezone });
      toast({ title: 'Company saved', variant: 'success' });
    } catch (error) {
      toastError(error, 'Could not save the company');
    }
  }

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>Company</CardTitle>
        <CardDescription>
          The company timezone decides what &ldquo;today&rdquo; and &ldquo;this month&rdquo; mean in
          every report, for every partner.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="company-name">Name</Label>
          <Input id="company-name" value={name} onChange={(event) => setName(event.target.value)} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="legal-name">Legal name (optional)</Label>
          <Input id="legal-name" value={legalName} onChange={(event) => setLegalName(event.target.value)} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="company-timezone">Reporting timezone</Label>
          <Input
            id="company-timezone"
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="base-currency">Base currency</Label>
          <Input id="base-currency" value={company.baseCurrency} readOnly disabled />
          <p className="text-xs text-muted-foreground">
            Fixed once set. Changing it would reinterpret every figure already recorded.
          </p>
        </div>

        <Button onClick={() => void save()} loading={updateCompany.isPending}>
          Save changes
        </Button>
      </CardContent>
    </Card>
  );
}
