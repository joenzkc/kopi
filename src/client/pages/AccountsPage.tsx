import { useFinancialValues } from '../lib/valueVisibility';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronRight, CreditCard, FolderPlus, Pencil, Plus, X } from 'lucide-react';
import type { AccountLink, ActualAccount, ActualCategory } from '@shared/types';
import { apiFetch } from '../lib/api';
import { Sheet } from '../components/Sheet';
import { Tile } from '../components/Tile';
import { Button } from '@client/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@client/components/ui/radio-group';
import { Switch, SwitchThumb } from '@client/components/ui/switch';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@client/components/ui/collapsible';
import { Input } from '@client/components/ui/input';
import { Label } from '@client/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@client/components/ui/native-select';
import { Alert } from '@client/components/ui/alert';
import { Skeleton } from '@client/components/ui/skeleton';

type ManagedAccount = ActualAccount & { linkedHoldings: number; autoImport: boolean; links: AccountLink[] };

const KNOWN_ISSUERS = ['DBS', 'UOB', 'OCBC', 'Citi', 'MariBank', 'HSBC', 'StanChart', 'Amex', 'Trust', 'GXS', 'Revolut', 'Wise', 'YouTrip'];
type AccountGroup = { id: string; name: string };

interface AccountsPageProps {
  categories: ActualCategory[];
  baseCurrency: string;
  dataVersion: number;
  /** Account ids hidden from the Home screen carousel. */
  hiddenHomeAccounts: string[];
  onToggleHome: (accountId: string, show: boolean) => void;
  onChanged: (message: string) => void;
  onToast: (msg: string, tone?: 'success' | 'error') => void;
}

const KIND_HELP = {
  budget: 'Counts toward your monthly budget. For bank accounts and credit cards you spend from.',
  tracking: 'Counts toward net worth only. For investments, loans, property and savings you don’t budget.',
};

function Segmented({
  value,
  onChange,
  label,
}: {
  value: boolean; // offbudget
  onChange: (offbudget: boolean) => void;
  label: string;
}) {
  return (
    <RadioGroup value={value ? 'tracking' : 'budget'} onValueChange={(kind) => onChange(kind === 'tracking')} aria-label={label} className="grid grid-cols-2 gap-1 rounded-2xl p-1" style={{ backgroundColor: 'var(--bg-subtle)' }}>
      {[
        { off: false, text: 'Budget' },
        { off: true, text: 'Tracking' },
      ].map((o) => {
        const on = value === o.off;
        return (
          <RadioGroupItem
            key={o.text}
            value={o.off ? 'tracking' : 'budget'}
            className="h-10 rounded-xl text-sm font-bold transition"
            style={{ backgroundColor: on ? 'var(--accent)' : 'transparent', color: on ? 'var(--accent-fg)' : 'var(--text-muted)' }}
          >
            {o.text}
          </RadioGroupItem>
        );
      })}
    </RadioGroup>
  );
}

export function AccountsPage({ categories, baseCurrency, dataVersion, hiddenHomeAccounts, onToggleHome, onChanged, onToast }: AccountsPageProps) {
  const { formatMoney } = useFinancialValues();
  const [accounts, setAccounts] = useState<ManagedAccount[]>([]);
  const [groups, setGroups] = useState<AccountGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [busy, setBusy] = useState(false);

  // Add sheet
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newOff, setNewOff] = useState(false);
  const [newBalance, setNewBalance] = useState('');
  const [newGroup, setNewGroup] = useState('');

  // Group sheet (new / rename / delete)
  const [groupSheet, setGroupSheet] = useState<{ mode: 'new' } | { mode: 'edit'; group: AccountGroup } | null>(null);
  const [groupName, setGroupName] = useState('');
  const [confirmDeleteGroup, setConfirmDeleteGroup] = useState(false);

  // Manage sheet
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editOff, setEditOff] = useState(false);
  const [confirmKind, setConfirmKind] = useState(false);
  const [closing, setClosing] = useState(false);
  const [transferTo, setTransferTo] = useState('');
  const [transferCat, setTransferCat] = useState('');
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [linkIssuer, setLinkIssuer] = useState('');
  const [linkKind, setLinkKind] = useState<'card' | 'account' | 'wallet'>('card');
  const [linkLast4, setLinkLast4] = useState('');

  const money = useCallback((cents: number) => formatMoney(cents / 100, baseCurrency), [baseCurrency, formatMoney]);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<{ accounts: ManagedAccount[]; groups?: AccountGroup[] }>('/api/accounts');
      setAccounts(res.accounts);
      setGroups(res.groups || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load accounts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, dataVersion]);

  const open = accounts.filter((a) => !a.closed);
  const groupIds = new Set(groups.map((g) => g.id));
  const ungrouped = open.filter((a) => !a.account_group_id || !groupIds.has(a.account_group_id));
  const closed = accounts.filter((a) => a.closed);
  const selected = accounts.find((a) => a.id === selectedId) || null;
  const expenseCategories = useMemo(() => categories.filter((c) => !c.is_income && !c.hidden), [categories]);

  function openManage(a: ManagedAccount) {
    setSelectedId(a.id);
    setEditName(a.name);
    setEditOff(a.offbudget);
    setConfirmKind(false);
    setClosing(false);
    setTransferTo('');
    setTransferCat('');
    setSheetError(null);
    setLinkIssuer('');
    setLinkKind('card');
    setLinkLast4('');
  }

  async function run(action: () => Promise<unknown>, success: string, after?: () => void) {
    setBusy(true);
    setSheetError(null);
    try {
      await action();
      after?.();
      onChanged(success);
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong';
      setSheetError(msg);
      onToast(msg, 'error');
    } finally {
      setBusy(false);
    }
  }

  function createAccount(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    const bal = newBalance.trim() ? Number(newBalance) : 0;
    if (!name) return setSheetError('Give the account a name.');
    if (!Number.isFinite(bal)) return setSheetError('Starting balance must be a number.');
    void run(
      () => apiFetch('/api/accounts', { method: 'POST', body: JSON.stringify({ name, offbudget: newOff, initialBalance: bal, accountGroupId: newGroup || null }) }),
      `Added "${name}"`,
      () => {
        setAddOpen(false);
        setNewName('');
        setNewBalance('');
        setNewOff(false);
        setNewGroup('');
      },
    );
  }

  function saveName() {
    if (!selected) return;
    const name = editName.trim();
    if (!name || name === selected.name) return;
    void run(() => apiFetch(`/api/accounts/${selected.id}`, { method: 'PATCH', body: JSON.stringify({ name }) }), `Renamed to "${name}"`);
  }

  function moveToGroup(groupId: string) {
    if (!selected) return;
    const target = groups.find((g) => g.id === groupId);
    void run(
      () => apiFetch(`/api/accounts/${selected.id}`, { method: 'PATCH', body: JSON.stringify({ accountGroupId: groupId || null }) }),
      target ? `Moved ${selected.name} to ${target.name}` : `${selected.name} is no longer in a group`,
    );
  }

  function openGroupSheet(group?: AccountGroup) {
    setGroupSheet(group ? { mode: 'edit', group } : { mode: 'new' });
    setGroupName(group?.name || '');
    setConfirmDeleteGroup(false);
    setSheetError(null);
  }

  function saveGroup(e: React.FormEvent) {
    e.preventDefault();
    if (!groupSheet) return;
    const name = groupName.trim();
    if (!name) return setSheetError('Give the group a name.');
    if (groupSheet.mode === 'new') {
      void run(() => apiFetch('/api/accounts/groups', { method: 'POST', body: JSON.stringify({ name }) }), `Created "${name}"`, () => setGroupSheet(null));
    } else {
      if (name === groupSheet.group.name) return setGroupSheet(null);
      void run(
        () => apiFetch(`/api/accounts/groups/${groupSheet.group.id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
        `Renamed to "${name}"`,
        () => setGroupSheet(null),
      );
    }
  }

  function deleteGroup() {
    if (!groupSheet || groupSheet.mode !== 'edit') return;
    const g = groupSheet.group;
    void run(() => apiFetch(`/api/accounts/groups/${g.id}`, { method: 'DELETE' }), `Deleted "${g.name}"`, () => setGroupSheet(null));
  }

  function saveKind() {
    if (!selected) return;
    void run(
      () => apiFetch(`/api/accounts/${selected.id}`, { method: 'PATCH', body: JSON.stringify({ offbudget: editOff }) }),
      `${selected.name} is now a ${editOff ? 'tracking' : 'budget'} account`,
      () => setConfirmKind(false),
    );
  }

  const selectedBalance = selected?.workingBalance ?? 0;
  const target = accounts.find((a) => a.id === transferTo);
  const needsCategory = Boolean(selected && !selected.offbudget && target?.offbudget);
  const canClose = selectedBalance === 0 || (Boolean(transferTo) && (!needsCategory || Boolean(transferCat)));

  function closeAccount() {
    if (!selected) return;
    void run(
      () =>
        apiFetch(`/api/accounts/${selected.id}/close`, {
          method: 'POST',
          body: JSON.stringify(
            selectedBalance !== 0 ? { transferAccountId: transferTo, ...(needsCategory ? { transferCategoryId: transferCat } : {}) } : {},
          ),
        }),
      `Closed "${selected.name}"`,
      () => setSelectedId(null),
    );
  }

  function unlink(link: AccountLink) {
    void run(() => apiFetch(`/api/accounts/links/${encodeURIComponent(link.fingerprint)}`, { method: 'DELETE' }), `Unlinked ${link.label}`);
  }

  function addLink() {
    if (!selected) return;
    if (!linkIssuer.trim()) return setSheetError('Enter the bank, e.g. UOB.');
    if (!/^\d{4}$/.test(linkLast4)) return setSheetError('Enter the last 4 digits.');
    void run(
      () =>
        apiFetch(`/api/accounts/${selected.id}/links`, {
          method: 'POST',
          body: JSON.stringify({ issuer: linkIssuer.trim(), kind: linkKind, last4: linkLast4 }),
        }),
      `Linked ${linkIssuer.trim()} ••${linkLast4} to ${selected.name}`,
      () => {
        setLinkIssuer('');
        setLinkLast4('');
      },
    );
  }

  function toggleAutoImport(on: boolean) {
    if (!selected) return;
    void run(
      () => apiFetch(`/api/accounts/${selected.id}/prefs`, { method: 'PATCH', body: JSON.stringify({ autoImport: on }) }),
      on ? `Emails for ${selected.name} will import automatically` : `Emails for ${selected.name} will wait for review`,
    );
  }

  function reopenAccount() {
    if (!selected) return;
    void run(() => apiFetch(`/api/accounts/${selected.id}/reopen`, { method: 'POST' }), `Reopened "${selected.name}"`, () => setSelectedId(null));
  }

  const row = (a: ManagedAccount, i: number) => {
    const bal = a.workingBalance ?? 0;
    const onHome = !hiddenHomeAccounts.includes(a.id);
    return (
      <div
        key={a.id}
        className="flex items-center gap-1"
        style={{ borderTop: i === 0 ? 'none' : '1px solid var(--border-subtle)', opacity: a.closed ? 0.7 : 1 }}
      >
        {!a.closed && (
          <Label className="-ml-2 flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center" title="Show on Home">
            <Input
              variant="unstyled"
              type="checkbox"
              checked={onHome}
              onChange={(e) => onToggleHome(a.id, e.target.checked)}
              aria-label={`Show ${a.name} on Home`}
              className="h-5 w-5 cursor-pointer"
              style={{ accentColor: 'var(--accent)' }}
            />
          </Label>
        )}
        <Button type="button" onClick={() => openManage(a)} className="flex min-w-0 flex-1 items-center gap-3 py-3 text-left">
          <Tile colorKey={a.name} label={a.name} size={40} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="line-clamp-2 text-[15px] font-semibold leading-snug [overflow-wrap:anywhere]">{a.name}</span>
            <span className="truncate text-xs" style={{ color: 'var(--text-muted)' }}>
              {a.closed ? 'Closed' : a.offbudget ? 'Tracking' : 'Budget'}
              {!a.closed && !onHome && ' · hidden from Home'}
              {a.links.length > 0 && ` · ${a.links.filter((l) => l.kind !== 'alert').length || a.links.length} linked`}
              {a.linkedHoldings > 0 && (
                <>
                  {' · '}
                  {a.linkedHoldings} holding{a.linkedHoldings === 1 ? '' : 's'} synced
                </>
              )}
            </span>
          </span>
          <span className="text-[15px] font-bold tabular-nums" style={{ color: bal < 0 ? 'var(--negative)' : 'var(--text-primary)' }}>
            {money(bal)}
          </span>
          <ChevronRight className="h-4 w-4 shrink-0" style={{ color: 'var(--text-muted)' }} />
        </Button>
      </div>
    );
  };

  const section = (title: string, list: ManagedAccount[], group?: AccountGroup) => (
    <section key={group?.id ?? title} className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 px-1">
        <div className="flex min-w-0 items-center gap-1">
          <h2 className="truncate text-[15px] font-extrabold">{title}</h2>
          {group && (
            <Button
              type="button"
              onClick={() => openGroupSheet(group)}
              aria-label={`Rename or delete ${group.name}`}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
              style={{ color: 'var(--text-muted)' }}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
        <span className="shrink-0 text-sm tabular-nums" style={{ color: 'var(--text-muted)' }}>
          {money(list.reduce((sum, a) => sum + (a.workingBalance ?? 0), 0))}
        </span>
      </div>
      <div className="flex flex-col rounded-3xl px-4" style={{ backgroundColor: 'var(--bg-surface)' }}>
        {list.length ? (
          list.map(row)
        ) : (
          <p className="py-4 text-sm" style={{ color: 'var(--text-muted)' }}>
            No accounts yet. Tap an account and choose this group to move it here.
          </p>
        )}
      </div>
    </section>
  );

  const groupSelect = (id: string, value: string, onChange: (v: string) => void) => (
    <div>
      <Label htmlFor={id} className="mb-1 block text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>
        Group
      </Label>
      <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <NativeSelectOption value="">No group</NativeSelectOption>
        {groups.map((g) => (
          <NativeSelectOption key={g.id} value={g.id}>
            {g.name}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  );

  return (
    <Collapsible open={showClosed} onOpenChange={setShowClosed} className="flex flex-col gap-5">
      <Button
        type="button"
        onClick={() => {
          setSheetError(null);
          setAddOpen(true);
        }}
        variant="default" className="flex h-12 items-center justify-center gap-2 rounded-2xl text-[15px]"
      >
        <Plus className="h-5 w-5" />
        Add account
      </Button>

      <div className="-mt-2 flex items-start justify-between gap-3 px-1">
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Ticked accounts appear on Home. Tap an account to rename, regroup, switch type or close it.
        </p>
        <Button type="button" onClick={() => openGroupSheet()} className="flex shrink-0 items-center gap-1 text-sm font-bold" style={{ color: 'var(--accent-text)' }}>
          <FolderPlus className="h-4 w-4" />
          New group
        </Button>
      </div>

      {error && (
        <p className="rounded-2xl p-4 text-sm font-semibold" style={{ backgroundColor: 'var(--warning-soft)', color: 'var(--warning)' }}>
          {error}
        </p>
      )}
      {loading && accounts.length === 0 && !error && (
        <Skeleton className="h-48 rounded-3xl" aria-busy="true" />
      )}

      {!loading && !error && (
        <>
          {groups.map((g) => section(g.name, open.filter((a) => a.account_group_id === g.id), g))}
          {(ungrouped.length > 0 || groups.length === 0) && section(groups.length ? 'No group' : 'Accounts', ungrouped)}
          {closed.length > 0 && (
            <>
              <CollapsibleTrigger className="self-center text-sm font-bold" style={{ color: 'var(--accent-text)' }}>
                {showClosed ? 'Hide closed accounts' : `Show ${closed.length} closed account${closed.length === 1 ? '' : 's'}`}
              </CollapsibleTrigger>
              {showClosed && <CollapsibleContent asChild>{section('Closed', closed)}</CollapsibleContent>}
            </>
          )}
        </>
      )}

      {/* ---------- Add account ---------- */}
      <Sheet financialForm open={addOpen} onClose={() => setAddOpen(false)} title="Add account" subtitle="Creates the account in Actual">
        <form onSubmit={createAccount} className="flex flex-col gap-4">
          <div>
            <Label htmlFor="acc-name" className="mb-1 block text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>
              Name
            </Label>
            <Input id="acc-name" autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Everyday Savings" maxLength={100} />
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>
              Type
            </span>
            <Segmented value={newOff} onChange={setNewOff} label="Account type" />
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {newOff ? KIND_HELP.tracking : KIND_HELP.budget}
            </p>
          </div>
          {groups.length > 0 && groupSelect('acc-group', newGroup, setNewGroup)}
          <div>
            <Label htmlFor="acc-balance" className="mb-1 block text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>
              Starting balance ({baseCurrency})
            </Label>
            <Input
              id="acc-balance"
              inputMode="decimal"
              value={newBalance}
              onChange={(e) => setNewBalance(e.target.value)}
              placeholder="0.00"
              className="tabular-nums"
            />
            <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
              Use a negative number for a credit card or loan you owe on.
            </p>
          </div>
          {sheetError && (
            <Alert as="p" variant="destructive">
              {sheetError}
            </Alert>
          )}
          <Button type="submit" disabled={busy} variant="default" className="h-12 rounded-2xl text-[15px] disabled:opacity-50">
            {busy ? 'Adding…' : 'Add account'}
          </Button>
        </form>
      </Sheet>

      {/* ---------- Manage account ---------- */}
      <Sheet open={Boolean(selected)} onClose={() => setSelectedId(null)} title={selected?.name || 'Account'} subtitle={selected ? `Balance ${money(selectedBalance)}` : undefined}>
        {selected && (
          <div className="flex flex-col gap-5">
            {selected.closed ? (
              <div className="flex flex-col gap-3">
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  This account is closed. Reopening brings it back into Actual with its history intact.
                </p>
                <Button type="button" disabled={busy} onClick={reopenAccount} variant="default" className="h-12 rounded-2xl text-[15px] disabled:opacity-50">
                  {busy ? 'Reopening…' : 'Reopen account'}
                </Button>
              </div>
            ) : (
              <>
                {/* Rename */}
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="acc-edit-name" className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>
                    Name
                  </Label>
                  <div className="flex gap-2">
                    <Input id="acc-edit-name" value={editName} onChange={(e) => setEditName(e.target.value)} maxLength={100} />
                    <Button
                      type="button"
                      onClick={saveName}
                      disabled={busy || !editName.trim() || editName.trim() === selected.name}
                      variant="secondary" className="shrink-0 rounded-xl px-4 text-sm font-bold disabled:opacity-40"
                    >
                      Save
                    </Button>
                  </div>
                </div>

                {groupSelect('acc-edit-group', selected.account_group_id || '', moveToGroup)}

                {/* Budget vs tracking */}
                <div className="flex flex-col gap-2">
                  <span className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>
                    Type
                  </span>
                  <Segmented
                    value={editOff}
                    onChange={(v) => {
                      setEditOff(v);
                      setConfirmKind(v !== selected.offbudget);
                    }}
                    label="Account type"
                  />
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {editOff ? KIND_HELP.tracking : KIND_HELP.budget}
                  </p>
                  {confirmKind && (
                    <div className="flex flex-col gap-3 rounded-2xl p-3.5" style={{ backgroundColor: 'var(--warning-soft)' }}>
                      <p className="flex gap-2 text-xs leading-relaxed" style={{ color: 'var(--warning)' }}>
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>
                          {editOff
                            ? 'Its past transactions will stop counting toward your budget, so spending in earlier months and your To budget amount will change.'
                            : 'Its past transactions will start counting toward your budget. Uncategorized ones will need categories, and earlier months may change.'}{' '}
                          Actual’s own app doesn’t offer this switch for existing accounts; closing this one and adding a new account is the cautious alternative.
                        </span>
                      </p>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          onClick={() => {
                            setEditOff(selected.offbudget);
                            setConfirmKind(false);
                          }}
                          variant="secondary" className="h-10 flex-1 rounded-xl text-sm font-bold"
                        >
                          Cancel
                        </Button>
                        <Button type="button" disabled={busy} onClick={saveKind} variant="default" className="h-10 flex-1 rounded-xl text-sm disabled:opacity-50">
                          {busy ? 'Switching…' : `Make it ${editOff ? 'tracking' : 'budget'}`}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Email import: linked cards/accounts + auto-import */}
                <div className="flex flex-col gap-3 border-t pt-4" style={{ borderColor: 'var(--border-subtle)' }}>
                  <div>
                    <h3 className="text-sm font-extrabold">Email import</h3>
                    <p className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                      Bank alerts from these go to {selected.name}. Kopi learns them the first time you review one.
                    </p>
                  </div>
                  {selected.links.length === 0 ? (
                    <p className="rounded-xl px-3 py-2.5 text-xs" style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-muted)' }}>
                      Nothing linked yet.
                    </p>
                  ) : (
                    <div className="flex flex-col rounded-2xl px-3" style={{ backgroundColor: 'var(--bg-subtle)' }}>
                      {selected.links.map((l, i) => (
                        <div key={l.fingerprint} className="flex items-center gap-2.5 py-2.5" style={{ borderTop: i === 0 ? 'none' : '1px solid var(--border-subtle)' }}>
                          <CreditCard className="h-4 w-4 shrink-0" style={{ color: 'var(--text-muted)' }} />
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate text-sm font-semibold">{l.label}</span>
                            <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                              {l.kind === 'alert' ? 'Alert type' : l.source === 'manual' ? 'Added by you' : 'Learned from a review'}
                              {l.conflicts > 0 ? ' · used for different accounts, always reviewed' : ''}
                            </span>
                          </span>
                          <Button
                            type="button"
                            onClick={() => unlink(l)}
                            disabled={busy}
                            aria-label={`Unlink ${l.label}`}
                            className="flex h-9 w-9 items-center justify-center rounded-full"
                            style={{ color: 'var(--text-muted)' }}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="grid grid-cols-[1fr_auto_5.5rem] gap-2">
                    <Input
                      aria-label="Bank"
                      list="known-issuers"
                      value={linkIssuer}
                      onChange={(e) => setLinkIssuer(e.target.value)}
                      placeholder="Bank"
                    />
                    <datalist id="known-issuers">
                      {KNOWN_ISSUERS.map((b) => (
                        <NativeSelectOption key={b} value={b} />
                      ))}
                    </datalist>
                    <NativeSelect aria-label="Type" value={linkKind} onChange={(e) => setLinkKind(e.target.value as 'card' | 'account' | 'wallet')} className="w-auto">
                      <NativeSelectOption value="card">Card</NativeSelectOption>
                      <NativeSelectOption value="account">Account</NativeSelectOption>
                      <NativeSelectOption value="wallet">Wallet</NativeSelectOption>
                    </NativeSelect>
                    <Input
                      aria-label="Last 4 digits"
                      inputMode="numeric"
                      maxLength={4}
                      value={linkLast4}
                      onChange={(e) => setLinkLast4(e.target.value.replace(/\D/g, ''))}
                      placeholder="1234"
                      className="tabular-nums"
                    />
                  </div>
                  <Button type="button" onClick={addLink} disabled={busy} variant="secondary" className="h-10 rounded-xl text-sm font-bold disabled:opacity-50">
                    Link card or account
                  </Button>
                  <Switch
                    checked={selected.autoImport}
                    onCheckedChange={toggleAutoImport}
                    disabled={busy}
                    className="flex items-center justify-between gap-3 rounded-2xl px-3 py-3 text-left"
                    style={{ backgroundColor: 'var(--bg-subtle)' }}
                  >
                    <span className="flex flex-col">
                      <span className="text-sm font-bold">Import automatically</span>
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        Skip review when a linked card’s email is read cleanly. Foreign-currency and transfer emails still wait for you.
                      </span>
                    </span>
                    <SwitchThumb className="shrink-0" />
                  </Switch>
                </div>

                {/* Close */}
                <div className="flex flex-col gap-3 border-t pt-4" style={{ borderColor: 'var(--border-subtle)' }}>
                  {!closing ? (
                    <Button
                      type="button"
                      onClick={() => setClosing(true)}
                      className="h-12 rounded-2xl text-[15px] font-bold"
                      style={{ backgroundColor: 'var(--negative-soft)', color: 'var(--negative)' }}
                    >
                      Close account…
                    </Button>
                  ) : (
                    <>
                      <h3 className="text-sm font-extrabold">Close {selected.name}</h3>
                      <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                        Closed accounts keep their history but disappear from your lists. You can reopen it later.
                      </p>
                      {selected.linkedHoldings > 0 && (
                        <p className="rounded-xl px-3 py-2 text-xs" style={{ backgroundColor: 'var(--warning-soft)', color: 'var(--warning)' }}>
                          {selected.linkedHoldings} portfolio holding{selected.linkedHoldings === 1 ? ' syncs' : 's sync'} into this account. Unlink {selected.linkedHoldings === 1 ? 'it' : 'them'} in Invest so syncing doesn’t fail.
                        </p>
                      )}
                      {selectedBalance !== 0 && (
                        <>
                          <div>
                            <Label htmlFor="acc-transfer" className="mb-1 block text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>
                              Move the remaining {money(selectedBalance)} to
                            </Label>
                            <NativeSelect id="acc-transfer" value={transferTo} onChange={(e) => setTransferTo(e.target.value)}>
                              <NativeSelectOption value="">Choose an account…</NativeSelectOption>
                              {open
                                .filter((a) => a.id !== selected.id)
                                .map((a) => (
                                  <NativeSelectOption key={a.id} value={a.id}>
                                    {a.name} ({a.offbudget ? 'tracking' : 'budget'})
                                  </NativeSelectOption>
                                ))}
                            </NativeSelect>
                          </div>
                          {needsCategory && (
                            <div>
                              <Label htmlFor="acc-transfer-cat" className="mb-1 block text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>
                                Category for money leaving the budget
                              </Label>
                              <NativeSelect id="acc-transfer-cat" value={transferCat} onChange={(e) => setTransferCat(e.target.value)}>
                                <NativeSelectOption value="">Choose a category…</NativeSelectOption>
                                {expenseCategories.map((c) => (
                                  <NativeSelectOption key={c.id} value={c.id}>
                                    {c.name}
                                  </NativeSelectOption>
                                ))}
                              </NativeSelect>
                            </div>
                          )}
                        </>
                      )}
                      <div className="flex gap-2">
                        <Button type="button" onClick={() => setClosing(false)} variant="secondary" className="h-12 flex-1 rounded-2xl text-sm font-bold">
                          Keep open
                        </Button>
                        <Button
                          type="button"
                          disabled={busy || !canClose}
                          onClick={closeAccount}
                          className="h-12 flex-1 rounded-2xl text-sm font-bold disabled:opacity-40"
                          style={{ backgroundColor: 'var(--negative)', color: 'var(--bg-canvas)' }}
                        >
                          {busy ? 'Closing…' : 'Close account'}
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              </>
            )}
            {sheetError && (
              <Alert as="p" variant="destructive">
                {sheetError}
              </Alert>
            )}
          </div>
        )}
      </Sheet>

      {/* ---------- New / edit group ---------- */}
      <Sheet
        open={Boolean(groupSheet)}
        onClose={() => setGroupSheet(null)}
        title={groupSheet?.mode === 'edit' ? 'Edit group' : 'New group'}
        subtitle="Groups are shared with the sidebar in Actual"
      >
        {groupSheet && (
          <form onSubmit={saveGroup} className="flex flex-col gap-4">
            <div>
              <Label htmlFor="group-name" className="mb-1 block text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>
                Name
              </Label>
              <Input
                id="group-name"
                autoFocus
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="e.g. Savings"
                maxLength={60}
              />
            </div>
            {sheetError && (
              <Alert as="p" variant="destructive">
                {sheetError}
              </Alert>
            )}
            <Button type="submit" disabled={busy} variant="default" className="h-12 rounded-2xl text-[15px] disabled:opacity-50">
              {busy ? 'Saving…' : groupSheet.mode === 'edit' ? 'Save' : 'Create group'}
            </Button>
            {groupSheet.mode === 'edit' && (
              <div className="flex flex-col gap-3 border-t pt-4" style={{ borderColor: 'var(--border-subtle)' }}>
                {!confirmDeleteGroup ? (
                  <Button
                    type="button"
                    onClick={() => setConfirmDeleteGroup(true)}
                    className="h-12 rounded-2xl text-[15px] font-bold"
                    style={{ backgroundColor: 'var(--negative-soft)', color: 'var(--negative)' }}
                  >
                    Delete group…
                  </Button>
                ) : (
                  <>
                    <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                      The accounts in “{groupSheet.group.name}” stay as they are and become ungrouped. Nothing else changes.
                    </p>
                    <div className="flex gap-2">
                      <Button type="button" onClick={() => setConfirmDeleteGroup(false)} variant="secondary" className="h-12 flex-1 rounded-2xl text-sm font-bold">
                        Keep group
                      </Button>
                      <Button
                        type="button"
                        disabled={busy}
                        onClick={deleteGroup}
                        className="h-12 flex-1 rounded-2xl text-sm font-bold disabled:opacity-40"
                        style={{ backgroundColor: 'var(--negative)', color: 'var(--bg-canvas)' }}
                      >
                        {busy ? 'Deleting…' : 'Delete group'}
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}
          </form>
        )}
      </Sheet>
    </Collapsible>
  );
}
