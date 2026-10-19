import type { Tone } from '@/components/ui/badge';

/**
 * One map from every status word the app uses to a tone. Colour follows MEANING, not module:
 * credit = settled or healthy, amber = waiting or needs a look, rubric = failed, void or overdue,
 * blue = in motion, neutral = parked or finished without drama.
 */
const TONES: Record<string, Tone> = {
  // settled / healthy
  active: 'credit', received: 'credit', paid: 'credit', delivered: 'credit', done: 'credit', published: 'credit',
  won: 'credit', approved: 'credit', on_track: 'credit', converted: 'credit', reimbursed: 'credit', paid_in_full: 'credit',
  // waiting / needs a look
  due: 'amber', pending: 'amber', in_review: 'amber', at_risk: 'amber', submitted: 'amber', invoiced: 'amber',
  proposal_sent: 'amber', contacted: 'amber', qualified: 'amber', on_hold: 'amber', draft: 'amber', stale: 'amber',
  // failed / void / overdue
  void: 'rubric', rejected: 'rubric', cancelled: 'rubric', off_track: 'rubric', deactivated: 'rubric', blocked: 'rubric',
  spam: 'rubric', lost: 'rubric', overdue: 'rubric', urgent: 'rubric', locked: 'rubric',
  // in motion
  in_progress: 'blue', open: 'blue', proposal: 'blue', prospect: 'blue', new: 'blue', todo: 'blue', maintenance: 'blue',
  high: 'amber', medium: 'blue',
  // parked / finished
  backlog: 'neutral', paused: 'neutral', past: 'neutral', closed: 'neutral', archived: 'neutral', inactive: 'neutral', low: 'neutral',
};

export function statusTone(status: string): Tone {
  return TONES[status] ?? 'neutral';
}
