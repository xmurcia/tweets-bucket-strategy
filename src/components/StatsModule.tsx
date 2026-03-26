import React, { useMemo } from 'react';
import { TrackingStats } from '../services/polymarket';
import { differenceInHours, parseISO } from 'date-fns';

interface StatsModuleProps {
  stats: TrackingStats;
}

export function StatsModule({ stats }: StatsModuleProps) {
  const calculations = useMemo(() => {
    const now = new Date();
    const end = parseISO(stats.endDate);
    const start = parseISO(stats.startDate);
    
    const remainingHours = Math.max(0, differenceInHours(end, now));
    const totalHours = Math.max(1, differenceInHours(end, start));
    const elapsedHours = totalHours - remainingHours;
    
    const dailyAvg = stats.daysElapsed > 0 ? stats.total / stats.daysElapsed : 0;
    const hourlyAvg = elapsedHours > 0 ? stats.total / elapsedHours : 0;
    
    // Proyección: Lo que lleva + (promedio por hora * horas restantes)
    const projection = stats.total + (hourlyAvg * remainingHours);
    
    return {
      remainingHours,
      dailyAvg,
      hourlyAvg,
      projection,
      progress: (elapsedHours / totalHours) * 100
    };
  }, [stats]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="border border-ink/10 p-4 bg-white/30">
        <span className="font-mono text-[10px] uppercase opacity-50 block mb-1">Current Velocity</span>
        <div className="text-xl font-medium">{calculations.dailyAvg.toFixed(1)} <span className="text-xs opacity-50">tweets/day</span></div>
        <div className="text-xs font-mono opacity-40 mt-1">{calculations.hourlyAvg.toFixed(2)} per hour</div>
      </div>
      
      <div className="border border-ink/10 p-4 bg-ink text-bg">
        <span className="font-mono text-[10px] uppercase opacity-50 block mb-1 text-bg/60">Expected Projection</span>
        <div className="text-2xl font-bold">{Math.round(calculations.projection).toLocaleString()}</div>
        <div className="text-[10px] font-mono opacity-60 mt-1 uppercase tracking-wider">Estimated Total</div>
      </div>

      <div className="border border-ink/10 p-4 bg-white/30">
        <span className="font-mono text-[10px] uppercase opacity-50 block mb-1">Time Remaining</span>
        <div className="text-xl font-medium">{calculations.remainingHours} <span className="text-xs opacity-50">hours left</span></div>
        <div className="w-full bg-ink/5 h-1 mt-2 overflow-hidden">
          <div 
            className="bg-ink h-full transition-all duration-1000" 
            style={{ width: `${calculations.progress}%` }} 
          />
        </div>
      </div>
    </div>
  );
}
