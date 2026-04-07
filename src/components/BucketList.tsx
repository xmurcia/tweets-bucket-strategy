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
    <div className="border-t border-ink/15" aria-label="Outcome buckets">
      <div className="hidden md:block" role="table" aria-label="Outcome buckets desktop table">
        <div className="grid grid-cols-[48px_minmax(0,1.7fr)_0.8fr_0.8fr_0.6fr] border-b border-ink/10 bg-ink/[0.04] px-4 py-3" role="row">
          <div role="columnheader" className="font-mono text-[10px] uppercase tracking-[0.18em] opacity-45">Sel</div>
          <div role="columnheader" className="font-mono text-[10px] uppercase tracking-[0.18em] opacity-45">Outcome Bucket</div>
          <div role="columnheader" className="text-right font-mono text-[10px] uppercase tracking-[0.18em] opacity-45">Ask ($)</div>
          <div role="columnheader" className="text-right font-mono text-[10px] uppercase tracking-[0.18em] opacity-45">Ask Prob (%)</div>
          <div role="columnheader" className="text-right font-mono text-[10px] uppercase tracking-[0.18em] opacity-45">Spread</div>
        </div>

        <div className="space-y-2 pt-2" role="rowgroup">
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
                  "group grid grid-cols-[48px_minmax(0,1.7fr)_0.8fr_0.8fr_0.6fr] cursor-pointer items-center border px-4 py-4 transition-colors focus:outline-none focus:ring-2 focus:ring-ink focus:ring-inset",
                  isSelected ? "border-ink bg-ink text-bg" : "border-ink/10 bg-bg hover:border-ink/25 hover:bg-ink/[0.03]"
                )}
              >
                <div role="cell" className="flex justify-center">
                  <div
                    role="checkbox"
                    aria-checked={isSelected}
                    aria-label={`Select ${bucket.name}`}
                    className={cn(
                      "flex h-6 w-6 items-center justify-center border transition-colors",
                      isSelected ? "border-bg bg-bg text-ink" : "border-ink/20 group-hover:border-ink"
                    )}
                  >
                    {isSelected && <Check className="h-3 w-3" aria-hidden="true" />}
                  </div>
                </div>
                <div role="cell" className="min-w-0 space-y-1">
                  <div className="break-words font-sans font-medium">{bucket.name}</div>
                  <div className={cn("font-mono text-[10px] uppercase tracking-[0.16em]", isSelected ? "text-bg/55" : "text-ink/40")}>
                    Click to {isSelected ? 'remove' : 'add'}
                  </div>
                </div>
                <div role="cell" className="text-right font-mono text-sm tabular-nums">${bucket.price.toFixed(3)}</div>
                <div role="cell" className="text-right font-mono text-sm tabular-nums">{(bucket.price * 100).toFixed(1)}%</div>
                <div role="cell" className="text-right font-mono text-sm tabular-nums">{bucket.spread !== undefined ? `${bucket.spread.toFixed(1)}%` : '--'}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="space-y-2 pt-2 md:hidden" role="list" aria-label="Outcome buckets mobile list">
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
                "group cursor-pointer space-y-3 border p-4 transition-colors focus:outline-none focus:ring-2 focus:ring-ink focus:ring-inset",
                isSelected ? "border-ink bg-ink text-bg" : "border-ink/10 bg-bg hover:border-ink/25 hover:bg-ink/[0.03]"
              )}
            >
              <div className="flex items-start gap-3">
                <div
                  role="checkbox"
                  aria-checked={isSelected}
                  aria-label={`Select ${bucket.name}`}
                  className={cn(
                    "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center border transition-colors",
                    isSelected ? "border-bg bg-bg text-ink" : "border-ink/20 group-hover:border-ink"
                  )}
                >
                  {isSelected && <Check className="h-3 w-3" aria-hidden="true" />}
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="font-sans text-sm font-medium leading-tight break-words">{bucket.name}</div>
                  <div className={cn("font-mono text-[10px] uppercase tracking-[0.16em]", isSelected ? "text-bg/55" : "text-ink/40")}>
                    Tap to {isSelected ? 'remove' : 'add'}
                  </div>
                  <div className="grid grid-cols-3 gap-2 font-mono text-xs">
                    <div>
                      <span className="block text-[10px] uppercase tracking-wide opacity-50">Ask</span>
                      <span>${bucket.price.toFixed(3)}</span>
                    </div>
                    <div className="text-right">
                      <span className="block text-[10px] uppercase tracking-wide opacity-50">Prob</span>
                      <span>{(bucket.price * 100).toFixed(1)}%</span>
                    </div>
                    <div className="text-right">
                      <span className="block text-[10px] uppercase tracking-wide opacity-50">Spread</span>
                      <span>{bucket.spread !== undefined ? `${bucket.spread.toFixed(1)}%` : '--'}</span>
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
