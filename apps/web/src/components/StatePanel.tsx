import type { ReactNode } from 'react';

export interface StatePanelProps {
  title: string;
  children?: ReactNode;
  tone?: 'neutral' | 'error';
}

export function StatePanel({ title, children, tone = 'neutral' }: StatePanelProps) {
  return (
    <div className={tone === 'error' ? 'state state--error' : 'state'} role={tone === 'error' ? 'alert' : undefined}>
      <p className="state-title">{title}</p>
      {children === undefined ? null : <p className="state-body">{children}</p>}
    </div>
  );
}