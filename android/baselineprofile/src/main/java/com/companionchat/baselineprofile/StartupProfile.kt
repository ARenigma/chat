package com.companionchat.baselineprofile

import androidx.benchmark.macro.junit4.BaselineProfileRule
import org.junit.Rule
import org.junit.Test

/**
 * Records what the app actually loads on a cold start.
 *
 * `collect` runs the block several times, watching which classes and methods the
 * runtime resolves, and writes the union to
 * `app/src/internal/generated/baselineProfiles/baseline-prof.txt`.
 *
 * **Startup only, deliberately.** The obvious next step is to script the whole
 * onboarding into this block so the profile covers the flow as well. That is
 * wrong here for now: this app's first screen mounts a Hermes bundle and three
 * radial gradients, so cold start is where the cost is, and every extra
 * interaction in the block widens the profile with classes that are not on the
 * critical path. A wider profile is not a better one — it dilutes the DEX layout
 * benefit by putting less-used classes next to the ones that matter.
 *
 * `startActivityAndWait` waits for the first frame, which for React Native means
 * the JS bundle has loaded and the first view has been mounted. That is the
 * boundary worth profiling; stopping at `startActivity` would record the native
 * launch and none of the framework.
 */
class StartupProfile {
    @get:Rule
    val rule = BaselineProfileRule()

    @Test
    fun startup() = rule.collect(
        packageName = "com.companionchat",
        /*
         * This flag is worth more than everything else in this file.
         * https://developer.android.com/topic/performance/baselineprofiles/dex-layout-optimizations
         *
         * Without it the run produces only `baseline-prof.txt`, which tells ART
         * what to AOT-compile. With it the run ALSO produces
         * `startup-prof.txt`, which tells R8 how to lay the DEX out so every
         * class touched during launch sits together in `classes.dex`. Google
         * measures that second file as a further 15-30% off startup on top of
         * the baseline profile, because it cuts page faults rather than JIT
         * work — and page faults are what actually hurt on the mid-range Android
         * hardware this ships to.
         *
         * DEX layout optimisation is on by default from AGP 8.3; this project is
         * on 8.12, so the flag is the only missing piece. The first generation
         * run here omitted it and left the larger half of the win on the table.
         */
        includeInStartupProfile = true,
    ) {
        pressHome()
        startActivityAndWait()
    }
}
