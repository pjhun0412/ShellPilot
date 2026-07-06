import { Boxes } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ActivityId } from '@/types/workspace';
import { activities } from './activities';

export function ActivityBar({
  activeActivity,
  isSidebarCollapsed,
  onSelectActivity,
}: {
  activeActivity: ActivityId;
  isSidebarCollapsed: boolean;
  onSelectActivity: (activityId: ActivityId) => void;
}) {
  return (
    <aside className="flex min-h-0 flex-col items-center justify-between border-r bg-background/95 py-2">
      <div className="flex flex-col items-center gap-1">
        {activities.map((activity) => {
          const Icon = activity.icon;
          const isActive = !isSidebarCollapsed && activeActivity === activity.id;

          return (
            <Button
              className={cn('size-9', isActive && 'bg-accent text-accent-foreground')}
              size="icon"
              variant="ghost"
              type="button"
              key={activity.id}
              title={activity.label}
              aria-label={activity.label}
              onClick={() => onSelectActivity(activity.id)}
            >
              <Icon />
            </Button>
          );
        })}
      </div>
      <Button
        className="size-9"
        variant="ghost"
        size="icon"
        type="button"
        title="Extensions"
        aria-label="Extensions"
      >
        <Boxes />
      </Button>
    </aside>
  );
}
