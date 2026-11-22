import type { ComponentProps } from 'react';
import { Switch as SwitchPrimitive } from 'radix-ui';
import { cn } from '@client/lib/utils';

function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return <SwitchPrimitive.Root data-slot="switch" className={cn('group/switch', className)} {...props} />;
}

function SwitchThumb({ className }: { className?: string }) {
  return (
    <span
      data-slot="switch-track"
      className={cn(
        'flex h-7 w-12 justify-start rounded-full bg-accent p-[3px] transition group-data-[state=checked]/switch:justify-end group-data-[state=checked]/switch:bg-primary',
        className,
      )}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="h-[22px] w-[22px] rounded-full bg-muted-foreground data-[state=checked]:bg-primary-foreground"
      />
    </span>
  );
}

export { Switch, SwitchThumb };
