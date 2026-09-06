package com.companionchat.baselineprofile

import android.hardware.display.DisplayManager
import android.view.Display
import androidx.benchmark.macro.BaselineProfileMode
import androidx.benchmark.macro.CompilationMode
import androidx.benchmark.macro.FrameTimingMetric
import androidx.benchmark.macro.MacrobenchmarkScope
import androidx.benchmark.macro.junit4.MacrobenchmarkRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.filters.LargeTest
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.Until
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Frames for the four interactions the app is judged on by feel rather than by
 * function: the emoji↔keyboard swap, the attach panel opening, a tab switch,
 * and a chat push and pop.
 *
 * These are the journeys that were repeatedly reported as janky by eye and
 * repeatedly "fixed" without a number. `CriticalJourneyBenchmark` already
 * covers the home fling and opening a chat; this covers the surface swaps,
 * which is where the artefact frames were.
 *
 * ---------------------------------------------------------------------------
 * The 120 Hz precondition, and why it is an assumption and not a warning
 * ---------------------------------------------------------------------------
 * The thresholds this exists to feed are 120 Hz thresholds: a P95 inside
 * 8.3 ms. On a 60 Hz panel every frame has 16.7 ms to play with, so the same
 * code passes trivially and the run means nothing while looking like a pass.
 * A Galaxy S22 also reports 60 Hz until "Motion smoothness" is set to Adaptive
 * in Settings — so the most likely cause of a 60 Hz reading is not the hardware,
 * it is an unset toggle (recorded in docs/android-audit.md's measurement
 * protocol).
 *
 * `assumeTrue` therefore SKIPS rather than fails: a skipped benchmark is
 * honest about having no data, where a green one on the wrong panel is a lie.
 *
 * The gate itself is not asserted here. Macrobenchmark writes its numbers to
 * `benchmarkData.json` and `scripts/benchmark-gate.mjs` enforces
 * P95 < 8.3 ms, P99 < 16.7 ms and `frameOverrunMs` P95 ≤ 0 against that file,
 * so the thresholds live in one place instead of being duplicated per test.
 *
 * ---------------------------------------------------------------------------
 * Running it
 * ---------------------------------------------------------------------------
 * Needs a PHYSICAL device with the internal app already signed in and a chat in
 * the rail — like `CriticalJourneyBenchmark`, it does not manufacture fixtures,
 * because a synthetic transcript does not produce the frames a real one does.
 *
 *   npm run android:benchmark:feel -- \
 *     -Pandroid.testInstrumentationRunnerArguments.providerId=<uuid>
 *
 * Setup stays outside the measured block: only the swap or transition itself
 * contributes frames.
 *
 * https://developer.android.com/topic/performance/benchmarking/macrobenchmark-overview
 * https://developer.android.com/topic/performance/benchmarking/macrobenchmark-metrics
 * https://developer.android.com/reference/android/view/Display#getRefreshRate()
 */
@LargeTest
@RunWith(AndroidJUnit4::class)
class FeelBenchmark {
    @get:Rule
    val rule = MacrobenchmarkRule()

    private lateinit var providerId: String

    @Before
    fun requireFastPanelAndFixture() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val display =
            (context.getSystemService(DisplayManager::class.java))
                ?.getDisplay(Display.DEFAULT_DISPLAY)
        val hz = display?.refreshRate ?: 0f
        assumeTrue(
            "Panel reports ${hz}Hz. These are 120Hz thresholds, so a 60Hz run would " +
                "pass on slack rather than on merit. On a Galaxy S22 set Settings > " +
                "Display > Motion smoothness to Adaptive and re-run; see the " +
                "measurement protocol in docs/android-audit.md.",
            hz >= MIN_REFRESH_HZ,
        )

        providerId =
            InstrumentationRegistry.getArguments().getString("providerId").orEmpty()
        assumeTrue(
            "Pass providerId for a seeded conversation; feel benchmarks do not run " +
                "against synthetic data.",
            providerId.isNotBlank(),
        )
    }

    /**
     * Keyboard → emoji panel → keyboard. The swap that produced a visible
     * artefact frame on every tap, and the one the docked-surface model
     * (ADR-0027) exists to make stationary.
     */
    @Test
    fun emojiSwapFrames() =
        measureInChat { scope ->
            scope.device.findObject(By.res("composer-input"))?.click()
            scope.device.wait(Until.hasObject(By.res("composer-emoji")), TIMEOUT_MS)
            repeat(3) {
                scope.device.findObject(By.res("composer-emoji"))?.click()
                scope.device.wait(Until.hasObject(By.res("emoji-panel")), TIMEOUT_MS)
                scope.device.findObject(By.res("composer-emoji"))?.click()
                scope.device.waitForIdle(IDLE_MS)
            }
        }

    /**
     * The attach panel arriving in the same docked slot. Separate from the emoji
     * swap because it mounts a live CameraX preview, which is a different cost.
     */
    @Test
    fun attachOpenFrames() =
        measureInChat { scope ->
            repeat(3) {
                scope.device.findObject(By.res("composer-attach"))?.click()
                scope.device.wait(Until.hasObject(By.res("attach-panel")), TIMEOUT_MS)
                scope.device.pressBack()
                scope.device.waitForIdle(IDLE_MS)
            }
        }

    /**
     * Home ↔ You. A tab switch is a cross-fade between two mounted layers, so
     * this measures the fade rather than a mount — which is the point: the tabs
     * were made permanently mounted precisely to take the mount out of it.
     */
    @Test
    fun tabSwitchFrames() =
        measure { scope ->
            scope.device.wait(Until.hasObject(By.desc("Home")), TIMEOUT_MS)
            repeat(4) {
                scope.device.findObject(By.desc("You"))?.click()
                scope.device.waitForIdle(IDLE_MS)
                scope.device.findObject(By.desc("Home"))?.click()
                scope.device.waitForIdle(IDLE_MS)
            }
        }

    /**
     * Push into a chat and pop back out, repeatedly. The bottom bar is now kept
     * mounted across this transition rather than rebuilt, so a regression here
     * is the first place that would show.
     */
    @Test
    fun chatPushPopFrames() =
        measure { scope ->
            repeat(3) {
                scope.device.findObject(By.res("rail-$providerId"))?.click()
                scope.device.wait(Until.hasObject(By.res("chat-title")), TIMEOUT_MS)
                scope.device.findObject(By.res("chat-back"))?.click()
                scope.device.wait(Until.hasObject(By.desc("Home")), TIMEOUT_MS)
            }
        }

    /** Measures from Home, with the app already launched and idle. */
    private fun measure(interaction: (MacrobenchmarkScope) -> Unit) {
        rule.measureRepeated(
            packageName = PACKAGE_NAME,
            metrics = listOf(FrameTimingMetric()),
            compilationMode =
                CompilationMode.Partial(
                    baselineProfileMode = BaselineProfileMode.Require,
                ),
            iterations = ITERATIONS,
            startupMode = null,
            setupBlock = {
                pressHome()
                startActivityAndWait()
                device.waitForIdle(IDLE_MS)
            },
        ) {
            interaction(this)
        }
    }

    /**
     * Measures inside an open chat. Opening it is SETUP, not measurement — the
     * push has its own test, and folding it in here would put a route
     * transition's frames into a composer swap's numbers.
     */
    private fun measureInChat(interaction: (MacrobenchmarkScope) -> Unit) {
        rule.measureRepeated(
            packageName = PACKAGE_NAME,
            metrics = listOf(FrameTimingMetric()),
            compilationMode =
                CompilationMode.Partial(
                    baselineProfileMode = BaselineProfileMode.Require,
                ),
            iterations = ITERATIONS,
            startupMode = null,
            setupBlock = {
                pressHome()
                startActivityAndWait()
                device.wait(Until.findObject(By.res("rail-$providerId")), OPEN_MS)
                    ?.click()
                    ?: error("no chat in the rail for providerId=$providerId")
                check(device.wait(Until.hasObject(By.res("chat-title")), OPEN_MS)) {
                    "chat did not become usable"
                }
                device.waitForIdle(IDLE_MS)
            },
        ) {
            interaction(this)
        }
    }

    companion object {
        private const val PACKAGE_NAME = "com.companionchat"

        /**
         * 119, not 120: a panel in its fast mode reports a hair under, and
         * demanding exactly 120 would skip the very device this exists for.
         */
        private const val MIN_REFRESH_HZ = 119f
        private const val ITERATIONS = 10
        private const val TIMEOUT_MS = 5_000L
        private const val OPEN_MS = 20_000L
        private const val IDLE_MS = 2_000L
    }
}
