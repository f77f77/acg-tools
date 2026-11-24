/** Assign nearby markers to different rows while keeping their exact position on the axis. */
export function placeSpeedMarkers(speeds: number[], min: number, max: number, width: number) {
  const lastInLane: number[] = [];
  return speeds
    .map((speed, index) => ({ speed, index }))
    .sort((a, b) => a.speed - b.speed)
    .map(({ speed, index }) => {
      const x = (speed - min) / (max - min) * width;
      const available = lastInLane.findIndex((last) => x - last >= 38);
      const lane = available < 0 ? lastInLane.length : available;
      lastInLane[lane] = x;
      return { index, lane };
    });
}

export function speedTickValues(min: number, max: number, width: number): number[] {
  const steps = [25, 50, 100, 200, 500];
  const distance = max - min;
  const minimumStep = distance * 90 / Math.max(1, width);
  const step = steps.find((value) => value >= minimumStep) ?? Math.ceil(minimumStep / 500) * 500;
  const ticks = [min];
  for (let value = Math.ceil(min / step) * step; value < max; value += step) {
    if (value - min >= step / 2 && max - value >= step / 2) ticks.push(value);
  }
  return [...ticks, max];
}
