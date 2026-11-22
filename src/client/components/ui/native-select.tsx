import type { ComponentProps } from 'react';
import { cn } from '@client/lib/utils';

// Keep the browser's picker and arrow so desktop and touch use the same control as before.
function NativeSelect({ className, variant = 'default', ...props }: ComponentProps<'select'> & { variant?: 'default' | 'unstyled' }) {
  return (
    <select
      data-slot="native-select"
      className={variant === 'unstyled' ? className : cn('input-field', className)}
      {...props}
    />
  );
}

function NativeSelectOption(props: ComponentProps<'option'>) {
  return <option data-slot="native-select-option" {...props} />;
}

function NativeSelectOptGroup(props: ComponentProps<'optgroup'>) {
  return <optgroup data-slot="native-select-optgroup" {...props} />;
}

export { NativeSelect, NativeSelectOptGroup, NativeSelectOption };
