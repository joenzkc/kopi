import type { ComponentProps } from 'react';
import { Toggle as TogglePrimitive } from 'radix-ui';

function Toggle(props: ComponentProps<typeof TogglePrimitive.Root>) {
  return <TogglePrimitive.Root data-slot="toggle" {...props} />;
}

export { Toggle };
