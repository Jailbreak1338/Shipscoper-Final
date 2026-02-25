'use client';

import { useState, useTransition } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { joinWaitlist } from '@/app/actions/waitlist';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function WaitlistForm() {
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    const fd = new FormData(e.currentTarget);

    startTransition(async () => {
      const result = await joinWaitlist(fd);
      if (result.success) {
        setSuccess(true);
      } else {
        setError(result.error ?? 'Ein Fehler ist aufgetreten.');
      }
    });
  };

  if (success) {
    return (
      <div className="flex items-center gap-2.5 text-signal">
        <CheckCircle2 className="h-5 w-5 shrink-0" />
        <span className="text-base font-medium">Du bist auf der Liste – wir melden uns!</span>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3 w-full max-w-md">
      <Input
        type="email"
        name="email"
        placeholder="deine@email.de"
        required
        disabled={isPending}
        className="flex-1 h-11 text-base bg-white/5 border-white/10 focus-visible:border-signal/50"
        autoComplete="email"
      />
      <Button
        type="submit"
        disabled={isPending}
        className="h-11 px-6 bg-signal hover:bg-signal/90 text-ink font-semibold whitespace-nowrap"
      >
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          'Frühzeitigen Zugang sichern'
        )}
      </Button>
      {error && (
        <p className="text-sm text-destructive sm:col-span-2">{error}</p>
      )}
    </form>
  );
}
