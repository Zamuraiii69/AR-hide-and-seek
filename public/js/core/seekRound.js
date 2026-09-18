// One seek round covers every hide on the marker, so each hide's row must carry
// only the taps spent before it was found. The taps after that were hunting the
// other hides; charging them here would raise a hide's average taps purely
// because it shared a marker with others.

/** Round taps ({u, v, hitId}) -> the {u, v, hit} list to record for one hide. */
export function tapsForItem(taps, itemId) {
  const hitIndex = taps.findIndex((tap) => tap.hitId === itemId);
  const spent = hitIndex === -1 ? taps : taps.slice(0, hitIndex + 1);
  return spent.map((tap) => ({ u: tap.u, v: tap.v, hit: tap.hitId === itemId }));
}
