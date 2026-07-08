import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { AiProviderInfo } from './aiBridge';

export function AiProviderSelect({
  disabled,
  providers,
  triggerClassName = 'h-8 w-40 text-xs',
  value,
  onValueChange,
}: {
  disabled?: boolean;
  providers: AiProviderInfo[];
  triggerClassName?: string;
  value: string;
  onValueChange: (value: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger className={triggerClassName}>
        <SelectValue placeholder="Provider" />
      </SelectTrigger>
      <SelectContent>
        {providers.map((provider) => (
          <SelectItem disabled={!provider.available} key={provider.id} value={provider.id}>
            {provider.label}
            {!provider.available ? ' unavailable' : ''}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
