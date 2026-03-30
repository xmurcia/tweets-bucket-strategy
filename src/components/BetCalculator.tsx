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
      <div className="border border-ink p-6 space-y-4">
        <div className="space-y-2">
          <label htmlFor="budget-input" className="font-mono text-[10px] uppercase tracking-widest opacity-50">Investment Budget ($)</label>
          <input
            id="budget-input"
            type="number"
            value={budget}
            onChange={(e) => onBudgetChange(parseFloat(e.target.value) || 0)}
            className="w-full bg-transparent border-b border-ink py-2 font-mono text-2xl focus:outline-none focus:border-b-2"
          />
        </div>

        {stats ? (
          <div className="grid grid-cols-2 gap-4 pt-4">
            <div className="space-y-1">
              <span className="font-mono text-[10px] uppercase opacity-50">Potential Payout</span>
              <div className="text-xl font-medium">${stats.potentialPayout.toFixed(2)}</div>
            </div>
            <div className="space-y-1">
              <span className="font-mono text-[10px] uppercase opacity-50">Net Profit</span>
              <div className="text-xl font-medium text-ink">
                {stats.profit > 0 ? '+' : ''}{stats.profit < 0 ? '−' : ''}${Math.abs(stats.profit).toFixed(2)}
              </div>
            </div>
            <div className="space-y-1">
              <span className="font-mono text-[10px] uppercase opacity-50">ROI</span>
              <div className="text-xl font-medium">{stats.roi.toFixed(1)}%</div>
            </div>
            <div className="space-y-1">
              <span className="font-mono text-[10px] uppercase opacity-50">Market Coverage</span>
              <div className="text-xl font-medium">{stats.coverage.toFixed(1)}%</div>
            </div>
          </div>
        ) : (
          <div className="py-8 text-center font-serif italic opacity-40">
            Select buckets to calculate potential returns
          </div>
        )}
      </div>

      {selectedBuckets.length > 0 && (
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
      )}
    </div>
  );
}
