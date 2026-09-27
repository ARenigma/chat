package com.companionchat

import android.app.DatePickerDialog
import android.app.Dialog
import android.app.TimePickerDialog
import android.content.DialogInterface
import android.os.Bundle
import android.text.format.DateFormat
import android.view.View
import android.widget.DatePicker
import android.widget.TimePicker
import androidx.fragment.app.DialogFragment
import androidx.fragment.app.FragmentActivity
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.bridge.WritableMap
import com.facebook.react.uimanager.ReactShadowNode
import com.facebook.react.uimanager.ViewManager

/** Registration shim, matching DeviceClassPackage. */
class BirthPickerPackage : ReactPackage {
    override fun createNativeModules(
        reactContext: ReactApplicationContext,
    ): List<NativeModule> = listOf(BirthPickerModule(reactContext))

    override fun createViewManagers(
        reactContext: ReactApplicationContext,
    ): List<ViewManager<out View, out ReactShadowNode<*>>> = emptyList()
}

/**
 * The platform date and time pickers, for the birth-details card
 * (src/lib/birthPicker.ts, src/chat-v2/BirthDetailsSheet.tsx).
 *
 * A module of our own rather than a dependency (RULE 5): the whole need is two
 * framework dialogs, and the app had no picker package to reuse.
 *
 * The framework `DatePickerDialog` and `TimePickerDialog`, hosted in a
 * `DialogFragment`, as developer.android.com prescribes: the fragment owns the
 * dialog's lifecycle, and the dialogs give a valid date or time, formatted for
 * the user's locale.
 * https://developer.android.com/develop/ui/views/components/pickers
 *
 * DEPARTURE, stated: that page points to Material 3's pickers for a better
 * experience (https://m3.material.io/components/date-pickers/overview), and
 * the M3 component is `MaterialDatePicker`. It is not used because it enforces
 * a Material theme on its host, and AppTheme is AppCompat
 * (res/values/styles.xml); moving the whole app to a Material 3 theme is not
 * this card's change to make. The framework dialog takes the device's own
 * Material look and follows dark mode through the DayNight theme.
 *
 * The time picker follows the device's 12/24-hour setting
 * (`DateFormat.is24HourFormat`, as the pickers page does). What is SENT is
 * always the card's 12-hour line; see src/lib/birthDetails.ts.
 */
class BirthPickerModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = NAME

    /**
     * Resolves `{year, month, day}` (month 1-12) or null when dismissed. The
     * bounds are epoch milliseconds; the picker cannot leave them.
     */
    @ReactMethod
    fun pickDate(year: Int, month: Int, day: Int, minMillis: Double, maxMillis: Double, promise: Promise) {
        val activity = reactContext.currentActivity as? FragmentActivity
        if (activity == null) {
            promise.resolve(null)
            return
        }
        UiThreadUtil.runOnUiThread {
            val fragment = BirthDateDialogFragment()
            fragment.arguments = Bundle().apply {
                putInt(ARG_YEAR, year)
                putInt(ARG_MONTH, month)
                putInt(ARG_DAY, day)
                putLong(ARG_MIN, minMillis.toLong())
                putLong(ARG_MAX, maxMillis.toLong())
            }
            fragment.onResult = { result -> promise.resolve(result) }
            showOnce(activity, fragment, TAG_DATE, promise)
        }
    }

    /** Resolves `{hour, minute}` (hour 0-23) or null when dismissed. */
    @ReactMethod
    fun pickTime(hour: Int, minute: Int, promise: Promise) {
        val activity = reactContext.currentActivity as? FragmentActivity
        if (activity == null) {
            promise.resolve(null)
            return
        }
        UiThreadUtil.runOnUiThread {
            val fragment = BirthTimeDialogFragment()
            fragment.arguments = Bundle().apply {
                putInt(ARG_HOUR, hour)
                putInt(ARG_MINUTE, minute)
            }
            fragment.onResult = { result -> promise.resolve(result) }
            showOnce(activity, fragment, TAG_TIME, promise)
        }
    }

    private fun showOnce(activity: FragmentActivity, fragment: DialogFragment, tag: String, promise: Promise) {
        val manager = activity.supportFragmentManager
        // A second tap while one is up answers null rather than stacking two.
        if (manager.isStateSaved || manager.findFragmentByTag(tag) != null) {
            promise.resolve(null)
            return
        }
        fragment.show(manager, tag)
    }

    companion object {
        const val NAME = "BirthPicker"
        const val TAG_DATE = "pappal-birth-date"
        const val TAG_TIME = "pappal-birth-time"
        const val ARG_YEAR = "year"
        const val ARG_MONTH = "month"
        const val ARG_DAY = "day"
        const val ARG_MIN = "min"
        const val ARG_MAX = "max"
        const val ARG_HOUR = "hour"
        const val ARG_MINUTE = "minute"
    }
}

/**
 * Answers exactly once. After a process death the fragment is restored with no
 * promise behind it; there is nobody to answer, so it closes itself.
 */
abstract class BirthPickerDialogFragment : DialogFragment() {
    var onResult: ((WritableMap?) -> Unit)? = null

    protected fun answer(result: WritableMap?) {
        val callback = onResult ?: return
        onResult = null
        callback(result)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (onResult == null) {
            showsDialog = false
            dismissAllowingStateLoss()
        }
    }

    override fun onCancel(dialog: DialogInterface) {
        super.onCancel(dialog)
        answer(null)
    }

    override fun onDestroy() {
        super.onDestroy()
        answer(null)
    }
}

class BirthDateDialogFragment : BirthPickerDialogFragment(), DatePickerDialog.OnDateSetListener {
    override fun onCreateDialog(savedInstanceState: Bundle?): Dialog {
        val args = requireArguments()
        val dialog = DatePickerDialog(
            requireContext(),
            this,
            args.getInt(BirthPickerModule.ARG_YEAR),
            // DatePicker months are 0-11.
            args.getInt(BirthPickerModule.ARG_MONTH) - 1,
            args.getInt(BirthPickerModule.ARG_DAY),
        )
        // Max before min: setting a min past the default max throws.
        // https://developer.android.com/reference/android/widget/DatePicker#setMinDate(long)
        dialog.datePicker.maxDate = args.getLong(BirthPickerModule.ARG_MAX)
        dialog.datePicker.minDate = args.getLong(BirthPickerModule.ARG_MIN)
        return dialog
    }

    override fun onDateSet(view: DatePicker, year: Int, month: Int, dayOfMonth: Int) {
        answer(
            Arguments.createMap().apply {
                putInt("year", year)
                putInt("month", month + 1)
                putInt("day", dayOfMonth)
            },
        )
    }
}

class BirthTimeDialogFragment : BirthPickerDialogFragment(), TimePickerDialog.OnTimeSetListener {
    override fun onCreateDialog(savedInstanceState: Bundle?): Dialog {
        val args = requireArguments()
        return TimePickerDialog(
            requireContext(),
            this,
            args.getInt(BirthPickerModule.ARG_HOUR),
            args.getInt(BirthPickerModule.ARG_MINUTE),
            DateFormat.is24HourFormat(requireContext()),
        )
    }

    override fun onTimeSet(view: TimePicker, hourOfDay: Int, minute: Int) {
        answer(
            Arguments.createMap().apply {
                putInt("hour", hourOfDay)
                putInt("minute", minute)
            },
        )
    }
}
