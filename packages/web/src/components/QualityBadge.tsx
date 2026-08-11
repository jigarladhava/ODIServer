import type { Quality } from '../lib/types';

const qualityStyles: Record<Quality, string> = {
  good: 'border-good bg-good-bg text-good',
  bad: 'border-bad bg-bad-bg text-bad',
  uncertain: 'border-uncertain bg-uncertain-bg text-uncertain',
};

const qualityLabels: Record<Quality, string> = {
  good: 'Good',
  bad: 'Bad',
  uncertain: 'Uncertain',
};

export function QualityBadge({ quality }: { quality: Quality }) {
  return (
    <span
      className={`inline-block rounded-sm border px-1.5 py-px text-[11px] font-medium leading-4 ${qualityStyles[quality]}`}
    >
      {qualityLabels[quality]}
    </span>
  );
}
