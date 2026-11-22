import type { ComponentProps } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@client/lib/utils';

type SpinnerProps =
  | ({ variant: 'ring' } & ComponentProps<'div'>)
  | ({ variant?: 'icon' } & ComponentProps<typeof Loader2>);

function Spinner(props: SpinnerProps) {
  if (props.variant === 'ring') {
    const { variant, className, ...ringProps } = props;
    return (
      <div
        data-slot="spinner"
        role="status"
        aria-label="Loading"
        className={cn('h-7 w-7 animate-spin rounded-full border-2 border-primary border-t-transparent', className)}
        {...ringProps}
      />
    );
  }

  const { variant, className, ...iconProps } = props;
  return <Loader2 data-slot="spinner" aria-hidden="true" className={cn('h-4 w-4 animate-spin', className)} {...iconProps} />;
}

export { Spinner };
