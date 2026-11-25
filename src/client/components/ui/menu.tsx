import type { ReactElement, ReactNode } from 'react';
import { Menu as BaseMenu } from '@base-ui/react/menu';
import { Check } from 'lucide-react';
import { cn } from '@client/lib/utils';

export type MenuEntry =
  | {
      type?: 'item';
      label: ReactNode;
      icon?: ReactNode;
      hint?: ReactNode;
      onSelect: () => void;
      destructive?: boolean;
      disabled?: boolean;
    }
  | { type: 'separator' }
  | { type: 'label'; label: string };

export interface MenuProps {
  /** The trigger element (a <button>), rendered via Base UI's `render` prop so it keeps its own styles. */
  trigger: ReactElement;
  items: MenuEntry[];
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'bottom';
}

/** Action menu (e.g. "Add ▾"). Opens from its trigger with a short ease-out scale/fade. */
export function Menu({ trigger, items, align = 'end', side = 'bottom' }: MenuProps) {
  return (
    <BaseMenu.Root>
      <BaseMenu.Trigger render={trigger} />
      <BaseMenu.Portal>
        <BaseMenu.Positioner className="pointer-events-auto z-[200] outline-none" sideOffset={6} align={align} side={side}>
          <BaseMenu.Popup className="popover-surface min-w-[12rem] max-w-[calc(100vw-2rem)] p-1.5">
            {items.map((item, i) => {
              if (item.type === 'separator') return <BaseMenu.Separator key={i} className="mx-2 my-1.5 h-px" style={{ backgroundColor: 'var(--border-subtle)' }} />;
              if (item.type === 'label')
                return (
                  <BaseMenu.Group key={i}>
                    <BaseMenu.GroupLabel className="px-3 pb-1 pt-2 text-caption" style={{ color: 'var(--text-muted)' }}>
                      {item.label}
                    </BaseMenu.GroupLabel>
                  </BaseMenu.Group>
                );
              return (
                <BaseMenu.Item
                  key={i}
                  disabled={item.disabled}
                  onClick={item.onSelect}
                  className={cn('popover-item', item.destructive && 'popover-item-destructive')}
                >
                  {item.icon && <span className="flex h-5 w-5 shrink-0 items-center justify-center [&_svg]:h-4 [&_svg]:w-4">{item.icon}</span>}
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.hint != null && (
                    <span className="shrink-0 text-caption tabular-nums" style={{ color: 'var(--text-muted)' }}>
                      {item.hint}
                    </span>
                  )}
                </BaseMenu.Item>
              );
            })}
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  );
}

export interface MenuChoice<V extends string> {
  value: V;
  label: ReactNode;
  hint?: ReactNode;
}

/** Single-choice menu (e.g. a filter). Shows a check next to the active choice. */
export function ChoiceMenu<V extends string>({
  trigger,
  value,
  onValueChange,
  choices,
  title,
  align = 'end',
}: {
  trigger: ReactElement;
  value: V;
  onValueChange: (value: V) => void;
  choices: MenuChoice<V>[];
  title?: string;
  align?: 'start' | 'center' | 'end';
}) {
  return (
    <BaseMenu.Root>
      <BaseMenu.Trigger render={trigger} />
      <BaseMenu.Portal>
        <BaseMenu.Positioner className="pointer-events-auto z-[200] outline-none" sideOffset={6} align={align}>
          <BaseMenu.Popup className="popover-surface min-w-[12rem] max-w-[calc(100vw-2rem)] p-1.5">
            <BaseMenu.RadioGroup value={value} onValueChange={(v) => onValueChange(v as V)}>
              {title && (
                <BaseMenu.GroupLabel className="px-3 pb-1 pt-2 text-caption" style={{ color: 'var(--text-muted)' }}>
                  {title}
                </BaseMenu.GroupLabel>
              )}
              {choices.map((c) => (
                <BaseMenu.RadioItem key={c.value} value={c.value} closeOnClick className="popover-item">
                  <span className="min-w-0 flex-1 truncate">{c.label}</span>
                  {c.hint != null && (
                    <span className="shrink-0 text-caption tabular-nums" style={{ color: 'var(--text-muted)' }}>
                      {c.hint}
                    </span>
                  )}
                  <span className="flex w-4 shrink-0 justify-center">
                    <BaseMenu.RadioItemIndicator>
                      <Check className="h-4 w-4" style={{ color: 'var(--accent-text)' }} />
                    </BaseMenu.RadioItemIndicator>
                  </span>
                </BaseMenu.RadioItem>
              ))}
            </BaseMenu.RadioGroup>
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  );
}
