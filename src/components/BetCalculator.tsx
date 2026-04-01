import React, { useMemo } from 'react';
import { Bucket } from '../types';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

interface BetCalculatorProps {
  selectedBuckets: Bucket[];
  budget: number;
  onBudgetChange: (val: number) => void;
}

export function BetCalculator({ selectedBuckets, budget, onBudgetChange }: BetCalculatorProps) {
  const stats = useMemo(() => {
    if (selectedBuckets.length === 0) return null;

    const totalUnitCost = selectedBuckets.reduce((sum, b) => sum + b.price, 0);
    if (totalUnitCost === 0) {
      return { totalUnitCost: 0, sharesPerBucket: 0, potentialPayout: 0, profit: 0, roi: 0, coverage: 0 };
    }
    const sharesPerBucket = budget / totalUnitCost;
    const potentialPayout = sharesPerBucket; // Each share pays $1 if it wins
    const profit = potentialPayout - budget;
    const roi = (profit / budget) * 100;
    const coverage = selectedBuckets.reduce((sum, b) => sum + b.price, 0) * 100;

    return {
      totalUnitCost,
      sharesPerBucket,
      potentialPayout,
      profit,
      roi,
      coverage
    };
  }, [selectedBuckets, budget]);

  const chartData = useMemo(() => {
    return selectedBuckets.map(b => ({
      name: b.name,
      value: b.price
    })).concat(
      selectedBuckets.length > 0 ? [{ name: 'Remaining', value: 1 - (stats?.totalUnitCost || 0) }] : []
    );
  }, [selectedBuckets, stats]);

  return (
    <div className="space-y-6">
      <div className="space-y-5 border border-ink bg-ink px-5 py-5 text-bg md:px-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-bg/45">Betting metrics</div>
            <div className="mt-2 text-xl font-medium">Intentional sizing rail for the current selection.</div>
          </div>
          <div className="text-right">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-bg/45">Selected</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{selectedBuckets.length}</div>
          </div>
        </div>

        <div className="space-y-2">
          <label htmlFor="budget-input" className="font-mono text-[10px] uppercase tracking-widest text-bg/55">Investment Budget ($)</label>
          <input
            id="budget-input"
            type="number"
            value={budget}
            onChange={(e) => onBudgetChange(parseFloat(e.target.value) || 0)}
            className="w-full border-b border-bg/30 bg-transparent py-3 font-mono text-3xl tabular-nums focus:border-bg focus:outline-none"
          />
        </div>

        {stats ? (
          <div className="grid grid-cols-2 gap-3 pt-2">
            <div className="space-y-1 border border-bg/15 bg-bg/6 px-3 py-3">
              <span className="font-mono text-[10px] uppercase text-bg/55">Potential Payout</span>
              <div className="text-xl font-medium">${stats.potentialPayout.toFixed(2)}</div>
            </div>
            <div className="space-y-1 border border-bg/15 bg-bg/6 px-3 py-3">
              <span className="font-mono text-[10px] uppercase text-bg/55">Net Profit</span>
              <div className="text-xl font-medium text-bg">
                {stats.profit > 0 ? '+' : ''}{stats.profit < 0 ? '−' : ''}${Math.abs(stats.profit).toFixed(2)}
              </div>
            </div>
            <div className="space-y-1 border border-bg/15 bg-bg/6 px-3 py-3">
              <span className="font-mono text-[10px] uppercase text-bg/55">ROI</span>
              <div className="text-xl font-medium">{stats.roi.toFixed(1)}%</div>
            </div>
            <div className="space-y-1 border border-bg/15 bg-bg/6 px-3 py-3">
              <span className="font-mono text-[10px] uppercase text-bg/55">Market Coverage</span>
              <div className="text-xl font-medium">{stats.coverage.toFixed(1)}%</div>
            </div>
          </div>
        ) : (
          <div className="border border-dashed border-bg/20 px-4 py-8 text-center font-serif italic text-bg/45">
            Select buckets to activate the sizing workspace.
          </div>
        )}
      </div>

      {selectedBuckets.length > 0 && (
        <div className="border border-ink/10 bg-ink/[0.03] p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] opacity-45">Selection shape</div>
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] opacity-35">Bucket cost split</div>
          </div>
        <div className="h-[200px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartData}
                innerRadius={60}
                outerRadius={80}
                paddingAngle={2}
                dataKey="value"
              >
                {chartData.map((entry, index) => (
                  <Cell 
                    key={`cell-${index}`} 
                    fill={entry.name === 'Remaining' ? '#00000010' : '#141414'} 
                  />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ backgroundColor: 'var(--bg)', border: '1px solid var(--ink)', color: 'var(--ink)', fontFamily: 'monospace', fontSize: '11px' }}
                formatter={(value: number) => [(value * 100).toFixed(1) + '%', '']}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        </div>
      )}
    </div>
  );
}
