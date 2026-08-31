#!/usr/bin/env python3
"""Drive the call screen on a real device and capture it.

RULE 2 in CLAUDE.md: a visual change is verified on a device, not in the test
runner, and "it cannot be tested" is almost always wrong. UI Automator exposes
every node with bounds, so the call flow is driven by testID rather than by
guessed coordinates.

    python3 scripts/qa-call-screen.py <serial> [audio|video]

Captures to /tmp/qa/. The call screen is a live WebRTC surface, so this drives
the *outgoing* phases (starting / ringing) that one device can reach alone.
"""
import re
import subprocess
import sys
import time
from pathlib import Path

SERIAL = sys.argv[1] if len(sys.argv) > 1 else "R5CT2356S2M"
KIND = sys.argv[2] if len(sys.argv) > 2 else "audio"
OUT = Path("/tmp/qa")
OUT.mkdir(exist_ok=True)


def adb(*args, binary=False):
    r = subprocess.run(
        ["adb", "-s", SERIAL, *args], capture_output=True, timeout=120
    )
    return r.stdout if binary else r.stdout.decode("utf-8", "replace")


def dump():
    return adb("exec-out", "uiautomator", "dump", "/dev/tty")


def node(xml, testid):
    """The full node string for a resource-id, or None."""
    for chunk in xml.split(">"):
        if f'resource-id="{testid}"' in chunk:
            return chunk
    return None


def bounds(chunk):
    m = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', chunk or "")
    if not m:
        return None
    x1, y1, x2, y2 = (int(g) for g in m.groups())
    return (x1 + x2) // 2, (y1 + y2) // 2


def tap(testid, xml=None):
    xml = xml or dump()
    c = node(xml, testid)
    xy = bounds(c)
    if xy is None:
        return False
    adb("shell", "input", "tap", str(xy[0]), str(xy[1]))
    return True


def shot(name):
    path = OUT / f"{name}.png"
    path.write_bytes(adb("exec-out", "screencap", "-p", binary=True))
    print(f"  captured {path}")
    return path


def enabled(chunk):
    return 'enabled="true"' in (chunk or "")


def texts(xml):
    return [
        t
        for t in re.findall(r'text="([^"]+)"', xml)
        if t.strip()
    ]


def main():
    print(f"device {SERIAL}, {KIND} call")
    adb("shell", "am", "force-stop", "com.companionchat")
    adb(
        "shell",
        "monkey",
        "-p",
        "com.companionchat",
        "-c",
        "android.intent.category.LAUNCHER",
        "1",
    )
    time.sleep(9)

    xml = dump()
    rails = re.findall(r'resource-id="(rail-[0-9a-f-]+)"', xml)
    print(f"rail entries: {len(rails)}")

    target = None
    for rail in rails:
        xml = dump()
        if not tap(rail, xml):
            continue
        time.sleep(4)
        chat = dump()
        btn = node(chat, f"call-{'video' if KIND == 'video' else 'voice'}")
        print(f"  {rail}: call button enabled={enabled(btn)}")
        if enabled(btn):
            target = rail
            break
        adb("shell", "input", "keyevent", "KEYCODE_BACK")
        time.sleep(3)

    if target is None:
        print("NO conversation had an enabled call button.")
        print("Every one is gated by an active paid session or pending request")
        print("(ChatScreen: disabled={!callsEnabled || activeSession || pendingRequest}).")
        return 1

    shot("10-chat-before-call")
    tap(f"call-{'video' if KIND == 'video' else 'voice'}")

    # Phases are short; sample rather than sleep through them.
    for i, delay in enumerate((1.5, 2.5, 4.0, 6.0)):
        time.sleep(delay if i == 0 else delay - (1.5 if i == 1 else 0))
        xml = dump()
        status = node(xml, "call-status")
        st = re.search(r'text="([^"]*)"', status or "")
        print(f"  t+{delay}s status={st.group(1) if st else '?'} | {texts(xml)[:6]}")
        shot(f"2{i}-call-{KIND}-{delay}s")

    xml = dump()
    print("\ncall screen nodes:")
    for rid in re.findall(r'resource-id="([^"]+)"', xml):
        if rid.startswith("com.companionchat:id/") or rid.startswith("android:id/"):
            continue
        print(f"  {rid}")

    # Leave the call so the device is not left in a live session.
    if tap("call-end"):
        print("ended call")
    time.sleep(2)
    shot("30-after-end")
    return 0


if __name__ == "__main__":
    sys.exit(main())
