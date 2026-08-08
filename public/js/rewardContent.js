export function rewardPresentation(context) {
  if (context.claim === 'earned') {
    return { reward: `+${context.reward} เหรียญ`, note: 'เหรียญถูกบันทึกใน LINEARmap แล้ว' };
  }
  return { reward: null, note: 'รับรางวัลของ portal นี้แล้ววันนี้' };
}
