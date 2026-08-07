import { GlassCard } from '../components/ui/GlassCard';

export function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="type-display-sm">{title}</h1>
      <GlassCard>
        <p className="text-text-secondary">
          This module ships in a later roadmap phase. Navigation is wired now so
          the shell matches the product structure.
        </p>
      </GlassCard>
    </div>
  );
}
