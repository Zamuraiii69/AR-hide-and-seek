// distanceGate.js — "move back a little", with hysteresis.
//
// Seek mode blocks the view when the camera gets too close, so the game is
// "spot it from a normal viewing distance" rather than "inspect it pixel by
// pixel" (plan-phase5 §5.2). Distances are in marker widths — see
// anchorPick.cameraDistance — so no calibration is needed for print size.
//
// Two thresholds, not one. A single threshold flickers the overlay on and off
// while the player stands still at the boundary, which is worse than no gate.
// Engage below ENGAGE, release only above RELEASE.
//
// Deliberately free of three and the DOM so the ramp can be asserted in node.
// It is also NOT applied in hide mode: the hider must get close to paint detail.
// That asymmetry is intended — do not "fix" it by sharing one threshold.

export const ENGAGE_BELOW = 0.8;
export const RELEASE_ABOVE = 0.95;

export function createDistanceGate({ engageBelow = ENGAGE_BELOW, releaseAbove = RELEASE_ABOVE } = {}) {
  if (!(releaseAbove > engageBelow)) {
    throw new Error(`releaseAbove (${releaseAbove}) must exceed engageBelow (${engageBelow})`);
  }
  let gated = false;

  return {
    get gated() { return gated; },

    /**
     * Feed one distance sample. Returns true only when the state CHANGED, so
     * callers can touch the DOM on transitions instead of every frame.
     * A non-finite distance (lost anchor) holds the current state.
     */
    update(distance) {
      if (!Number.isFinite(distance)) return false;
      const next = gated ? distance < releaseAbove : distance < engageBelow;
      const changed = next !== gated;
      gated = next;
      return changed;
    },

    /** Drop the gate — used when the anchor is lost or the hunt ends. */
    reset() {
      const changed = gated;
      gated = false;
      return changed;
    },
  };
}
