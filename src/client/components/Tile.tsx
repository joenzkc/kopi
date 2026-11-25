import React from 'react';
import { ArrowLeftRight } from 'lucide-react';
import { Avatar } from '@client/components/ui/avatar';
import { tileStyle } from '../lib/theme';

interface TileProps {
  /** Label that picks the colour (usually the category name). */
  colorKey: string | null | undefined;
  /** Text whose first letter is shown. */
  label: string;
  size?: number;
  transfer?: boolean;
}

/** Rounded category/payee tile: colour follows the Appearance "Category icons" setting. */
export function Tile({ colorKey, label, size = 42, transfer = false }: TileProps) {
  const style = transfer
    ? { backgroundColor: 'var(--bg-subtle)', color: 'var(--text-primary)' }
    : tileStyle(colorKey || label);
  return (
    <Avatar
      aria-hidden="true"
      className="items-center justify-center font-bold"
      style={{ ...style, width: size, height: size, borderRadius: Math.round(size / 3), fontSize: Math.round(size * 0.36) }}
    >
      {transfer ? <ArrowLeftRight className="h-4 w-4" /> : (label.trim().charAt(0) || '?').toUpperCase()}
    </Avatar>
  );
}
