import { clearDemoContext, getDemoContext } from './demoContext.js';
import { rewardPresentation } from './rewardContent.js';
import { ARMAP_MAP_URL } from './campaignEntry.js';

const context = getDemoContext();
if (!context) {
  window.location.replace('/');
} else {
  document.getElementById('treasure').textContent = context.treasure;
  const reward = document.getElementById('reward');
  const note = document.getElementById('note');
  const presentation = rewardPresentation(context);
  reward.hidden = presentation.reward === null;
  reward.textContent = presentation.reward || '';
  note.textContent = presentation.note;
  const back = document.getElementById('back-to-map');
  back.href = ARMAP_MAP_URL;
  back.addEventListener('click', () => clearDemoContext());
}
