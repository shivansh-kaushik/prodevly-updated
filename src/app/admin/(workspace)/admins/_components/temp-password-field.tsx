'use client';

import { useState } from 'react';
import { Check, Copy, RefreshCw } from 'lucide-react';
import { Field, Input } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { generateTempPassword } from './temp-password';

/** The temporary password a superadmin hands to someone. They must change it at first sign-in. */
export function TempPasswordField({ value, onChange, error, label = 'Temporary password' }: { value: string; onChange: (v: string) => void; error?: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Field label={label} error={error} hint="Shown only here. Pass it to the person yourself; they must change it at their first sign-in." required>
      {(c) => (
        <div className="flex gap-2">
          <Input {...c} type="text" autoComplete="off" spellCheck={false} className="font-pd-mono" value={value} onChange={(e) => { onChange(e.target.value); setCopied(false); }} />
          <Button variant="secondary" aria-label="Generate a random password" title="Generate" onClick={() => { onChange(generateTempPassword()); setCopied(false); }}>
            <RefreshCw className="size-4" aria-hidden />
          </Button>
          <Button
            variant="secondary"
            aria-label="Copy password"
            title="Copy"
            disabled={!value}
            onClick={async () => {
              await navigator.clipboard.writeText(value);
              setCopied(true);
            }}
          >
            {copied ? <Check className="size-4 text-pd-credit" aria-hidden /> : <Copy className="size-4" aria-hidden />}
          </Button>
        </div>
      )}
    </Field>
  );
}
