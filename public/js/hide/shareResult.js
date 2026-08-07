import { isDemoContext } from '../demoContext.js';

export async function shareAndHandleResult({ share, payload, context, goToReward }) {
  try {
    await share(payload);
  } catch (error) {
    if (error?.name === 'AbortError') return 'cancelled';
    throw error;
  }
  if (isDemoContext(context)) {
    goToReward('/reward.html');
    return 'reward';
  }
  return 'shared';
}
