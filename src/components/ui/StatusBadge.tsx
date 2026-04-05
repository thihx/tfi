import type { StatusBadgeInfo } from '@/types';
import { STATUS_BADGES } from '@/config/constants';

interface StatusBadgeProps {
  status: string;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const info: StatusBadgeInfo = STATUS_BADGES[status] || { label: status, class: '' };
  if (info.hidden) return null;
  return <span className={`badge ${info.class}`}>{info.label}</span>;
}
