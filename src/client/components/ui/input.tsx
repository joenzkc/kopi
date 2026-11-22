import type { ComponentProps } from 'react';
import { cn } from '@client/lib/utils';

function Input({ className, type, variant = 'default', ...props }: ComponentProps<'input'> & { variant?: 'default' | 'unstyled' }) {
  return (
    <input
      type={type}
      data-slot="input"
      className={variant === 'unstyled' ? className : cn('input-field', className)}
      {...props}
    />
  );
}

export { Input };
