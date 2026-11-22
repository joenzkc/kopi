import type { ComponentProps } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import { cn } from '@client/lib/utils';

const buttonVariants = cva('', {
  variants: {
    variant: {
      unstyled: '',
      default: 'btn-primary',
      secondary: 'btn-secondary',
    },
  },
  defaultVariants: { variant: 'unstyled' },
});

function Button({
  className,
  variant = 'unstyled',
  asChild = false,
  ...props
}: ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'button';

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      className={variant === 'unstyled' ? className : cn(buttonVariants({ variant, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
