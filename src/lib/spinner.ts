/**
 * The geometry and the opacity curve of an eight-spoke activity indicator.
 *
 * Pure and free of react-native so it can be tested without a device. The
 * component that consumes it does nothing but position Views and drive one
 * shared clock.
 *
 * Why hand-drawn rather than `ActivityIndicator`: that component renders
 * Android's Material circular progress, a single sweeping arc. This app is iOS
 * throughout, and iOS uses a ring of fading spokes. They read as different
 * things, and a Material spinner inside an otherwise iOS button is the single
 * most obvious tell that an app is Android wearing a costume.
 *
 * Why not SVG: banned in this project. `react-native-svg` throws
 * `synchronouslyUpdateUIProps` inside any Reanimated-animated view and kills
 * touch on the subtree, so every shape here is drawn with Views and borders, the
 * same rule `src/components/Icon.tsx` follows.
 */

/**
 * Eight, not twelve.
 *
 * UIKit uses twelve. Twelve capsules is twelve Views per spinner, and a spinner
 * appears inside buttons that can be on screen three at a time. Eight is the
 * smallest count where the rotation still reads as a rotation rather than as a
 * cluster of blinking marks, which is what six looks like at this size.
 */
export const SPOKES = 8;

/** Where one spoke sits, as a rotation in degrees from twelve o'clock. */
export function spokeAngle(index: number): number {
  return (360 / SPOKES) * index;
}

/**
 * How bright one spoke is at a given point in the cycle.
 *
 * `progress` runs 0 to 1 across one revolution. The spoke that is currently
 * "leading" is fully opaque and the others fall away behind it, which is what
 * makes the ring look like it is turning rather than pulsing.
 *
 * The falloff is linear rather than eased on purpose. An eased tail bunches the
 * bright spokes together and the indicator reads as a rotating blob; linear keeps
 * the spacing even, which is what UIKit's looks like.
 *
 * `MIN_OPACITY` is not zero. At zero the dimmest spoke disappears and the ring
 * becomes a gap-toothed arc, and the eye reads the gap as the thing that is
 * moving.
 */
export const MIN_OPACITY = 0.18;

export function spokeOpacity(index: number, progress: number): number {
  /*
   * `'worklet'` is load-bearing and its absence is a hard crash, not a warning.
   *
   * This is called from inside `useAnimatedStyle`, which runs on the UI runtime.
   * Without the directive Reanimated treats an ordinary imported function as a
   * *remote* function and throws
   * `[Worklets] Tried to synchronously call a Remote Function` the first frame the
   * spinner renders, taking the whole app down.
   *
   * Nothing in the test suite can see this: jest imports the module into the JS
   * runtime where the function is perfectly callable, so all eight unit tests
   * below pass against code that crashes on a device. It was found by opening the
   * screen.
   *
   * The directive does not stop it being an ordinary function: the babel plugin
   * compiles a UI-runtime copy and leaves the JS one alone, which is why the
   * maths stays testable here rather than being inlined into the component.
   */
  'worklet';
  // Distance behind the leading spoke, wrapped, as a fraction of a revolution.
  const lead = progress * SPOKES;
  const behind = (lead - index + SPOKES) % SPOKES;
  const fade = 1 - behind / SPOKES;
  return MIN_OPACITY + (1 - MIN_OPACITY) * fade;
}

/**
 * Spoke dimensions for a given overall diameter, in points.
 *
 * Proportions taken from UIKit's medium indicator (20pt) and kept as ratios so
 * one spinner can serve a button, a sheet and a row without three sets of magic
 * numbers. The spoke is a capsule: `length` along the radius, `thickness`
 * across, and `radius` is half the thickness so the ends are round.
 */
export function spokeMetrics(diameter: number): {
  length: number;
  thickness: number;
  radius: number;
  inset: number;
} {
  const thickness = Math.max(1.5, Math.round(diameter * 0.11 * 2) / 2);
  const length = Math.round(diameter * 0.28 * 2) / 2;
  return {
    length,
    thickness,
    radius: thickness / 2,
    // How far the inner end of a spoke sits from the centre. Without a hole the
    // eight capsules overlap into a solid disc at small sizes.
    inset: Math.round(diameter * 0.2 * 2) / 2,
  };
}
