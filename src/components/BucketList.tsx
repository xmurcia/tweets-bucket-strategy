import React, { useCallback } from 'react';
import { Bucket } from '../types';
import { cn } from '../lib/utils';
import { Check } from 'lucide-react';

interface BucketListProps {
  buckets: Bucket[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
}

export function BucketList({ buckets, selectedIds, onToggle }: BucketListProps) {
  const handleKeyDown = useCallback((e: React.KeyboardEvent, bucketId: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onToggle(bucketId);
    }
  }, [onToggle]);

  return (
    <div className="border-t border-ink" role="table" aria-label="Outcome buckets">
      <div className="grid grid-cols-[40px_1.5fr_1fr_1fr] p-3 border-b border-ink/20 bg-ink/5" role="row">
        <div role="columnheader" className="font-serif italic text-[11px] opacity-50 uppercase">Sel</div>
        <div role="columnheader" className="font-serif italic text-[11px] opacity-50 uppercase">Outcome Bucket</div>
        <div role="columnheader" className="font-serif italic text-[11px] opacity-50 uppercase text-right">Price ($)</div>
        <div role="columnheader" className="font-serif italic text-[11px] opacity-50 uppercase text-right">Prob (%)</div>
      </div>

      <div className="divide-y divide-ink/10" role="rowgroup">
        {buckets.map((bucket) => {
          const isSelected = selectedIds.has(bucket.id);
          return (
            <div
              key={bucket.id}
              role="row"
              tabIndex={0}
              aria-selected={isSelected}
              onClick={() => onToggle(bucket.id)}
              onKeyDown={(e) => handleKeyDown(e, bucket.id)}
              className={cn(
                "grid grid-cols-[40px_1.5fr_1fr_1fr] p-4 items-center cursor-pointer transition-colors group focus:outline-none focus:ring-2 focus:ring-ink focus:ring-inset",
                isSelected ? "bg-ink text-bg" : "hover:bg-ink/5"
              )}
            >
              <div role="cell" className="flex justify-center">
                <div
                  role="checkbox"
                  aria-checked={isSelected}
                  aria-label={`Select ${bucket.name}`}
                  className={cn(
                    "w-5 h-5 border flex items-center justify-center transition-colors",
                    isSelected ? "border-bg bg-bg text-ink" : "border-ink/30 group-hover:border-ink"
                  )}
                >
                  {isSelected && <Check className="w-3 h-3" aria-hidden="true" />}
                </div>
              </div>
              <div role="cell" className="font-sans font-medium">{bucket.name}</div>
              <div role="cell" className="font-mono text-sm text-right">${bucket.price.toFixed(3)}</div>
              <div role="cell" className="font-mono text-sm text-right">{(bucket.price * 100).toFixed(1)}%</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
