export function bindPointer(el, { start, move, end }) {
  el.style.touchAction = 'none';
  el.style.userSelect = 'none';
  const controller = new AbortController();
  const options = { signal: controller.signal };
  let pointerId = null;
  let beganAt = 0;
  let beganX = 0;
  let beganY = 0;

  const finish = (event, cancelled = false) => {
    if (event.pointerId !== pointerId) return;
    const distance = Math.hypot(event.clientX - beganX, event.clientY - beganY);
    const tap = !cancelled && distance < 12 && performance.now() - beganAt < 600;
    pointerId = null;
    end?.(event, { tap, cancelled });
  };
  el.addEventListener('pointerdown', (event) => {
    if (!event.isPrimary || pointerId !== null) return;
    pointerId = event.pointerId; beganAt = performance.now(); beganX = event.clientX; beganY = event.clientY;
    el.setPointerCapture(pointerId); start?.(event);
  }, options);
  el.addEventListener('pointermove', (event) => {
    if (event.pointerId !== pointerId) return;
    for (const point of event.getCoalescedEvents?.() || [event]) move?.(point);
  }, options);
  el.addEventListener('pointerup', (event) => finish(event), options);
  el.addEventListener('pointercancel', (event) => finish(event, true), options);
  el.addEventListener('lostpointercapture', (event) => finish(event, true), options);
  return () => controller.abort();
}
