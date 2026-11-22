import type { ComponentProps } from 'react';
import { Avatar as AvatarPrimitive } from 'radix-ui';
import { cn } from '@client/lib/utils';

function Avatar({ className, ...props }: ComponentProps<typeof AvatarPrimitive.Root>) {
  return <AvatarPrimitive.Root data-slot="avatar" className={cn('flex shrink-0', className)} {...props} />;
}

export { Avatar };
