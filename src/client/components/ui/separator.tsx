import type { ComponentProps } from 'react';
import { Separator as SeparatorPrimitive } from 'radix-ui';
import { cn } from '@client/lib/utils';

function Separator({ className, decorative = true, ...props }: ComponentProps<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      data-slot="separator"
      decorative={decorative}
      className={cn('bg-border data-[orientation=horizontal]:h-px data-[orientation=vertical]:w-px', className)}
      {...props}
    />
  );
}

export { Separator };
