import React, { useState } from 'react';
import { apiFetch } from '../../lib/api';
import { Sheet } from '../Sheet';
import { Button } from '@client/components/ui/button';
import { Input } from '@client/components/ui/input';
import { Label } from '@client/components/ui/label';
import { Select } from '@client/components/ui/select';
import { Alert } from '@client/components/ui/alert';

export type NewBudgetItem = { kind: 'category'; groupId: string } | { kind: 'group' };

interface NewBudgetItemSheetProps {
  item: NewBudgetItem;
  /** Expense groups a new category can go in. */
  groups: Array<{ id: string; name: string }>;
  onClose: () => void;
  /** Called after Actual created it; `id` is null when the server didn't report one. */
  onCreated: (message: string, created: { kind: NewBudgetItem['kind']; id: string | null }) => void;
}

const labelStyle = { color: 'var(--text-muted)' };

/** Small create form for a budget category ("bucket") or a category group. */
export function NewBudgetItemSheet({ item, groups, onClose, onCreated }: NewBudgetItemSheetProps) {
  const isCategory = item.kind === 'category';
  const [name, setName] = useState('');
  const [groupId, setGroupId] = useState(item.kind === 'category' ? item.groupId : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = name.trim();
  const groupName = groups.find((g) => g.id === groupId)?.name;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!trimmed) return setError(isCategory ? 'Name the category' : 'Name the group');
    if (isCategory && !groupId) return setError('Pick a group');
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{ id?: string | null }>(isCategory ? '/api/budget/categories' : '/api/budget/category-groups', {
        method: 'POST',
        body: JSON.stringify(isCategory ? { name: trimmed, groupId } : { name: trimmed }),
      });
      onCreated(isCategory ? `Added ${trimmed} to ${groupName ?? 'your budget'}` : `Added the ${trimmed} group`, {
        kind: item.kind,
        id: typeof res?.id === 'string' ? res.id : null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={isCategory ? 'New category' : 'New group'}
      subtitle={isCategory ? 'A bucket you can budget money into' : 'Groups hold related categories'}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-budget-name" className="text-label" style={labelStyle}>
            Name
          </Label>
          <Input
            id="new-budget-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={isCategory ? 'e.g. Gifts' : 'e.g. Savings goals'}
            autoComplete="off"
            maxLength={100}
            autoFocus
          />
        </div>

        {isCategory && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-budget-group" className="text-label" style={labelStyle}>
              Group
            </Label>
            <Select
              id="new-budget-group"
              aria-label="Group"
              value={groupId}
              onValueChange={setGroupId}
              options={groups.map((g) => ({ value: g.id, label: g.name }))}
              placeholder="Pick a group"
            />
          </div>
        )}

        {error && (
          <Alert as="p" variant="destructive">
            {error}
          </Alert>
        )}

        <Button type="submit" variant="default" disabled={busy || !trimmed} className="h-12 w-full rounded-2xl text-body disabled:opacity-50">
          {busy ? 'Adding…' : isCategory ? 'Add category' : 'Add group'}
        </Button>
      </form>
    </Sheet>
  );
}
