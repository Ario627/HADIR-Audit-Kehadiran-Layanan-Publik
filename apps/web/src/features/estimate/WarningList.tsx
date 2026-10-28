import { knownWarnings } from '../../lib/estimate';

export interface WarningListProps {
  codes: readonly string[];
}

export function WarningList({ codes }: WarningListProps) {
  const items = knownWarnings(codes);
  if (items.length === 0) {
    return null;
  }
  return (
    <ul className="warnings">
      {items.map((item) => (
        <li key={item.code}>{item.text}</li>
      ))}
    </ul>
  );
}