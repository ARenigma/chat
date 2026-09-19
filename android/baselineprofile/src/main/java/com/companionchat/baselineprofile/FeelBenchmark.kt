package com.companionchat.baselineprofile

import android.hardware.display.DisplayManager
import android.os.SystemClock
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
import androidx.test.uiautomator.Direction
import androidx.test.uiautomator.UiObject2
import androidx.test.uiautomator.Until
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.util.regex.Pattern

/**
 * Frames for the V2 chat interactions the app is judged on by feel rather than
 * by function, plus the established tab-switch and production chat push/pop
 * journeys.
 *
 * These are the journeys that were repeatedly reported as janky by eye and
 * repeatedly "fixed" without a number. `CriticalJourneyBenchmark` already
 * covers the home fling and opening a production chat; this covers the V2
 * keyboard/list/composer contract directly.
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
 * Needs a PHYSICAL device with the internal app already signed in and a seeded
 * conversation with enough history to scroll. The internal build alone accepts
 * the explicit V2 route used by setup; release rejects that route in JS behind a
 * compile-time BuildConfig capability.
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
        check(PROVIDER_ID.matches(providerId)) {
            "providerId must be a canonical UUID for an isolated seeded conversation"
        }
    }

    /** Open and close the IME without folding route setup into the trace. */
    @Test
    fun imeOpenCloseFrames() =
        measureInV2Chat { scope ->
            scope.requireObject("chat-v2-input").click()
            scope.waitForIme(shown = true)
            scope.device.pressBack()
            scope.waitForIme(shown = false)
        }

    /**
     * Repeated interactive retraction. Coordinates come from the live list
     * bounds, not from a device-specific screen guess.
     */
    @Test
    fun repeatedInteractiveRetractFrames() =
        measureInV2Chat { scope ->
            val input = scope.requireObject("chat-v2-input")
            val list = scope.requireObject("chat-v2-list")
            repeat(3) {
                input.click()
                scope.waitForIme(shown = true)
                val bounds = list.visibleBounds
                scope.device.swipe(
                    bounds.centerX(),
                    bounds.top + bounds.height() / 3,
                    bounds.centerX(),
                    bounds.bottom - 1,
                    SWIPE_STEPS,
                )
                scope.waitForIme(shown = false)
            }
        }

    /** Grow the native text input through several lines. */
    @Test
    fun multilineComposerGrowthFrames() =
        measureInV2Chat { scope ->
            val input = scope.requireObject("chat-v2-input")
            val beforeHeight = input.visibleBounds.height()
            input.setText(MULTILINE_TEXT)
            val grown =
                scope.waitUntil("multiline composer growth") {
                    scope.findObject("chat-v2-input")
                        ?.takeIf { it.text == MULTILINE_TEXT && it.visibleBounds.height() > beforeHeight }
                }
            check(grown.visibleBounds.height() > beforeHeight) {
                "multiline composer did not grow"
            }
        }

    /** Jump from history to the newest row with the V2 control. */
    @Test
    fun pageDownJumpFrames() =
        measureInV2Chat(
            setup = { scrollAwayFromLatest() },
        ) { scope ->
            scope.requireObject("chat-v2-page-down").click()
            scope.waitUntilGone("chat-v2-page-down-visible")
            scope.requireObject("chat-v2-list")
        }

    /** Swap mic → send → mic without sending or persisting a real message. */
    @Test
    fun composerControlSwapFrames() =
        measureInV2Chat { scope ->
            val input = scope.requireObject("chat-v2-input")
            input.setText(CONTROL_TEXT)
            scope.waitUntil<UiObject2>("composer send control") {
                scope.findObject("chat-v2-send")
                    ?.takeIf { scope.requireObject("chat-v2-input").text == CONTROL_TEXT }
            }
            input.setText("")
            scope.waitUntil<UiObject2>("composer mic control") {
                scope.findObject("chat-v2-mic")
            }
            Unit
        }

    /**
     * Opening and retracting the IME while reading history must preserve the
     * same visible bubble within 4dp. The geometry assertion is deliberately
     * in the journey: a fast transition to the wrong anchor is still wrong.
     */
    @Test
    fun scrolledUpAnchorPreservationFrames() =
        measureInV2Chat(
            setup = { scrollAwayFromLatest() },
        ) { scope ->
            val anchor = scope.requireUniqueRowAnchor()
            val anchorResourceId =
                anchor.resourceName ?: error("V2 row anchor has no resource ID")
            val before = anchor.visibleBounds.top
            scope.requireObject("chat-v2-input").click()
            scope.waitForIme(shown = true)
            scope.device.pressBack()
            scope.waitForIme(shown = false)
            val after = scope.requireObject(anchorResourceId).visibleBounds.top
            val maxDriftPx =
                (MAX_ANCHOR_DRIFT_DP * InstrumentationRegistry.getInstrumentation()
                    .targetContext.resources.displayMetrics.density).toInt()
            check(kotlin.math.abs(after - before) <= maxDriftPx) {
                "V2 history anchor moved ${kotlin.math.abs(after - before)}px; " +
                    "allowed ${maxDriftPx}px (4dp)"
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
            scope.requireDescription("Home")
            repeat(4) {
                scope.requireDescription("You").click()
                scope.waitUntil<UiObject2>("You tab selected") {
                    scope.findObject("nav-settings")?.takeIf { it.isSelected }
                }
                scope.requireDescription("Home").click()
                scope.waitUntil<UiObject2>("Home tab selected") {
                    scope.findObject("nav-home")?.takeIf { it.isSelected }
                }
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
                scope.requireObject("rail-$providerId").click()
                scope.requireObject("chat-title")
                scope.requireObject("chat-back").click()
                scope.waitUntilGone("chat-title")
                scope.requireDescription("Home")
                scope.requireObject("home-scroll")
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
                killProcess()
                pressHome()
                startActivityAndWait()
                requireObject("home-scroll")
                waitForIme(shown = false)
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
    private fun measureInV2Chat(
        setup: MacrobenchmarkScope.() -> Unit = {},
        interaction: (MacrobenchmarkScope) -> Unit,
    ) {
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
                killProcess()
                pressHome()
                openV2ChatForSetup()
                resetV2State()
                setup()
                device.waitForIdle(IDLE_MS)
            },
        ) {
            interaction(this)
        }
    }

    /**
     * Explicit component launch means the custom URI does not need a browsable
     * manifest filter. The app still validates the complete URL and accepts it
     * only in debug or the internal benchmark artifact.
     */
    private fun MacrobenchmarkScope.openV2ChatForSetup() {
        device.executeShellCommand(
            "am start -W -a android.intent.action.VIEW " +
                "--ez benchmark_read_only true " +
                "-d companionchat://chat-v2/$providerId " +
                "-n $PACKAGE_NAME/.MainActivity",
        )
        check(device.wait(Until.hasObject(By.res("chat-v2-screen")), OPEN_MS)) {
            "internal V2 route did not become usable"
        }
        requireObject("chat-v2-list")
        requireObject("chat-v2-input")
    }

    private fun MacrobenchmarkScope.scrollAwayFromLatest() {
        val list = requireObject("chat-v2-list")
        check(list.isScrollable) {
            "chat-v2-list is not scrollable; seed enough real history"
        }
        repeat(3) {
            list.fling(Direction.DOWN)
            device.waitForIdle(IDLE_MS)
        }
        var marker =
            device.wait(
                Until.findObject(By.res("chat-v2-page-down-visible")),
                TIMEOUT_MS,
            )
        if (marker == null) {
            repeat(3) {
                list.fling(Direction.UP)
                device.waitForIdle(IDLE_MS)
            }
            marker =
                device.wait(
                    Until.findObject(By.res("chat-v2-page-down-visible")),
                    TIMEOUT_MS,
                )
        }
        check(marker != null) {
            "chat-v2-page-down-visible did not appear; seed more real history"
        }
        requireObject("chat-v2-page-down")
    }

    private fun MacrobenchmarkScope.resetV2State() {
        val input = requireObject("chat-v2-input")
        input.setText("")
        if (readImeInsets().visible) {
            device.pressBack()
        }
        waitForIme(shown = false)
        check(findObject("chat-v2-page-down-visible") == null) {
            "V2 route inherited a scrolled-away position after force-stop"
        }
        requireObject("chat-v2-mic")
    }

    private fun MacrobenchmarkScope.findObject(testId: String): UiObject2? =
        device.findObject(By.res(testId))

    private fun MacrobenchmarkScope.requireObject(testId: String): UiObject2 =
        device.wait(Until.findObject(By.res(testId)), TIMEOUT_MS)
            ?: error("required V2 testID is missing: $testId")

    private fun MacrobenchmarkScope.requireDescription(description: String): UiObject2 =
        device.wait(Until.findObject(By.desc(description)), TIMEOUT_MS)
            ?: error("required accessibility description is missing: $description")

    private fun MacrobenchmarkScope.requireUniqueRowAnchor(): UiObject2 {
        val listBounds = requireObject("chat-v2-list").visibleBounds
        val dockTop = requireObject("chat-v2-dock").visibleBounds.top
        return device.findObjects(By.res(ROW_ID_PATTERN))
            .firstOrNull { row ->
                row.resourceName?.contains("chat-v2-row-") == true &&
                    row.visibleBounds.top >= listBounds.top &&
                    row.visibleBounds.bottom <= dockTop
            }
            ?: error("no fully visible unique chat-v2-row-* anchor")
    }

    private fun MacrobenchmarkScope.waitForIme(shown: Boolean) {
        val deadline = SystemClock.uptimeMillis() + TIMEOUT_MS
        var insets = readImeInsets()
        while (SystemClock.uptimeMillis() < deadline) {
            insets = readImeInsets()
            if (insets.visible == shown) return
            SystemClock.sleep(POLL_MS)
        }
        error(
            "IME did not become ${if (shown) "visible" else "hidden"}; " +
                "WindowInsets frame=${insets.frame}, visible=${insets.visible}",
        )
    }

    private fun MacrobenchmarkScope.readImeInsets(): ImeInsets {
        val state = device.executeShellCommand("dumpsys window insets")
        for (type in IME_TYPE.findAll(state)) {
            val block = state.substring(type.range.first, minOf(state.length, type.range.first + 800))
            val frame = IME_FRAME.find(block)?.value
            val visible = IME_VISIBLE.find(block)?.groupValues?.get(1)?.toBooleanStrictOrNull()
            if (frame != null && visible != null) {
                return ImeInsets(visible = visible, frame = frame)
            }
        }
        error("dumpsys window insets has no parseable type=ime source with frame and visibility")
    }

    private fun MacrobenchmarkScope.waitUntilGone(testId: String) {
        check(device.wait(Until.gone(By.res(testId)), TIMEOUT_MS)) {
            "$testId did not disappear"
        }
    }

    private fun <T> MacrobenchmarkScope.waitUntil(
        description: String,
        block: () -> T?,
    ): T {
        val deadline = SystemClock.uptimeMillis() + TIMEOUT_MS
        while (SystemClock.uptimeMillis() < deadline) {
            block()?.let { return it }
            SystemClock.sleep(POLL_MS)
        }
        error("timed out waiting for $description")
    }

    companion object {
        private data class ImeInsets(
            val visible: Boolean,
            val frame: String,
        )

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
        private const val POLL_MS = 100L
        private const val SWIPE_STEPS = 24
        private const val MAX_ANCHOR_DRIFT_DP = 4
        private const val MULTILINE_TEXT =
            "First line\nSecond line\nThird line\nFourth line"
        private const val CONTROL_TEXT = "benchmark typing only"
        private val PROVIDER_ID =
            Regex(
                "^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                RegexOption.IGNORE_CASE,
            )
        private val IME_TYPE = Regex("(?:mType|type)=ime\\b")
        private val IME_FRAME =
            Regex("(?:mFrame|frame)=\\[-?\\d+,-?\\d+]\\[-?\\d+,-?\\d+]")
        private val IME_VISIBLE = Regex("(?:mVisible|visible)=(true|false)")
        private val ROW_ID_PATTERN = Pattern.compile(".*chat-v2-row-.*")
    }
}
