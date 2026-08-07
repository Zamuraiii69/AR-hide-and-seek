import { clearDemoContext, getDemoContext } from './demoContext.js';
import { rewardPresentation } from './rewardContent.js';

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
  document.getElementById('open-oa').addEventListener('click', () => clearDemoContext());
}
