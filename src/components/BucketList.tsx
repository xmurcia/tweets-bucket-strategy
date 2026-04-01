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
    <div className="border-t border-ink" aria-label="Outcome buckets">
      <div className="hidden md:block" role="table" aria-label="Outcome buckets desktop table">
        <div className="grid grid-cols-[40px_minmax(0,1.5fr)_1fr_1fr] border-b border-ink/20 bg-ink/5 p-3" role="row">
          <div role="columnheader" className="font-serif italic text-[11px] opacity-50 uppercase">Sel</div>
          <div role="columnheader" className="font-serif italic text-[11px] opacity-50 uppercase">Outcome Bucket</div>
          <div role="columnheader" className="font-serif italic text-[11px] opacity-50 uppercase text-right">Ask ($)</div>
          <div role="columnheader" className="font-serif italic text-[11px] opacity-50 uppercase text-right">Ask Prob (%)</div>
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
                  "group grid grid-cols-[40px_minmax(0,1.5fr)_1fr_1fr] cursor-pointer items-center p-4 transition-colors focus:outline-none focus:ring-2 focus:ring-ink focus:ring-inset",
                  isSelected ? "bg-ink text-bg" : "hover:bg-ink/5"
                )}
              >
                <div role="cell" className="flex justify-center">
                  <div
                    role="checkbox"
                    aria-checked={isSelected}
                    aria-label={`Select ${bucket.name}`}
                    className={cn(
                      "flex h-5 w-5 items-center justify-center border transition-colors",
                      isSelected ? "border-bg bg-bg text-ink" : "border-ink/30 group-hover:border-ink"
                    )}
                  >
                    {isSelected && <Check className="h-3 w-3" aria-hidden="true" />}
                  </div>
                </div>
                <div role="cell" className="min-w-0 font-sans font-medium break-words">{bucket.name}</div>
                <div role="cell" className="text-right font-mono text-sm">${bucket.price.toFixed(3)}</div>
                <div role="cell" className="text-right font-mono text-sm">{(bucket.price * 100).toFixed(1)}%</div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="divide-y divide-ink/10 md:hidden" role="list" aria-label="Outcome buckets mobile list">
        {buckets.map((bucket) => {
          const isSelected = selectedIds.has(bucket.id);
          return (
            <div
              key={bucket.id}
              role="listitem"
              tabIndex={0}
              aria-selected={isSelected}
              onClick={() => onToggle(bucket.id)}
              onKeyDown={(e) => handleKeyDown(e, bucket.id)}
              className={cn(
                "group cursor-pointer space-y-3 p-3 transition-colors focus:outline-none focus:ring-2 focus:ring-ink focus:ring-inset",
                isSelected ? "bg-ink text-bg" : "hover:bg-ink/5"
              )}
            >
              <div className="flex items-start gap-3">
                <div
                  role="checkbox"
                  aria-checked={isSelected}
                  aria-label={`Select ${bucket.name}`}
                  className={cn(
                    "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center border transition-colors",
                    isSelected ? "border-bg bg-bg text-ink" : "border-ink/30 group-hover:border-ink"
                  )}
                >
                  {isSelected && <Check className="h-3 w-3" aria-hidden="true" />}
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="font-sans text-sm font-medium leading-tight break-words">{bucket.name}</div>
                  <div className="grid grid-cols-2 gap-2 font-mono text-xs">
                    <div>
                      <span className="block text-[10px] uppercase tracking-wide opacity-50">Ask</span>
                      <span>${bucket.price.toFixed(3)}</span>
                    </div>
                    <div className="text-right">
                      <span className="block text-[10px] uppercase tracking-wide opacity-50">Prob</span>
                      <span>{(bucket.price * 100).toFixed(1)}%</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
