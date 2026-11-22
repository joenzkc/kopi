import type { ComponentProps } from 'react';
import { cn } from '@client/lib/utils';

function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea data-slot="textarea" className={cn('input-field', className)} {...props} />;
}

export { Textarea };
