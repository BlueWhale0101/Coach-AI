# Display time zone

| Surface | Default | Set or reset |
| --- | --- | --- |
| Phone | Device time zone | Tap the zone shown in the page header. Enter an IANA name, or leave blank to follow the device. |
| Household tablet | Australia/Darwin (Alice Springs) | Open Display settings → Display time zone. Enter an IANA name, or clear it to use the household default. |
| Scriptable | Device time zone | Set or clear the shared MANUAL_TIMEZONE in the installed script. |

Phone and Scriptable use Intl device settings, with Darwin as fallback. Preferences are local and separate, even if phone and tablet use the same Site origin. The phone checks again on focus, visibility, and regular refresh. Timed appointments and deadlines keep their absolute instants; all-day events keep their dates. Changing a display preference never modifies recurrence, reminders or another client's settings.

## Upgrade and acceptance

After review, redeploy the existing get-client-today Edge Function first, rebuild the existing Site with node scripts/build-tablet-board.mjs and publish that bundle, then update the installed Scriptable script. No database migrations, credential rotations, new Site or manifest identity changes. Phone and tablet workers each preload their versioned public shell and retire only their own obsolete cache. Close all old PWA windows and reopen online for the update. Phone IndexedDB v1, local settings and widget Keychain/config remain compatible. A successful initial load of the phone cache is needed for offline data; tablet offline support remains shell-only.

Verify on already installed devices, without clearing storage or reinstalling:

1. Start with a populated phone Today view and a signed-in household tablet. Upgrade, close all windows, then relaunch. Check the new setting, retained session/settings, and independent Pacific phone and Darwin tablet dates. Reopen the phone offline and confirm saved events appear immediately.
2. Change device time zone while offline (including across the international date line), resume, check partial coverage and unavailable Today tasks, then reconnect. Confirm fresh selection replaces it. Set and remove manual overrides, relaunch, and verify persistence and reset.
3. On **physical iOS running Scriptable**, leave the manual override blank, run in Pacific and household zones, and verify the device's current IANA zone and event/deadline labels across all three modes. Set the shared override, repeat offline after a zone change, restore connectivity, and confirm the same token still works. This remains a release acceptance gate.
4. On the mounted tablet set the device and display to different zones; compare day and week current-time lines with an event at the current local hour. Check the repeated DST hour retains separate event entries (the calendar grid is a wall-clock grid).
