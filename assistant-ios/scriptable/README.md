# Assistant.AI Scriptable widgets

One read-only Scriptable script supplies three **medium iPhone Home Screen** widgets. Use the Widget Parameter `tasks`, `calendar`, or `today` (lowercase). Leaving the parameter empty selects `today`. Each widget opens the corresponding private Assistant.AI Phone page when tapped.

| Parameter | Widget shows | Tap opens |
| --- | --- | --- |
| `tasks` | Up to four attention tasks, with real deadlines when present | `/phone/tasks` |
| `calendar` | Up to three current/upcoming events | `/phone/calendar` |
| `today` | Two tasks and the next timed event (or an all-day event when no timed event is available) | `/phone/` |

All tap destinations use `https://assistant-tablet-board-v0.iona-skye-eller.chatgpt.site`. Scriptable fetches data directly from the dedicated `get-client-today` Supabase Edge Function using a device-specific token. The Site remains private; the Site login is needed when opening the Phone page, not when fetching widget data.

## Install on iPhone

1. Install **Scriptable** from the App Store. Obtain the 64-character **raw device token** and your working `https://…supabase.co/functions/v1/get-client-today` URL from the completed widget API setup. Use the raw token, not its database SHA-256 digest. Do not paste it into GitHub or into the script file.
2. On your iPhone, open [`assistant-widget.js`](./assistant-widget.js) from this repository, copy its entire contents, and in Scriptable tap **+** to create a script. Name it `Assistant AI`, paste the code, and save.
3. Run `Assistant AI` once **inside Scriptable**. Paste the working `get-client-today` URL into the first prompt, then paste the raw token into the secure second prompt. The script validates the URL, stores the public URL in Scriptable's local documents, stores the token in Scriptable Keychain, fetches data, and previews the medium Today widget. It never prints or displays the stored token.
4. Long-press the iPhone Home Screen, tap **+**, select **Scriptable**, and choose the **medium** widget. Long-press that widget, choose **Edit Widget**, select the `Assistant AI` script, and set **Widget Parameter** to `tasks`.
5. Repeat step 4 for two more medium widgets with parameters `calendar` and `today`. You can install only the views you want. Each widget has the same script and Keychain token.
6. Tap each widget to check that Safari opens the appropriate private Phone route. Sign in to the Site in Safari when prompted. This sign-in is separate from the widget API token.

The script uses only Scriptable's native widget layout. iOS decides when to refresh; the script makes one GET per refresh and does not schedule polling. It caches the last successful, bounded response **locally on the device**. A temporary network or service failure uses that response and labels the time `Saved HH:MM`; invalid/revoked credentials do not fall back to cached household data. Run the script interactively for a diagnostic alert or to replace a rejected token. If the API URL changes, remove Scriptable's local `assistant-ai-widget-config.json` and rerun setup; the Keychain token stays separate. Remove the local `assistant-ai-widget-last-success.json` if you want to clear the cached titles/events.

V1 intentionally targets the medium Home Screen layout and has no task/event actions. The API contract and credential handling are documented in [`assistant/WidgetClient.md`](../../assistant/WidgetClient.md).

## Widget tap behavior on iOS

The widget opens the matching Assistant.AI HTTPS route. iOS Home Screen web apps do not expose a custom URL scheme or associated-domain registration that an external Scriptable widget can target, so there is no supported direct handoff from Scriptable into the installed Assistant.AI PWA. Keep the HTTPS destination rather than adding a Shortcut or other launcher indirection; iOS may open it in the browser. The installed PWA itself remains the preferred direct launcher from the Home Screen.
