'use client';

import { useCallback, useRef, useState } from 'react';
import { ApiError } from './api-client';

/**
 * A small form state hook. Values are controlled, `errors` holds per-field messages (from the
 * server's `fields` map, keyed by dotted path), and `formError` holds anything that is not
 * about one field. Submitting twice at once is ignored.
 */
export function useForm<T extends Record<string, unknown>>(initial: T) {
  const [values, setValues] = useState<T>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const busy = useRef(false);

  const set = useCallback(<K extends keyof T>(name: K, value: T[K]) => {
    setValues((v) => ({ ...v, [name]: value }));
    setErrors((e) => {
      if (!(name in e)) return e;
      const { [name as string]: _removed, ...rest } = e;
      void _removed;
      return rest;
    });
  }, []);

  const submit = useCallback(
    (action: (values: T) => Promise<unknown>) => async (event?: React.FormEvent) => {
      event?.preventDefault();
      if (busy.current) return;
      busy.current = true;
      setSubmitting(true);
      setErrors({});
      setFormError(null);
      try {
        await action(values);
      } catch (error) {
        if (error instanceof ApiError) {
          setErrors(error.fields);
          const has = Object.keys(error.fields).length > 0;
          setFormError(has ? 'Please check the highlighted fields.' : error.message);
        } else {
          setFormError('Something went wrong. Please try again.');
        }
      } finally {
        busy.current = false;
        setSubmitting(false);
      }
    },
    [values],
  );

  const reset = useCallback((next?: T) => {
    setValues(next ?? initial);
    setErrors({});
    setFormError(null);
  }, [initial]);

  return { values, set, setValues, errors, setErrors, formError, setFormError, submitting, submit, reset };
}
